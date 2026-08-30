/*
 * StreamWindows — Vencord user plugin
 * Goal: pop each watched Discord stream into its own OS window for multi-monitor
 * viewing.
 *
 * This build is DISCOVERY ONLY. Console probing (see ../../spike) established:
 *   - PopoutWindowStore opens real OS windows positioned on any monitor
 *     (log: `Opening popout window {key, encodedFeatures:'...left=1920,top=601'}`)
 *   - stream frames ride a native per-streamId "direct frames" bus that already
 *     serves multiple concurrent consumers (`count for stream: 2`)
 *   - DirectVideo is the component that renders a stream by id
 *     (logs: `[DirectVideo] attaching srcObject for <id>`)
 *
 * On start (and via the "StreamWindows: re-run discovery" command) this resolves
 * those modules with Vencord's finders and dumps their shape / source so we can
 * write the real opener next. Open a stream + a native popout first so the lazy
 * chunks are loaded.
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { find, findByCode, findByProps, findStore } from "@webpack";

const TAG = "%c[StreamWindows]";
const CSS = "color:#5865F2;font-weight:bold";
const log = (...a: any[]) => console.log(TAG, CSS, ...a);

const settings = definePluginSettings({
    verboseDiscovery: {
        type: OptionType.BOOLEAN,
        description: "Dump full module source during discovery (long)",
        default: true
    }
});

function summarize(o: any): string {
    try {
        if (o == null) return String(o);
        if (typeof o === "function") return `fn ${o.name || "(anon)"} arity=${o.length}`;
        const keys = Object.keys(o);
        return `obj{${keys.slice(0, 50).join(", ")}${keys.length > 50 ? ", …" : ""}}`;
    } catch (e: any) {
        return `<summarize threw: ${e?.message}>`;
    }
}

function src(o: any, n = 1600): string {
    try {
        const f = typeof o === "function" ? o : o?.open ?? o?.render ?? o?.default;
        return typeof f === "function" ? String(f).slice(0, n) : "<no fn to stringify>";
    } catch (e: any) {
        return `<toString threw: ${e?.message}>`;
    }
}

function q(label: string, fn: () => any) {
    let r: any;
    try {
        r = fn();
    } catch (e: any) {
        log(label, "→ THREW", e?.message);
        return;
    }
    if (!r) {
        log(label, "→ null");
        return;
    }
    log(label, "→", summarize(r));
    if (settings.store.verboseDiscovery) log(label, "source:\n" + src(r));
}

function discover() {
    log("=== discovery start ===");

    // ---- PopoutWindowStore + its action creators ------------------------
    q('findStore("PopoutWindowStore")', () => {
        const s: any = findStore("PopoutWindowStore");
        if (s) {
            const proto = Object.getPrototypeOf(s);
            log("  store methods:", [...Object.keys(s), ...Object.keys(proto)].join(", "));
            for (const m of ["getWindowKeys", "getWindow", "getWindowOpen", "getState"]) {
                try { log(`  ${m}() →`, s[m]?.()); } catch (e: any) { log(`  ${m}() threw`, e?.message); }
            }
        }
        return s;
    });

    q('findByCode("Opening popout window")', () => findByCode("Opening popout window"));
    q('findByProps("open","setAlwaysOnTop")', () => findByProps("open", "setAlwaysOnTop"));
    q('findByProps("open","setBounds")', () => findByProps("open", "setBounds"));
    q('findByProps("open","close","renderWindow")', () => findByProps("open", "close", "renderWindow"));
    q('findByProps("PopoutWindow")', () => findByProps("PopoutWindow"));
    q('findByProps("setAlwaysOnTop","setBounds")', () => findByProps("setAlwaysOnTop", "setBounds"));

    // ---- stream video component / direct-frames api ---------------------
    q('findByProps("DirectVideo")', () => findByProps("DirectVideo"));
    q('findByCode("attaching srcObject for")', () => findByCode("attaching srcObject for"));
    q('findByCode("direct frames for streamId")', () => findByCode("direct frames for streamId"));
    q('findByCode("Subscribing to direct frames")', () => findByCode("Subscribing to direct frames"));
    q('find(m => m?.render && /DirectVideo/.test(String(m.render)))',
        () => find((m: any) => m?.render && /DirectVideo/.test(String(m.render))));

    // ---- stream state stores (to enumerate streams / build stream keys) --
    q('findStore("ApplicationStreamingStore")', () => findStore("ApplicationStreamingStore"));
    q('findByProps("getAllApplicationStreams")', () => findByProps("getAllApplicationStreams"));
    q('findByProps("getStreamForUser")', () => findByProps("getStreamForUser"));
    q('findByProps("encodeStreamKey","decodeStreamKey")', () => findByProps("encodeStreamKey", "decodeStreamKey"));

    log("=== discovery end === (paste everything above)");
}

export default definePlugin({
    name: "StreamWindows",
    description: "Pop each watched stream into its own OS window (discovery build).",
    authors: [{ name: "theta", id: 0n } as any],
    settings,
    commands: [
        {
            name: "streamwindows-discover",
            description: "StreamWindows: re-run module discovery",
            execute: () => {
                discover();
                return { content: "StreamWindows discovery logged to console (Ctrl+Shift+I)." };
            }
        }
    ],
    start() {
        // slight delay so lazy chunks from an already-open stream are present
        setTimeout(discover, 2000);
    }
});
