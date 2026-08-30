/*
 * StreamWindows — Vencord user plugin
 *
 * FEASIBILITY PROVEN. Core mechanism:
 *   popoutModule.openCallTilePopout(channelId, participantId)
 *     -> dispatch { type:"CALL_TILE_POPOUT_WINDOW_OPEN", channelId, participantId }
 *   => one real, separate, movable OS window per streamer. Multiple at once.
 *   Requires being connected to that voice channel.
 *
 * This build: first real trigger UI (right-click a streaming user in voice ->
 * "Pop Out Stream to Window"), plus keeps $sw console helpers and dumps the
 * popout window-key scheme after opening (still need it for dedupe/positioning).
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { findByProps, findComponentByCode, findStore } from "@webpack";
import { Menu } from "@webpack/common";

const TAG = "%c[StreamWindows]";
const CSS = "color:#5865F2;font-weight:bold";
const log = (...a: any[]) => console.log(TAG, CSS, ...a);

const getPopout = () =>
    findByProps("open", "setAlwaysOnTop", "openCallTilePopout") as any
    ?? findByProps("open", "setAlwaysOnTop") as any;
const ASS = () => findStore("ApplicationStreamingStore") as any;
const PWS = () => findStore("PopoutWindowStore") as any;
const VSS = () => findStore("VoiceStateStore") as any;
const SelectedChannel = () => findByProps("getVoiceChannelId", "getChannelId") as any;

/** channel id we can actually pop tiles for = the voice channel we're connected to */
function connectedVoiceChannelId(): string | undefined {
    try { return SelectedChannel()?.getVoiceChannelId?.() ?? undefined; }
    catch { return undefined; }
}

function isStreaming(userId: string): boolean {
    try { return !!ASS()?.getAnyStreamForUser?.(userId); }
    catch { return false; }
}

function popOut(channelId: string, participantId: string) {
    const P = getPopout();
    if (!P?.openCallTilePopout) return log("openCallTilePopout missing");
    log("openCallTilePopout(", channelId, ",", participantId, ")");
    P.openCallTilePopout(channelId, participantId);
    setTimeout(dumpKeys, 900);
}

function dumpKeys() {
    const s = PWS();
    log("popout window keys:", s?.getWindowKeys?.());
    log("popout state:", s?.getState?.());
}

function closeAll() {
    const s = PWS();
    const keys: string[] = s?.getWindowKeys?.() ?? [];
    keys.forEach(k => getPopout()?.close?.(k));
    log("closed", keys);
}

// ---- context menu ---------------------------------------------------------

const patchUserContext: NavContextMenuPatchCallback = (children, props: any) => {
    const user = props?.user;
    if (!user?.id) return;
    if (!isStreaming(user.id)) return;

    const channelId =
        props?.channel?.id ??
        VSS()?.getVoiceStateForUser?.(user.id)?.channelId;
    if (!channelId) return;

    const connected = connectedVoiceChannelId();
    const canPop = !connected || connected === channelId;

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="streamwindows-popout"
                label="Pop Out Stream to Window"
                disabled={!canPop}
                action={() => popOut(channelId, user.id)}
            />
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
            name: "streamwindows-discover",
            description: "StreamWindows: dump popout state to console",
            execute: () => { dumpKeys(); return { content: "→ console" }; }
        }
    ],
    start() {
        for (const id of NAV_IDS) addContextMenuPatch(id, patchUserContext);
        (window as any).$sw = {
            popOut, dumpKeys, closeAll,
            getPopout, ASS, PWS, VSS,
            connectedVoiceChannelId, isStreaming,
            streams: () => ASS()?.getAllApplicationStreams?.(),
            components: {
                streamIdOnReady: () => findComponentByCode("streamId", "onReady"),
                videoStream: () => findComponentByCode("VideoStream")
            }
        };
        log("ready. right-click a streaming user in voice, or use window.$sw");
    },
    stop() {
        for (const id of NAV_IDS) removeContextMenuPatch(id, patchUserContext);
        delete (window as any).$sw;
    }
});
