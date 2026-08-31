/*
 * StreamWindows — platform-agnostic core.
 *
 * Pops each watched Discord stream into its own OS window and injects a control
 * overlay (mute / volume / fullscreen) into that window's document.
 *
 * Mechanism, and the two non-obvious requirements behind it:
 *
 *   popoutModule.openCallTilePopout(channelId, participantId)
 *     -> dispatch { type:"CALL_TILE_POPOUT_WINDOW_OPEN", channelId, participantId }
 *
 *   1. participantId must be the STREAM KEY ("guild:<g>:<c>:<u>"), not the user
 *      id. A user id resolves to the voice participant, which has no streamId,
 *      so the window renders an avatar instead of video.
 *   2. The stream must already be DECODING before the tile mounts. Call the
 *      watch thunk with { forceMultiple: true, noFocus: true } — omitting
 *      forceMultiple makes Discord replace the watch set, tearing down an open
 *      multistream grid — then selectParticipant, then wait before popping.
 *
 * Window keys:
 *   live:   DISCORD_CALL_TILE_POPOUT_<channelId>_<streamKey>
 *   bounds: DISCORD_CALL_TILE_POPOUT_<channelId>_<userId> -> {x,y,width,height,alwaysOnTop}
 */

import type { MenuEntry, Platform } from "./platform";

/** ms to let the media engine start decoding before the popout tile mounts */
const DECODE_WAIT_MS = 1300;
/** how often to check that every open stream popout still has its overlay */
const OVERLAY_POLL_MS = 1500;
/** get/setLocalVolume context for Go Live audio (vs "default" voice audio) */
const STREAM_CTX = "stream";

/** picture-in-picture window size and gap from the screen edge, in px */
const PIP_W = 480, PIP_H = 270, PIP_MARGIN = 16;

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const CORNERS: Corner[] = ["bottom-right", "bottom-left", "top-left", "top-right"];

const OVERLAY_ID = "streamwindows-overlay";
const STREAM_KEY_RE = /^DISCORD_CALL_TILE_POPOUT_\d+_((?:guild|call):.+)$/;

const OVERLAY_CSS = `
#${OVERLAY_ID}{position:fixed;left:10px;bottom:10px;z-index:2147483647;display:flex;flex-direction:column;
 align-items:center;gap:6px;opacity:0;transition:opacity .12s;font:12px system-ui,sans-serif;color:#fff;
 -webkit-app-region:no-drag}
html:hover #${OVERLAY_ID}{opacity:.95}
#${OVERLAY_ID} .sw-pop{display:none;flex-direction:column;align-items:center;gap:4px;padding:8px 6px 6px;
 border-radius:9px;background:rgba(0,0,0,.72)}
#${OVERLAY_ID}:hover .sw-pop,#${OVERLAY_ID}.sw-open .sw-pop{display:flex}
#${OVERLAY_ID} input[type=range]{writing-mode:vertical-lr;direction:rtl;width:20px;height:92px;
 accent-color:#5865f2;cursor:pointer}
#${OVERLAY_ID} .sw-val{opacity:.8;font-variant-numeric:tabular-nums}
#${OVERLAY_ID} .sw-btns{display:flex;gap:6px}
#${OVERLAY_ID} button{width:30px;height:30px;border:0;border-radius:8px;background:rgba(0,0,0,.6);
 color:#fff;cursor:pointer;font-size:14px;line-height:1}
#${OVERLAY_ID} button:hover{background:rgba(0,0,0,.85)}
#${OVERLAY_ID} button.sw-on{background:#5865f2}
/* Hide the popout's own title bar so the video runs edge to edge. It is lifted
   out of flow (position:fixed) rather than display:none'd, because Discord puts
   -webkit-app-region:drag on it — display:none would make the window
   undraggable. Hovering the top strip fades the window buttons back in,
   semi-transparent; hovering a button itself brings it to full opacity. */
[class*="titleBar"]{
 position:fixed!important;top:0;left:0;right:0;height:26px;z-index:2147483646;
 background:transparent!important;border:0!important;box-shadow:none!important;
 opacity:0;transition:opacity .15s;-webkit-app-region:drag}
[class*="titleBar"]:hover{opacity:.55}
/* the title text / wordmark never comes back, only the controls */
[class*="titleBar"] [class*="wordmark"],[class*="titleBar"] [class*="title_"]{display:none!important}
[class*="winButtons"]{-webkit-app-region:no-drag}
[class*="winButton"]:hover{opacity:1!important;background:rgba(255,255,255,.15)!important}
/* fullscreen hides the bar outright */
:fullscreen [class*="titleBar"],:fullscreen [class*="typeWindows"],:fullscreen [class*="titlebar"]{display:none!important}
`;

