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
const StreamActions = () =>
    (findByProps("watchStream", "stopWatchingStream")
        ?? findByProps("watchStream")
        ?? findByProps("stopWatchingStream")
        ?? findByProps("setStreamSourcePaused", "watchStream")
        ?? findByCode("STREAM_WATCH", "streamKey")
        ?? findByCode('"STREAM_WATCH"')) as any;

/** Ask Discord to start decoding a stream so the participant gets a streamId. */
function watchStream(streamKey: string) {
    const SA = StreamActions();
    if (SA?.watchStream) {
        log("SA.watchStream(", streamKey, ")");
        try { SA.watchStream(streamKey); return; } catch (e: any) { log("SA.watchStream threw", e?.message); }
    }
    log("dispatch STREAM_WATCH", streamKey);
    try { FluxDispatcher.dispatch({ type: "STREAM_WATCH", streamKey } as any); }
    catch (e: any) { log("STREAM_WATCH dispatch threw", e?.message); }
}

function connectedVoiceChannelId(): string | undefined {
    try { return SelectedChannel()?.getVoiceChannelId?.() ?? undefined; } catch { return undefined; }
}

/** the stream object Discord tracks for a user, if any */
function streamForUser(userId: string): any {
    const s = ASS();
    return s?.getAnyStreamForUser?.(userId) ?? s?.getStreamForUser?.(userId) ?? null;
}

/** build "guild:g:c:u" / "call:c:u" from a stream object (or its own toString) */
function streamKeyFor(stream: any, channelId: string, userId: string): string {
    if (stream && typeof stream === "object") {
        const asStr = String(stream);
        if (/^(guild|call):/.test(asStr)) return asStr;
        if (stream.streamType === "guild" && stream.guildId)
            return `guild:${stream.guildId}:${stream.channelId ?? channelId}:${stream.ownerId ?? userId}`;
        if (stream.streamType === "call")
            return `call:${stream.channelId ?? channelId}:${stream.ownerId ?? userId}`;
    }
    return `guild:0:${channelId}:${userId}`;
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
    const key = streamKeyFor(stream, channelId, userId);
    watchStream(key);

    // give the media engine a beat to assign a streamId before the tile mounts
    setTimeout(() => {
        log("openCallTilePopout(", channelId, ",", userId, ")  streamKey was", key);
        P.openCallTilePopout(channelId, userId);
        setTimeout(dumpKeys, 800);
    }, 600);
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
    log("ASS methods:", ASS() && Object.getOwnPropertyNames(Object.getPrototypeOf(ASS())).join(","));
    dumpKeys();
}

// ---- context menu ----------------------------------------------------------

const patch: NavContextMenuPatchCallback = (children, props: any) => {
    const user = props?.user;
    if (!user?.id) return;
    if (!streamForUser(user.id)) return;

    const channelId = props?.channel?.id ?? VSS()?.getVoiceStateForUser?.(user.id)?.channelId;
    if (!channelId) return;

    const connected = connectedVoiceChannelId();
    const canPop = !connected || connected === channelId;
    const isOpen = !!existingWindowKey(channelId, user.id);

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="streamwindows-popout"
                label={isOpen ? "Stream Window Open" : "Pop Out Stream to Window"}
                disabled={!canPop || isOpen}
                action={() => popOut(channelId, user.id)}
            />
            {isOpen && (
                <Menu.MenuItem
                    id="streamwindows-close"
                    label="Close Stream Window"
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
        (window as any).$sw = {
            popOut, popAllInConnectedChannel, setAlwaysOnTop, closeFor, closeAll,
            dumpKeys, discover,
            getPopout, ASS, PWS, VSS, StreamActions, connectedVoiceChannelId,
            components: {
                streamIdOnReady: () => findComponentByCode("streamId", "onReady"),
                videoStream: () => findComponentByCode("VideoStream")
            }
        };
        log("ready — right-click a streamer in voice, or /streamwindows");
    },
    stop() {
        removeContextMenuPatch(NAV_IDS, patch);
        delete (window as any).$sw;
    }
});
