/*
 * StreamWindows — BetterDiscord adapter.
 *
 * All behaviour lives in ../core/streamwindows.ts; this file only maps BdApi
 * onto the Platform interface and renders MenuEntry rows via
 * BdApi.ContextMenu.buildItem. Keep logic OUT of here.
 *
 * Built by scripts/build-bd.mjs into dist/StreamWindows.plugin.js.
 */

import { createStreamWindows } from "../core/streamwindows";
import type { MenuEntry, Platform } from "../core/platform";

declare const BdApi: any;
// BD evaluates plugin files as CommonJS and reads the plugin class off exports.
declare const module: { exports: any; };

const W = () => BdApi.Webpack;
const F = () => BdApi.Webpack.Filters;

const platform: Platform = {
    getByProps: (...props) => W().getByKeys(...props),
    // BD's byStrings matches module source, same idea as Vencord's findByCode.
    // searchExports is needed for bare function exports like the watch thunk.
    getByCode: (...code) => W().getModule(F().byStrings(...code), { searchExports: true }),
    getStore: name => W().getStore(name),
    find: filter => W().getModule(filter, { searchExports: true }),
    log: (...a) => console.log("%c[StreamWindows]", "color:#5865F2;font-weight:bold", ...a)
};

const sw = createStreamWindows(platform);

const NAV_IDS = ["user-context", "stream-context"];

function renderEntry(e: MenuEntry) {
    return BdApi.ContextMenu.buildItem({
        type: "text",
        id: e.id,
        label: e.label,
        disabled: e.disabled,
        danger: e.danger,
        action: e.action
    });
}

/**
 * BD hands the patch callback the menu's rendered tree, whose `children` shape
 * varies by menu (array, nested array, or a single element). Find the outermost
 * array we can append to.
 */
function childrenArrayOf(tree: any): any[] | null {
    const kids = tree?.props?.children;
    if (Array.isArray(kids)) return kids;
    if (kids && tree?.props) {
        tree.props.children = [kids];
        return tree.props.children;
    }
    return null;
}

const unpatchers: Array<() => void> = [];

module.exports = class StreamWindows {
    start() {
        for (const navId of NAV_IDS) {
            const unpatch = BdApi.ContextMenu.patch(navId, (tree: any, props: any) => {
                let entries: MenuEntry[] = [];
                try { entries = sw.menuEntriesFor(props); }
                catch (e: any) { platform.log("menuEntriesFor threw", e?.message); }
                if (!entries.length) return;

                const kids = childrenArrayOf(tree);
                if (!kids) return platform.log("could not find menu children to append to");

                kids.push(BdApi.ContextMenu.buildItem({
                    type: "group",
                    children: entries.map(renderEntry)
                }));
            });
            if (typeof unpatch === "function") unpatchers.push(unpatch);
        }

        sw.start();
        (window as any).$sw = sw.debug;
    }

    stop() {
        while (unpatchers.length) {
            try { unpatchers.pop()!(); } catch { /* already gone */ }
        }
        sw.stop();
        delete (window as any).$sw;
    }
};
