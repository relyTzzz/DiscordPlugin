/*
 * StreamWindows — native (Electron main process) helpers.
 *
 * Only needed for "Arch B": a genuinely independent BrowserWindow that
 * re-subscribes to the stream itself (this is how Discord's own stream popout
 * works). Not wired up until the spike proves Arch A insufficient.
 *
 * Vencord loads this automatically for a plugin folder that contains native.ts;
 * call it from index.tsx via:
 *   const Native = VencordNative.pluginHelpers.StreamWindows as typeof import("./native");
 */

import { BrowserWindow } from "electron";
import { join } from "path";

interface OpenOpts {
    label: string;
    /** Discord stream key, e.g. "guild:<gid>:<cid>:<uid>" — passed to the popout page. */
    streamKey: string;
    alwaysOnTop: boolean;
    bounds?: { x: number; y: number; width: number; height: number; };
}

const windows = new Map<string, BrowserWindow>();

export function openStreamWindow(_: unknown, opts: OpenOpts) {
    const existing = windows.get(opts.streamKey);
    if (existing && !existing.isDestroyed()) {
        existing.focus();
        return;
    }

    const win = new BrowserWindow({
        width: opts.bounds?.width ?? 960,
        height: opts.bounds?.height ?? 540,
        x: opts.bounds?.x,
        y: opts.bounds?.y,
        title: `${opts.label} — StreamWindows`,
        backgroundColor: "#000000",
        alwaysOnTop: opts.alwaysOnTop,
        autoHideMenuBar: true,
        webPreferences: {
            // The popout page needs access to Discord's renderer modules /
            // media engine to re-acquire the stream. Simplest path: point it at
            // an in-client route rather than a bundled file. TBD by the spike.
            contextIsolation: false,
            nodeIntegration: false
        }
    });

    // TODO: load a page that can obtain the MediaStream for opts.streamKey.
    // Option 1: win.loadURL("https://discord.com/popout/...") style in-client route.
    // Option 2: bundled popout.html that talks to the media engine over IPC.
    void join(__dirname, "popout.html");

    windows.set(opts.streamKey, win);
    win.on("closed", () => windows.delete(opts.streamKey));
}

export function closeAll() {
    for (const w of windows.values()) if (!w.isDestroyed()) w.close();
    windows.clear();
}
