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
import { findByCode, findByProps, findComponentByCode, findStore } from "@webpack";
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

function getStreamVolume(streamKey: string): number {
    try {
        const v = MediaEngineStore()?.getLocalVolume?.(streamKey, STREAM_CTX);
        return typeof v === "number" ? v : 100;
    } catch { return 100; }
}
function setStreamVolume(streamKey: string, v: number) {
    try { VolumeActions()?.setLocalVolume?.(streamKey, v, STREAM_CTX); }
    catch (e: any) { log("setLocalVolume threw", e?.message); }
}

function popoutWindow(windowKey: string): any {
    try { return PWS()?.getWindow?.(windowKey); } catch { return null; }
}

function toggleWinFullscreen(win: any) {
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
#${OVERLAY_ID}{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;gap:10px;
 align-items:center;padding:10px 14px 12px;color:#fff;font:13px/1 system-ui,sans-serif;
 background:linear-gradient(transparent,rgba(0,0,0,.55));opacity:0;transition:opacity .15s;
 -webkit-app-region:no-drag}
html:hover #${OVERLAY_ID}{opacity:1}
#${OVERLAY_ID} input[type=range]{flex:1;min-width:80px;accent-color:#5865f2;cursor:pointer}
#${OVERLAY_ID} .sw-val{width:38px;text-align:right;opacity:.85;font-variant-numeric:tabular-nums}
#${OVERLAY_ID} button{background:#ffffff22;border:0;color:#fff;padding:6px 9px;border-radius:6px;
 cursor:pointer;font:13px/1 system-ui}
#${OVERLAY_ID} button:hover{background:#ffffff38}
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
    const bar = doc.createElement("div");
    bar.id = OVERLAY_ID;
    bar.innerHTML =
        `<span>🔊</span>` +
        `<input type="range" min="0" max="200" step="1" value="${vol}">` +
        `<span class="sw-val">${vol}%</span>` +
        `<button class="sw-fs" title="Fullscreen (or double-click)">⛶</button>`;
    doc.body.appendChild(bar);

    const range = bar.querySelector("input") as HTMLInputElement;
    const valEl = bar.querySelector(".sw-val") as HTMLElement;
    range.addEventListener("input", () => {
        const v = +range.value;
        setStreamVolume(streamKey, v);
        valEl.textContent = Math.round(v) + "%";
    });
    (bar.querySelector(".sw-fs") as HTMLElement).addEventListener("click", () => toggleWinFullscreen(win));
    win.addEventListener("dblclick", (e: any) => {
        if (!bar.contains(e.target)) toggleWinFullscreen(win);
    });
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
