/*
 * StreamWindows — Vencord user plugin
 *
 * Core mechanism (proven):
 *   popoutModule.openCallTilePopout(channelId, participantId)
 *     -> real per-streamer OS window. Multiple at once. Bounds auto-persist.
 *   BUT the tile only shows VIDEO if that participant currently has a decoded
 *   feed (a streamId) i.e. you're already watching the stream. So: watchStream()
 *   first, then pop.
 *
 * Window keys:
 *   live:   DISCORD_CALL_TILE_POPOUT_<channelId>_<streamKey>   (streamKey = guild:<g>:<c>:<u>)
 *   bounds: DISCORD_CALL_TILE_POPOUT_<channelId>_<userId>       {x,y,width,height,alwaysOnTop}
 *
 * This build: watch-then-pop, dedupe, "Pop Out All Streams", always-on-top
 * toggle. Still logs discovery for the streaming-actions module.
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { find, findByCode, findByProps, findStore } from "@webpack";
import { FluxDispatcher, Menu } from "@webpack/common";

const TAG = "%c[StreamWindows]";
const CSS = "color:#5865F2;font-weight:bold";
const log = (...a: any[]) => console.log(TAG, CSS, ...a);

const getPopout = () =>
    (findByProps("open", "setAlwaysOnTop", "openCallTilePopout")
        ?? findByProps("open", "setAlwaysOnTop")) as any;
const ASS = () => findStore("ApplicationStreamingStore") as any;
const PWS = () => findStore("PopoutWindowStore") as any;
const VSS = () => findStore("VoiceStateStore") as any;
const SelectedChannel = () => findByProps("getVoiceChannelId", "getChannelId") as any;
/** Discord's "watch this stream" thunk: v(streamDescriptor, opts) -> dispatch STREAM_WATCH. */
const watchStreamFn = () => findByCode("STREAM_WATCH", "streamKey") as any;
const SelectParticipant = () => findByProps("selectParticipant") as any;
const MediaEngineStore = () => findStore("MediaEngineStore") as any;
const VolumeActions = () => findByProps("setLocalVolume") as any;

// context passed to get/setLocalVolume for Go Live stream audio (vs "default" voice)
const STREAM_CTX = "stream";

const ownerFromKey = (streamKey: string) => streamKey.split(":").pop() as string;

function readVol(id: string): number | undefined {
    try {
        const v = MediaEngineStore()?.getLocalVolume?.(id, STREAM_CTX);
        return typeof v === "number" ? v : undefined;
    } catch { return undefined; }
}

function getStreamVolume(streamKey: string): number {
    const byKey = readVol(streamKey);
    const byOwner = readVol(ownerFromKey(streamKey));
    return byKey ?? byOwner ?? 100;
}

/*
 * setLocalVolume(id, volume, context) already dispatches AUDIO_SET_LOCAL_VOLUME
 * *and* applies to the media engine; a raw dispatch would skip the engine apply,
 * so never do that. Discord names the param `userId`, but stream volume has been
 * observed under both the owner id and the full stream key, so write both — a
 * write to the unused one is an inert store entry.
 */
function setStreamVolume(streamKey: string, v: number) {
    const VA = VolumeActions();
    for (const id of [streamKey, ownerFromKey(streamKey)]) {
        try { VA?.setLocalVolume?.(id, v, STREAM_CTX); }
        catch (e: any) { log("setLocalVolume", id, "threw", e?.message); }
    }
}

function isStreamMuted(streamKey: string): boolean {
    const mes = MediaEngineStore();
    try {
        return !!(mes?.isLocalMute?.(streamKey, STREAM_CTX) || mes?.isLocalMute?.(ownerFromKey(streamKey), STREAM_CTX));
    } catch { return false; }
}
function toggleStreamMute(streamKey: string): boolean {
    const VA = VolumeActions();
    const wasMuted = isStreamMuted(streamKey);
    for (const id of [streamKey, ownerFromKey(streamKey)]) {
        try {
            if (VA?.setLocalMute) VA.setLocalMute(id, !wasMuted, STREAM_CTX);
            else VA?.toggleLocalMute?.(id, STREAM_CTX);
        } catch (e: any) { log("mute toggle threw", id, e?.message); }
    }
    return !wasMuted;
}

