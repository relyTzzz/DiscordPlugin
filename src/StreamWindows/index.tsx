/*
 * StreamWindows — Vencord user plugin
 * Pop each watched Discord stream into its own OS window so it can live on a
 * separate monitor.
 *
 * STATUS: scaffold. The transport (how stream pixels reach the child window) is
 * decided by spike/discord-console-spike.js — see README. Until that spike
 * passes, `openWindowForStream` below is the productised version of whichever
 * mode won.
 *
 * Verify against current Vencord source before relying on:
 *   - context-menu target id (see `CONTEXT_MENU_ID`)
 *   - the shape of the stream/participant object passed into the menu patch
 *   - VencordNative.pluginHelpers wiring for ./native
 */

import { definePluginSettings } from "@api/Settings";
import { addContextMenuPatch, removeContextMenuPatch, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { OptionType } from "@utils/types";
import { Menu } from "@webpack/common";

// TODO(verify): the id Discord uses for the stream tile / voice-user context
// menu. Candidates seen in the wild: "stream-context", "user-context".
const CONTEXT_MENU_ID = "stream-context";

const settings = definePluginSettings({
    transport: {
        type: OptionType.SELECT,
        description: "How stream pixels are moved into the popped window (set by the spike result)",
        options: [
            { label: "passthrough (srcObject, no re-encode)", value: "passthrough", default: true },
            { label: "capture (video.captureStream)", value: "capture" }
        ]
    },
    alwaysOnTop: {
        type: OptionType.BOOLEAN,
        description: "Keep popped windows above other apps",
        default: false
    },
    rememberBounds: {
        type: OptionType.BOOLEAN,
        description: "Restore each window's last position/size (per stream owner)",
        default: true
    }
});

/** Renderer-side: find the <video> currently rendering `streamKey`'s feed. */
function findStreamVideo(): HTMLVideoElement | null {
    const vids = [...document.querySelectorAll("video")]
        .filter(v => v.srcObject instanceof MediaStream && v.videoWidth > 0 && !v.paused)
        .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight);
    // TODO: disambiguate by streamKey once we know how Discord tags the element.
    return vids[0] ?? null;
}

async function openWindowForStream(label: string) {
    const srcVideo = findStreamVideo();
    if (!srcVideo) return;

    // --- Arch A: renderer-owned child window (matches the spike) ------------
    const child = window.open("about:blank", `streamwindows:${label}`, "width=960,height=540");
    if (!child) return;
    child.document.title = `${label} — StreamWindows`;
    child.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
    const v = child.document.createElement("video");
    v.autoplay = v.muted = v.playsInline = true;
    v.style.cssText = "width:100vw;height:100vh;object-fit:contain";
    v.srcObject = settings.store.transport === "capture"
        ? (srcVideo as any).captureStream()
        : srcVideo.srcObject;
    child.document.body.appendChild(v);
    await v.play().catch(() => {});

    // --- Arch B (fallback, robust): native BrowserWindow + re-subscribe ----
    // If Arch A stalls in the spike, replace the block above with:
    //   await Native.openStreamWindow({ label, streamKey, alwaysOnTop: settings.store.alwaysOnTop });
    // and let native.ts + a bundled popout.html re-acquire the MediaStream from
    // Discord's media engine inside the new window.
}

const patchStreamMenu: NavContextMenuPatchCallback = (children, props) => {
    // props shape is unverified — log it once and adjust.
    const label: string = props?.user?.username ?? props?.stream?.ownerId ?? "stream";
    children.push(
        <Menu.MenuItem
            id="streamwindows-popout"
            label="Pop Out to Window"
            action={() => openWindowForStream(label)}
        />
    );
};

export default definePlugin({
    name: "StreamWindows",
    description: "Pop each watched stream into its own OS window for multi-monitor viewing.",
    authors: [{ name: "theta", id: 0n }],
    settings,
    start() {
        addContextMenuPatch(CONTEXT_MENU_ID, patchStreamMenu);
    },
    stop() {
        removeContextMenuPatch(CONTEXT_MENU_ID, patchStreamMenu);
    }
});