export interface StreamWindows {
    start(): void;
    stop(): void;
    /** rows to add to a user/stream context menu, or [] if not applicable */
    menuEntriesFor(props: any): MenuEntry[];
    popOut(channelId: string, userId: string): void;
    popAllInConnectedChannel(): void;
    closeAll(): void;
    dumpKeys(): void;
    discover(): void;
    /** everything above plus internals, for console poking */
    debug: Record<string, any>;
}

export function createStreamWindows(P: Platform): StreamWindows {
    const log = P.log;

    // ---- module handles (looked up lazily; Discord lazy-loads chunks) -------
    const popoutModule = () =>
        P.getByProps("open", "setAlwaysOnTop", "openCallTilePopout")
        ?? P.getByProps("open", "setAlwaysOnTop");
    const streamStore = () => P.getStore("ApplicationStreamingStore");
    const popoutStore = () => P.getStore("PopoutWindowStore");
    const voiceStore = () => P.getStore("VoiceStateStore");
    const mediaEngine = () => P.getStore("MediaEngineStore");
    const volumeActions = () => P.getByProps("setLocalVolume");
    const selectedChannel = () => P.getByProps("getVoiceChannelId", "getChannelId");
    const dispatcher = () => P.getByProps("dispatch", "subscribe");
    const selectParticipant = () => P.getByProps("selectParticipant");
    /** watch thunk: fn(streamDescriptor, { forceMultiple, noFocus, forceFocus }) */
    const watchThunk = () => P.getByCode("STREAM_WATCH", "streamKey");

    // ---- stream identity ----------------------------------------------------
    const streamKeyOf = (s: any): string =>
        s?.streamType === "call"
            ? `call:${s.channelId}:${s.ownerId}`
            : `guild:${s.guildId}:${s.channelId}:${s.ownerId}`;

    const ownerOf = (streamKey: string) => streamKey.split(":").pop() as string;

    function streamForUser(userId: string): any {
        const s = streamStore();
        return s?.getAnyStreamForUser?.(userId) ?? s?.getStreamForUser?.(userId) ?? null;
    }

    function connectedVoiceChannelId(): string | undefined {
        try { return selectedChannel()?.getVoiceChannelId?.() ?? undefined; } catch { return undefined; }
    }

    // ---- volume / mute ------------------------------------------------------
    function readVol(id: string): number | undefined {
        try {
            const v = mediaEngine()?.getLocalVolume?.(id, STREAM_CTX);
            return typeof v === "number" ? v : undefined;
        } catch { return undefined; }
    }

    function getVolume(streamKey: string): number {
        return readVol(streamKey) ?? readVol(ownerOf(streamKey)) ?? 100;
    }

    /*
     * setLocalVolume already dispatches AUDIO_SET_LOCAL_VOLUME *and* applies to
     * the media engine, so never raw-dispatch that action — it would move the
     * store without changing audio. Discord names the param `userId`, but stream
     * volume has been observed under both the owner id and the full stream key,
     * so write both; the unused one is an inert store entry.
     */
    function setVolume(streamKey: string, v: number) {
        const VA = volumeActions();
        for (const id of [streamKey, ownerOf(streamKey)]) {
            try { VA?.setLocalVolume?.(id, v, STREAM_CTX); }
            catch (e: any) { log("setLocalVolume", id, "threw", e?.message); }
        }
    }

    function isMuted(streamKey: string): boolean {
        const me = mediaEngine();
        try {
            return !!(me?.isLocalMute?.(streamKey, STREAM_CTX)
                || me?.isLocalMute?.(ownerOf(streamKey), STREAM_CTX));
        } catch { return false; }
    }

    function toggleMute(streamKey: string): boolean {
        const VA = volumeActions();
        const next = !isMuted(streamKey);
        for (const id of [streamKey, ownerOf(streamKey)]) {
            try {
                if (VA?.setLocalMute) VA.setLocalMute(id, next, STREAM_CTX);
                else VA?.toggleLocalMute?.(id, STREAM_CTX);
            } catch (e: any) { log("mute toggle threw", id, e?.message); }
        }
        return next;
    }

    // ---- popout windows -----------------------------------------------------
    const windowFor = (key: string) => {
        try { return popoutStore()?.getWindow?.(key); } catch { return null; }
    };

    const liveKeys = (): string[] => popoutStore()?.getWindowKeys?.() ?? [];

    function existingWindowKey(channelId: string, userId: string): string | undefined {
        return liveKeys().find(k => k.includes(channelId) && k.endsWith(userId));
    }

    function toggleWinFullscreen(win: any) {
        try {
            // native Electron fullscreen also covers the popout's own titlebar
            const dn = win?.DiscordNative?.window;
            if (dn?.fullscreen) { dn.fullscreen(); return; }
            if (dn?.setFullscreen) { win.__swFs = !win.__swFs; dn.setFullscreen(win.__swFs); return; }
        } catch (e: any) { log("DiscordNative fullscreen threw", e?.message); }
        try {
            const d = win?.document;
            if (!d) return;
            if (d.fullscreenElement) d.exitFullscreen?.();
            else d.documentElement?.requestFullscreen?.()
                ?.catch((e: any) => log("requestFullscreen rejected", e?.message));
        } catch (e: any) { log("toggleWinFullscreen threw", e?.message); }
    }

    const toggleFullscreen = (windowKey: string) => toggleWinFullscreen(windowFor(windowKey));

    // ---- picture-in-picture -------------------------------------------------
    /*
     * Snap a popout to a screen corner at a small fixed size and pin it above
     * other windows.
     *
     * Reach: always-on-top covers normal windows, borderless/windowed-fullscreen
     * games, and fullscreen video players. It CANNOT cover a game in exclusive
     * fullscreen — that game owns the display outright, which is precisely why
     * Discord ships a separate injected game overlay (discord_overlay2). Nothing
     * we can do from a BrowserWindow changes that; the fix is borderless mode in
     * the game.
     */

    /** work area of whichever screen the window currently sits on */
    function workArea(win: any) {
        const sc = win.screen ?? {};
        return {
            left: sc.availLeft ?? 0,
            top: sc.availTop ?? 0,
            width: sc.availWidth ?? 1920,
            height: sc.availHeight ?? 1080
        };
    }

    function nearestCorner(win: any): Corner {
        const a = workArea(win);
        const cx = (win.screenX ?? 0) + (win.outerWidth ?? PIP_W) / 2;
        const cy = (win.screenY ?? 0) + (win.outerHeight ?? PIP_H) / 2;
        const vert = cy < a.top + a.height / 2 ? "top" : "bottom";
        const horiz = cx < a.left + a.width / 2 ? "left" : "right";
        return `${vert}-${horiz}` as Corner;
    }

    function snapToCorner(win: any, corner: Corner) {
        const a = workArea(win);
        const x = corner.endsWith("right") ? a.left + a.width - PIP_W - PIP_MARGIN : a.left + PIP_MARGIN;
        const y = corner.startsWith("bottom") ? a.top + a.height - PIP_H - PIP_MARGIN : a.top + PIP_MARGIN;
        try { win.resizeTo(PIP_W, PIP_H); win.moveTo(x, y); }
        catch (e: any) { log("snapToCorner threw", e?.message); }
    }

    const isPip = (win: any) => !!win?.__swPip;

    function setAlwaysOnTopFor(windowKey: string, win: any, on: boolean) {
        const tried: string[] = [];

        // 1. Discord's own action — also persists the flag in PopoutWindowStore
        try { popoutModule()?.setAlwaysOnTop?.(windowKey, on); tried.push("popout.setAlwaysOnTop"); }
        catch (e: any) { log("popout.setAlwaysOnTop threw", e?.message); }

        // 2. the popout's own native window handle. Signature is undocumented, so
        //    try (bool) and, for Electron's levelled form, (bool, level).
        const dn = win?.DiscordNative?.window;
        if (dn?.setAlwaysOnTop) {
            try { dn.setAlwaysOnTop(on); tried.push("DiscordNative(bool)"); }
            catch (e: any) { log("DiscordNative.setAlwaysOnTop(bool) threw", e?.message); }
            try { dn.setAlwaysOnTop(on, on ? "screen-saver" : "normal"); tried.push("DiscordNative(bool,level)"); }
            catch { /* single-arg form only */ }
        }

        const readBack = (() => {
            try { return popoutStore()?.getIsAlwaysOnTop?.(windowKey); } catch { return "?"; }
        })();
        log("alwaysOnTop", on, "via", tried.join(" + ") || "NOTHING", "| store says:", readBack);
    }

    /** turn PiP on (snapping to `corner`, default: nearest) or off (restore bounds) */
    function setPip(windowKey: string, on: boolean, corner?: Corner) {
        const win = windowFor(windowKey);
        if (!win) return log("no window for", windowKey);

        if (on) {
            if (!win.__swPip) {
                win.__swPrevBounds = {
                    x: win.screenX, y: win.screenY,
                    w: win.outerWidth, h: win.outerHeight
                };
            }
            const c = corner ?? win.__swPipCorner ?? nearestCorner(win);
            win.__swPip = true;
            win.__swPipCorner = c;
            snapToCorner(win, c);
            setAlwaysOnTopFor(windowKey, win, true);
            log("pip on:", windowKey, c);
        } else {
            win.__swPip = false;
            setAlwaysOnTopFor(windowKey, win, false);
            const b = win.__swPrevBounds;
            if (b) {
                try { win.resizeTo(b.w, b.h); win.moveTo(b.x, b.y); }
                catch (e: any) { log("restore bounds threw", e?.message); }
            }
            log("pip off:", windowKey);
        }
        refreshOverlayState(win);
    }

    const togglePip = (windowKey: string) => setPip(windowKey, !isPip(windowFor(windowKey)));

    /** move an already-PiP window to the next corner clockwise */
    function cyclePipCorner(windowKey: string) {
        const win = windowFor(windowKey);
        if (!win) return;
        const cur = win.__swPipCorner ?? nearestCorner(win);
        const next = CORNERS[(CORNERS.indexOf(cur) + 1) % CORNERS.length];
        setPip(windowKey, true, next);
    }

    /** re-sync overlay button appearance after state changes from elsewhere */
    function refreshOverlayState(win: any) {
        try { win?.__swRefresh?.(); } catch { /* overlay not mounted */ }
    }


    // ---- in-window control overlay -----------------------------------------
    function mountOverlay(win: any, streamKey: string, windowKey: string) {
        const doc = win?.document;
        if (!doc?.body || doc.getElementById(OVERLAY_ID)) return;

        if (!doc.getElementById(OVERLAY_ID + "-css")) {
            const style = doc.createElement("style");
            style.id = OVERLAY_ID + "-css";
            style.textContent = OVERLAY_CSS;
            (doc.head ?? doc.documentElement).appendChild(style);
        }

        const vol = Math.round(getVolume(streamKey));
        const el = doc.createElement("div");
        el.id = OVERLAY_ID;
        el.innerHTML =
            `<div class="sw-pop">` +
                `<input type="range" min="0" max="200" step="1" value="${vol}">` +
                `<span class="sw-val">${vol}%</span>` +
            `</div>` +
            `<div class="sw-btns">` +
                `<button class="sw-vol" title="Mute / volume"></button>` +
                `<button class="sw-pip" title="Picture-in-picture: pin to a screen corner, always on top (shift-click to move corner)">📌</button>` +
                `<button class="sw-fs" title="Fullscreen (or double-click video)">⛶</button>` +
            `</div>`;
        doc.body.appendChild(el);

        const range = el.querySelector("input") as HTMLInputElement;
        const valEl = el.querySelector(".sw-val") as HTMLElement;
        const volBtn = el.querySelector(".sw-vol") as HTMLElement;

        const pipBtn = el.querySelector(".sw-pip") as HTMLElement;

        const reflectMute = () => {
            const muted = isMuted(streamKey);
            volBtn.textContent = muted ? "🔇" : "🔊";
            volBtn.classList.toggle("sw-on", muted);
        };
        const reflectPip = () => pipBtn.classList.toggle("sw-on", isPip(win));
        reflectMute();
        reflectPip();
        // setPip() calls this so the button stays in sync when toggled from the
        // context menu or console rather than from this button
        win.__swRefresh = () => { reflectMute(); reflectPip(); };

        range.addEventListener("input", () => {
            const v = +range.value;
            setVolume(streamKey, v);
            valEl.textContent = Math.round(v) + "%";
        });
        volBtn.addEventListener("click", () => {
            toggleMute(streamKey);
            setTimeout(reflectMute, 60);
        });
        pipBtn.addEventListener("click", (ev: any) => {
            // shift-click walks an already-pinned window around the corners
            if (ev.shiftKey && isPip(win)) cyclePipCorner(windowKey);
            else togglePip(windowKey);
        });
        (el.querySelector(".sw-fs") as HTMLElement)
            .addEventListener("click", () => toggleWinFullscreen(win));

        // The popout is a React app that can wipe body children, so the poll
        // re-mounts this overlay. Bind window-level listeners once per window or
        // they stack and each dblclick toggles fullscreen N times.
        if (!win.__swDblBound) {
            win.__swDblBound = true;
            win.addEventListener("dblclick", (e: any) => {
                const bar = win.document?.getElementById(OVERLAY_ID);
                if (!bar || !bar.contains(e.target)) toggleWinFullscreen(win);
            });
        }
    }

    function overlayTick() {
        for (const k of liveKeys()) {
            const m = STREAM_KEY_RE.exec(k);
            if (!m) continue;
            const win = windowFor(k);
            if (win?.document?.body && !win.document.getElementById(OVERLAY_ID)) {
                try { mountOverlay(win, m[1], k); } catch (e: any) { log("mountOverlay threw", e?.message); }
            }
        }
    }

    function removeAllOverlays() {
        for (const k of liveKeys()) {
            try {
                const doc = windowFor(k)?.document;
                doc?.getElementById(OVERLAY_ID)?.remove();
                doc?.getElementById(OVERLAY_ID + "-css")?.remove();
            } catch { /* window already gone */ }
        }
    }

    // ---- watch + pop --------------------------------------------------------
    function streamState(key: string) {
        const s = streamStore();
        return {
            viewers: s?.getViewerIds?.(key),
            rtc: !!s?.getRTCStream?.(key),
            active: (s?.getAllActiveStreams?.() ?? []).map(streamKeyOf)
        };
    }

    /** add to the watch set without replacing it or stealing focus, then force decode */
    function ensureWatching(stream: any, channelId: string) {
        const key = streamKeyOf(stream);
        const fn = watchThunk();
        if (typeof fn === "function") {
            try { fn(stream, { forceMultiple: true, noFocus: true }); }
            catch (e: any) { log("watch thunk threw", e?.message); }
        } else {
            try { dispatcher()?.dispatch?.({ type: "STREAM_WATCH", streamKey: key, allowMultiple: true }); }
            catch (e: any) { log("STREAM_WATCH dispatch threw", e?.message); }
        }
        try { selectParticipant()?.selectParticipant?.(channelId, key); }
        catch (e: any) { log("selectParticipant threw", e?.message); }
    }

    function popOut(channelId: string, userId: string) {
        const P0 = popoutModule();
        if (!P0?.openCallTilePopout) return log("openCallTilePopout not found");

        const already = existingWindowKey(channelId, userId);
        if (already) return log("window already open:", already);

        const stream = streamForUser(userId);
        if (stream) ensureWatching(stream, channelId);
        else log("no stream for", userId, "— popping anyway");

        const participantId = stream ? streamKeyOf(stream) : userId;
        setTimeout(() => {
            log("openCallTilePopout(", channelId, ",", participantId, ")");
            P0.openCallTilePopout(channelId, participantId);
            for (const d of [400, 900, 1600, 2600]) setTimeout(overlayTick, d);
        }, DECODE_WAIT_MS);
    }

    function popAllInConnectedChannel() {
        const cid = connectedVoiceChannelId();
        if (!cid) return log("not connected to a voice channel");
        const s = streamStore();
        const streams: any[] = s?.getAllApplicationStreamsForChannel?.(cid)
            ?? (s?.getAllApplicationStreams?.() ?? []).filter((x: any) => x.channelId === cid);
        log("popping", streams.length, "stream(s) in", cid);
        streams.forEach((st, i) => setTimeout(() => popOut(cid, st.ownerId ?? st.userId), i * 500));
    }

    function closeFor(channelId: string, userId: string) {
        const key = existingWindowKey(channelId, userId);
        if (key) { popoutModule()?.close?.(key); log("closed", key); }
    }

    function closeAll() {
        const keys = liveKeys();
        keys.forEach(k => popoutModule()?.close?.(k));
        log("closed", keys);
    }

    function setAlwaysOnTop(channelId: string, userId: string, v: boolean) {
        const key = existingWindowKey(channelId, userId);
        if (!key) return log("no open window for", userId);
        popoutModule()?.setAlwaysOnTop?.(key, v);
    }

    function dumpKeys() {
        log("live keys:", liveKeys());
        log("state:", popoutStore()?.getState?.());
    }

    function discover() {
        log("=== discovery ===");
        log("popout module:", popoutModule() && Object.keys(popoutModule()).join(","));
        log("watch thunk:", typeof watchThunk());
        log("stores:", {
            streaming: !!streamStore(), popout: !!popoutStore(),
            voice: !!voiceStore(), mediaEngine: !!mediaEngine()
        });
        log("volume actions:", volumeActions() && Object.keys(volumeActions()).slice(0, 20).join(","));
        log("streams:", streamStore()?.getAllApplicationStreams?.());
        log("connected voice channel:", connectedVoiceChannelId());
        for (const k of liveKeys()) {
            log(`window ${k}: document =`, !!windowFor(k)?.document);
        }
        dumpKeys();
    }

    /**
     * Dump the popout's own window chrome. Discord's class names are hashed per
     * build, so if the titlebar CSS above stops matching, run this and adjust the
     * [class*="..."] selectors to whatever it prints.
     */
    function inspectChrome() {
        for (const k of liveKeys()) {
            const doc = windowFor(k)?.document;
            if (!doc) continue;
            log("window", k);
            const seen = new Set<string>();
            for (const el of Array.from(doc.querySelectorAll("*")) as any[]) {
                const cls = typeof el.className === "string" ? el.className : "";
                if (!/titlebar|titleBar|winButton|wordmark|typeWindows/i.test(cls)) continue;
                if (seen.has(cls)) continue;
                seen.add(cls);
                const r = el.getBoundingClientRect?.();
                log("  ", el.tagName, JSON.stringify(cls),
                    r ? `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.top)}` : "");
            }
            if (!seen.size) log("   (no titlebar-ish elements found)");
        }
    }

    /**
     * Print everything PiP placement depends on, per open window. Use this when a
     * window snaps to the wrong corner or refuses to stay on top — it shows the
     * raw geometry rather than making us guess.
     */
    function pipDiag() {
        const keys = liveKeys();
        if (!keys.length) return log("no popout windows open");
        for (const k of keys) {
            const win = windowFor(k);
            if (!win) { log(k, "-> no window object"); continue; }
            const sc = win.screen ?? {};
            const a = workArea(win);
            log("window:", k);
            log("   position   screenX/Y:", win.screenX, win.screenY,
                "| outer:", win.outerWidth + "x" + win.outerHeight,
                "| inner:", win.innerWidth + "x" + win.innerHeight);
            log("   screen     avail L/T/W/H:", sc.availLeft, sc.availTop, sc.availWidth, sc.availHeight,
                "| full:", sc.width + "x" + sc.height);
            log("   workArea   ->", a);
            log("   corner     nearest:", nearestCorner(win), "| remembered:", win.__swPipCorner ?? "(none)");
            log("   pip state  __swPip:", !!win.__swPip, "| prevBounds:", win.__swPrevBounds ?? "(none)");
            log("   alwaysTop  store:", (() => {
                try { return popoutStore()?.getIsAlwaysOnTop?.(k); } catch { return "threw"; }
            })());
            const dn = win.DiscordNative?.window;
            log("   native     DiscordNative.window:", dn ? Object.keys(dn).join(",") : "ABSENT");
            log("   canMove    moveTo:", typeof win.moveTo, "resizeTo:", typeof win.resizeTo);
        }
    }

    // ---- context menu -------------------------------------------------------
    function menuEntriesFor(props: any): MenuEntry[] {
        const user = props?.user;
        if (!user?.id) return [];
        const stream = streamForUser(user.id);
        if (!stream) return [];

        const channelId = props?.channel?.id
            ?? voiceStore()?.getVoiceStateForUser?.(user.id)?.channelId;
        if (!channelId) return [];

        const connected = connectedVoiceChannelId();
        const canPop = !connected || connected === channelId;
        const winKey = existingWindowKey(channelId, user.id);

        const entries: MenuEntry[] = [{
            id: "streamwindows-popout",
            label: winKey ? "Stream Window Open" : "Pop Out Stream to Window",
            disabled: !canPop || !!winKey,
            action: () => popOut(channelId, user.id)
        }];

        if (winKey) {
            entries.push({
                id: "streamwindows-pip",
                label: isPip(windowFor(winKey)) ? "Exit Picture-in-Picture" : "Picture-in-Picture",
                action: () => togglePip(winKey)
            });
            entries.push({
                id: "streamwindows-fullscreen",
                label: "Toggle Fullscreen",
                action: () => toggleFullscreen(winKey)
            });
            entries.push({
                id: "streamwindows-close",
                label: "Close Stream Window",
                danger: true,
                action: () => closeFor(channelId, user.id)
            });
        }
        return entries;
    }

    // ---- lifecycle ----------------------------------------------------------
    let poll: any;

    return {
        start() {
            poll = setInterval(overlayTick, OVERLAY_POLL_MS);
            log("ready — right-click a streamer in voice");
        },
        stop() {
            if (poll) clearInterval(poll);
            poll = undefined;
            removeAllOverlays();
        },
        menuEntriesFor,
        popOut,
        popAllInConnectedChannel,
        closeAll,
        dumpKeys,
        discover,
        debug: {
            popOut, popAllInConnectedChannel, closeAll, closeFor, setAlwaysOnTop,
            dumpKeys, discover, overlayTick, toggleFullscreen, ensureWatching, inspectChrome,
            setPip, togglePip, cyclePipCorner, snapToCorner, isPip, pipDiag,
            nearestCorner, workArea,
            getVolume, setVolume, isMuted, toggleMute,
            streamKeyOf, streamForUser, streamState, connectedVoiceChannelId,
            liveKeys, windowFor, existingWindowKey,
            stores: { streamStore, popoutStore, voiceStore, mediaEngine, popoutModule }
        }
    };
}