function popoutWindow(windowKey: string): any {
    try { return PWS()?.getWindow?.(windowKey); } catch { return null; }
}

function toggleWinFullscreen(win: any) {
    try {
        // real Electron window fullscreen — covers the popout's own titlebar
        const dn = win?.DiscordNative?.window;
        if (dn?.fullscreen) { dn.fullscreen(); return; }
        if (dn?.setFullscreen) { win.__swFs = !win.__swFs; dn.setFullscreen(win.__swFs); return; }
    } catch (e: any) { log("DiscordNative fullscreen threw", e?.message); }
    try {
        const d = win?.document;
        if (!d) return;
        if (d.fullscreenElement) d.exitFullscreen?.();
        else d.documentElement?.requestFullscreen?.().catch((e: any) => log("requestFullscreen rejected", e?.message));
    } catch (e: any) { log("toggleWinFullscreen threw", e?.message); }
}

function toggleFullscreen(windowKey: string) {
    toggleWinFullscreen(popoutWindow(windowKey));
}

// ---- in-window control overlay ------------------------------------------

let overlayInterval: number | undefined;
const OVERLAY_ID = "streamwindows-overlay";
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
:fullscreen [class*="titleBar"],:fullscreen [class*="typeWindows"],:fullscreen [class*="titlebar"]{display:none!important}
`;

function mountOverlay(win: any, streamKey: string) {
    const doc = win?.document;
    if (!doc?.body || doc.getElementById(OVERLAY_ID)) return;

    if (!doc.getElementById(OVERLAY_ID + "-css")) {
        const style = doc.createElement("style");
        style.id = OVERLAY_ID + "-css";
        style.textContent = OVERLAY_CSS;
        (doc.head ?? doc.documentElement).appendChild(style);
    }

    const vol = Math.round(getStreamVolume(streamKey));
    const el = doc.createElement("div");
    el.id = OVERLAY_ID;
    el.innerHTML =
        `<div class="sw-pop">` +
            `<input type="range" min="0" max="200" step="1" value="${vol}">` +
            `<span class="sw-val">${vol}%</span>` +
        `</div>` +
        `<div class="sw-btns">` +
            `<button class="sw-vol" title="Volume">🔊</button>` +
            `<button class="sw-fs" title="Fullscreen (or double-click video)">⛶</button>` +
        `</div>`;
    doc.body.appendChild(el);

    const range = el.querySelector("input") as HTMLInputElement;
    const valEl = el.querySelector(".sw-val") as HTMLElement;
    const volBtn = el.querySelector(".sw-vol") as HTMLElement;
    const reflectMute = () => {
        const muted = isStreamMuted(streamKey);
        volBtn.textContent = muted ? "🔇" : "🔊";
        volBtn.classList.toggle("sw-on", muted);
    };
    reflectMute();

    range.addEventListener("input", () => {
        const v = +range.value;
        setStreamVolume(streamKey, v);
        valEl.textContent = Math.round(v) + "%";
    });
    volBtn.addEventListener("click", () => {
        toggleStreamMute(streamKey);
        setTimeout(reflectMute, 60);
    });
    (el.querySelector(".sw-fs") as HTMLElement).addEventListener("click", () => toggleWinFullscreen(win));

    // The popout is a React app that can wipe body children, so overlayTick
    // re-mounts. Bind the window-level listener once per window, not per mount,
    // or repeat mounts stack listeners and each dblclick toggles N times.
    if (!win.__swDblBound) {
        win.__swDblBound = true;
        win.addEventListener("dblclick", (e: any) => {
            const bar = win.document?.getElementById(OVERLAY_ID);
            if (!bar || !bar.contains(e.target)) toggleWinFullscreen(win);
        });
    }
}

const STREAM_KEY_RE = /^DISCORD_CALL_TILE_POPOUT_\d+_((?:guild|call):.+)$/;

/** keep an overlay mounted in every open stream popout */
function overlayTick() {
    const keys: string[] = PWS()?.getWindowKeys?.() ?? [];
    for (const k of keys) {
        const m = STREAM_KEY_RE.exec(k);
        if (!m) continue;
        const win = popoutWindow(k);
        if (win?.document?.body && !win.document.getElementById(OVERLAY_ID)) {
            try { mountOverlay(win, m[1]); } catch (e: any) { log("mountOverlay threw", e?.message); }
        }
    }
}

function removeAllOverlays() {
    for (const k of (PWS()?.getWindowKeys?.() ?? [])) {
        try {
            const doc = popoutWindow(k)?.document;
            doc?.getElementById(OVERLAY_ID)?.remove();
            doc?.getElementById(OVERLAY_ID + "-css")?.remove();
        } catch { /* window gone */ }
    }
}

const streamKeyString = (s: any) =>
    s?.streamType === "call"
        ? `call:${s.channelId}:${s.ownerId}`
        : `guild:${s.guildId}:${s.channelId}:${s.ownerId}`;

function streamState(key: string) {
    const s = ASS();
    return {
        viewers: s?.getViewerIds?.(key),
        rtc: !!s?.getRTCStream?.(key),
        active: (s?.getAllActiveStreams?.() ?? []).map(streamKeyString)
    };
}

/**
 * Ensure `stream` is decoding: add to watch set (multistream, no replace/focus)
 * AND select the participant so the media engine actually pulls frames.
 */
function ensureWatching(stream: any, channelId: string) {
    const key = streamKeyString(stream);
    log("watch: before", streamState(key));

    const fn = watchStreamFn();
    if (typeof fn === "function") {
        try { fn(stream, { forceMultiple: true, noFocus: true }); }
        catch (e: any) { log("watch thunk threw", e?.message); }
    } else {
        try { FluxDispatcher.dispatch({ type: "STREAM_WATCH", streamKey: key, allowMultiple: true } as any); }
        catch (e: any) { log("STREAM_WATCH dispatch threw", e?.message); }
    }

    try { SelectParticipant()?.selectParticipant?.(channelId, key); }
    catch (e: any) { log("selectParticipant threw", e?.message); }

    setTimeout(() => log("watch: +1s", streamState(key)), 1000);
}

function connectedVoiceChannelId(): string | undefined {
    try { return SelectedChannel()?.getVoiceChannelId?.() ?? undefined; } catch { return undefined; }
}

/** the stream object Discord tracks for a user, if any */
function streamForUser(userId: string): any {
    const s = ASS();
    return s?.getAnyStreamForUser?.(userId) ?? s?.getStreamForUser?.(userId) ?? null;
}

function existingWindowKey(channelId: string, userId: string): string | undefined {
    const keys: string[] = PWS()?.getWindowKeys?.() ?? [];
    return keys.find(k => k.includes(channelId) && k.endsWith(userId));
}

function popOut(channelId: string, userId: string) {
    const P = getPopout();
    if (!P?.openCallTilePopout) return log("openCallTilePopout missing");

    const already = existingWindowKey(channelId, userId);
    if (already) { log("already open:", already); return; }

    const stream = streamForUser(userId);
    if (stream) ensureWatching(stream, channelId);
    else log("no stream object for", userId, "— popping anyway");

    // pop the STREAM participant (identified by stream key), not the voice
    // participant (identified by user id) — the latter has no streamId -> avatar.
    const participantId = stream ? streamKeyString(stream) : userId;

    // give the media engine time to start decoding before the tile mounts
    setTimeout(() => {
        log("openCallTilePopout(", channelId, ",", participantId, ")");
        P.openCallTilePopout(channelId, participantId);
        setTimeout(dumpKeys, 800);
        for (const d of [400, 900, 1600, 2600]) setTimeout(overlayTick, d);
    }, 1300);
}

function popAllInConnectedChannel() {
    const cid = connectedVoiceChannelId();
    if (!cid) return log("not connected to a voice channel");
    const streams: any[] = ASS()?.getAllApplicationStreamsForChannel?.(cid)
        ?? (ASS()?.getAllApplicationStreams?.() ?? []).filter((s: any) => s.channelId === cid);
    log("pop all:", streams.length, "stream(s) in", cid);
    streams.forEach((s, i) => setTimeout(() => popOut(cid, s.ownerId ?? s.userId), i * 500));
}

function setAlwaysOnTop(channelId: string, userId: string, v: boolean) {
    const key = existingWindowKey(channelId, userId);
    if (!key) return log("no open window for", userId);
    getPopout()?.setAlwaysOnTop?.(key, v);
    log("alwaysOnTop", v, key);
}

function closeFor(channelId: string, userId: string) {
    const key = existingWindowKey(channelId, userId);
    if (key) { getPopout()?.close?.(key); log("closed", key); }
}

function dumpKeys() {
    log("live keys:", PWS()?.getWindowKeys?.());
    log("state:", PWS()?.getState?.());
}
function closeAll() {
    const keys: string[] = PWS()?.getWindowKeys?.() ?? [];
    keys.forEach(k => getPopout()?.close?.(k));
    log("closed", keys);
}

function discover() {
    log("=== discovery ===");

    const probes: Array<[string, () => any]> = [
        ['findByProps("watchStream")', () => findByProps("watchStream")],
        ['findByProps("watchStream","stopWatchingStream")', () => findByProps("watchStream", "stopWatchingStream")],
        ['findByProps("stopWatchingStream")', () => findByProps("stopWatchingStream")],
        ['findByProps("setStreamSourcePaused")', () => findByProps("setStreamSourcePaused")],
        ['findByProps("watchStream","setStreamSourcePaused")', () => findByProps("watchStream", "setStreamSourcePaused")],
        ['findByCode("STREAM_WATCH","streamKey")', () => findByCode("STREAM_WATCH", "streamKey")],
        ['findByCode(\'"STREAM_WATCH"\')', () => findByCode('"STREAM_WATCH"')],
        ['findByCode("stopWatchingStream")', () => findByCode("stopWatchingStream")],
    ];
    for (const [label, fn] of probes) {
        try {
            const r: any = fn();
            log(label, "→", r ? (typeof r === "function" ? "fn " + (r.name || "") : Object.keys(r).slice(0, 30).join(",")) : "null");
            if (r && typeof r === "object" && r.watchStream) log("   watchStream src:", String(r.watchStream).slice(0, 600));
            if (typeof r === "function") log("   src:", String(r).slice(0, 600));
        } catch (e: any) { log(label, "threw", e?.message); }
    }

    const s0 = (ASS()?.getAllApplicationStreams?.() ?? [])[0];
    log("sample stream obj:", s0, "keys:", s0 && Object.keys(s0));

    // native stream-volume slider call site
    log("--- volume call sites ---");
    for (const codes of [
        ["setStreamAttenuation"], ["STREAM_ATTENUATION", "setLocalVolume"],
        ["setLocalVolume", "GO_LIVE_STREAM"], ["setLocalVolume", "stream"],
        ["#{intl::STREAM_VOLUME}"], ["USER_VOLUME", "setLocalVolume"],
    ] as string[][]) {
        try {
            const m: any = findByCode(...codes);
            log(JSON.stringify(codes), "→", m ? "HIT" : "null");
            if (m) log("   " + String(typeof m === "function" ? m : (m.render ?? m.type ?? m)).slice(0, 1600));
        } catch (e: any) { log(JSON.stringify(codes), "threw", e?.message); }
    }
    const ctxE = find((m: any) => m && typeof m === "object" && m.DEFAULT === "default"
        && Object.values(m).some((x: any) => x === "stream" || /stream/i.test(String(x))));
    log("media context enum:", ctxE);

    // volume
    const VA = VolumeActions();
    log("VolumeActions:", VA ? Object.keys(VA).slice(0, 30).join(",") : "null");
    if (VA?.setLocalVolume) log("   setLocalVolume src:", String(VA.setLocalVolume).slice(0, 400));
    const MES = MediaEngineStore();
    log("MediaEngineStore.getLocalVolume:", typeof MES?.getLocalVolume);
    if (s0) {
        const k = streamKeyString({ ...s0 });
        for (const ctx of ["stream", "default", undefined]) {
            try { log(`   getLocalVolume(key, ${ctx}) →`, MES?.getLocalVolume?.(k, ctx as any)); }
            catch (e: any) { log(`   getLocalVolume(key, ${ctx}) threw`, e?.message); }
        }
    }
    for (const p of ["MediaEngineContext", "StreamContext"]) {
        try { const m: any = findByProps(p); log(`findByProps(${p}) →`, m ? JSON.stringify(m[p] ?? m) : "null"); }
        catch { /* noop */ }
    }

    // fullscreen
    log("PopoutWindowStore fullscreen getters:", {
        isWindowFullScreen: typeof PWS()?.isWindowFullScreen,
    });
    for (const code of ["POPOUT_WINDOW_SET_FULLSCREEN", "POPOUT_WINDOW_FULLSCREEN", "SET_FULLSCREEN"]) {
        try { const m: any = findByCode(code); log(`findByCode(${code}) →`, m ? (m.name || "fn") : "null"); if (m) log("   src:", String(m).slice(0, 400)); }
        catch { /* noop */ }
    }
    const P: any = getPopout();
    log("popout module methods:", P && Object.keys(P).join(","));

    // can we reach a popout window's document to inject an overlay?
    const keys: string[] = PWS()?.getWindowKeys?.() ?? [];
    log("open popout keys:", keys);
    for (const k of keys) {
        try {
            const w: any = PWS()?.getWindow?.(k);
            log(`getWindow(${k}) →`, w && Object.keys(w), "| has document:", !!w?.document, "| has window:", !!w?.window);
        } catch (e: any) { log(`getWindow(${k}) threw`, e?.message); }
    }

    dumpKeys();
}

// ---- context menu ----------------------------------------------------------

const patch: NavContextMenuPatchCallback = (children, props: any) => {
    const user = props?.user;
    if (!user?.id) return;
    const stream = streamForUser(user.id);
    if (!stream) return;

    const channelId = props?.channel?.id ?? VSS()?.getVoiceStateForUser?.(user.id)?.channelId;
    if (!channelId) return;

    const streamKey = streamKeyString(stream);
    const connected = connectedVoiceChannelId();
    const canPop = !connected || connected === channelId;
    const winKey = existingWindowKey(channelId, user.id);
    const isOpen = !!winKey;

    children.push(
        <Menu.MenuGroup label="StreamWindows">
            <Menu.MenuItem
                id="streamwindows-popout"
                label={isOpen ? "Stream Window Open" : "Pop Out Stream to Window"}
                disabled={!canPop || isOpen}
                action={() => popOut(channelId, user.id)}
            />
            {isOpen && (
                <Menu.MenuItem
                    id="streamwindows-fullscreen"
                    label="Toggle Fullscreen"
                    action={() => toggleFullscreen(winKey!)}
                />
            )}
            {isOpen && (
                <Menu.MenuItem
                    id="streamwindows-close"
                    label="Close Stream Window"
                    color="danger"
                    action={() => closeFor(channelId, user.id)}
                />
            )}
        </Menu.MenuGroup>
    );
};

const NAV_IDS = ["user-context", "stream-context"];

export default definePlugin({
    name: "StreamWindows",
    description: "Right-click a streamer in voice → pop their stream into its own OS window (multi-monitor).",
    authors: [{ name: "theta", id: 0n } as any],
    commands: [
        {
            name: "streamwindows",
            description: "Pop out every stream in your current voice channel",
            execute: () => { popAllInConnectedChannel(); return { content: "popping all streams…" }; }
        },
        {
            name: "streamwindows-discover",
            description: "StreamWindows: dump discovery to console",
            execute: () => { discover(); return { content: "→ console" }; }
        }
    ],
    start() {
        addContextMenuPatch(NAV_IDS, patch);
        overlayInterval = window.setInterval(overlayTick, 1500);
        (window as any).$sw = {
            popOut, popAllInConnectedChannel, setAlwaysOnTop, closeFor, closeAll,
            dumpKeys, discover, overlayTick, toggleFullscreen,
            getPopout, ASS, PWS, VSS, watchStreamFn, SelectParticipant, ensureWatching,
            connectedVoiceChannelId,
            streamStateFor: (userId: string) => {
                const s = streamForUser(userId);
                return s ? streamState(streamKeyString(s)) : "no stream";
            }
        };
        log("ready — right-click a streamer in voice, or /streamwindows");
    },
    stop() {
        removeContextMenuPatch(NAV_IDS, patch);
        if (overlayInterval) window.clearInterval(overlayInterval);
        removeAllOverlays();
        delete (window as any).$sw;
    }
});
