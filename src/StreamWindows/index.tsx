/*
 * StreamWindows — Vencord adapter.
 *
 * All behaviour lives in ../core/streamwindows.ts; this file only maps Vencord's
 * APIs onto the Platform interface and renders MenuEntry rows as Vencord menu
 * components. The BetterDiscord build (src/bd/entry.ts) does the same against
 * BdApi. Keep logic OUT of here so both stay in sync.
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { find, findByCode, findByProps, findStore } from "@webpack";
import { Menu } from "@webpack/common";

import { createStreamWindows } from "../core/streamwindows";
import type { Platform } from "../core/platform";

const platform: Platform = {
    getByProps: (...p) => findByProps(...p),
    getByCode: (...c) => findByCode(...c),
    getStore: name => findStore(name),
    find: filter => find(filter),
    log: (...a) => console.log("%c[StreamWindows]", "color:#5865F2;font-weight:bold", ...a)
};

const sw = createStreamWindows(platform);

const NAV_IDS = ["user-context", "stream-context"];

const patch: NavContextMenuPatchCallback = (children, props) => {
    const entries = sw.menuEntriesFor(props);
    if (!entries.length) return;

    children.push(
        <Menu.MenuGroup label="StreamWindows">
            {entries.map(e => (
                <Menu.MenuItem
                    key={e.id}
                    id={e.id}
                    label={e.label}
                    disabled={e.disabled}
                    color={e.danger ? "danger" : undefined}
                    action={e.action}
                />
            ))}
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "StreamWindows",
    description: "Right-click a streamer in voice → pop their stream into its own OS window (multi-monitor).",
    authors: [{ name: "Cranium AI", id: 0n } as any],
    commands: [
        {
            name: "streamwindows",
            description: "Pop out every stream in your current voice channel",
            execute: () => {
                sw.popAllInConnectedChannel();
                return { content: "popping all streams…" };
            }
        },
        {
            name: "streamwindows-discover",
            description: "StreamWindows: dump module discovery to console",
            execute: () => {
                sw.discover();
                return { content: "→ console" };
            }
        }
    ],
    start() {
        addContextMenuPatch(NAV_IDS, patch);
        sw.start();
        (window as any).$sw = sw.debug;
    },
    stop() {
        removeContextMenuPatch(NAV_IDS, patch);
        sw.stop();
        delete (window as any).$sw;
    }
});
