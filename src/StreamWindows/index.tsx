/*
 * StreamWindows — Vencord user plugin (discovery build 3)
 *
 * Mapped:
 *   popoutModule.open(key, render, features)   -> POPOUT_WINDOW_OPEN  (custom keys REJECTED:
 *                                                  unknown key opens discord.com/popout in browser)
 *   popoutModule.close(key)                    -> POPOUT_WINDOW_CLOSE
 *   popoutModule.setAlwaysOnTop(key, bool)     -> POPOUT_WINDOW_SET_ALWAYS_ON_TOP
 *   popoutModule.openCallTilePopout(cid, pid)  -> CALL_TILE_POPOUT_WINDOW_OPEN  (registered! renders
 *                                                  a participant's stream/video tile in a real window)
 *   popoutModule.openChannelCallPopout(chan)   -> CHANNEL_CALL_POPOUT_WINDOW_OPEN
 *   PopoutWindowStore: getWindowKeys/getWindow/getIsAlwaysOnTop/isWindowFullScreen/getState/...
 *   ApplicationStreamingStore: getAllApplicationStreams/getActiveStreamForUser/getViewerIds/...
 *
 * THE question this build answers: does openCallTilePopout make ONE window per
 * (channelId, participantId), or a single shared one? -> $sw.popTile / $sw.popAll
 *
 * Console helpers: window.$sw
 * Chat command: /streamwindows-discover
 */

import definePlugin from "@utils/types";
import { find, findByCode, findByProps, findComponentByCode, findStore } from "@webpack";
import { React } from "@webpack/common";

const TAG = "%c[StreamWindows]";
const CSS = "color:#5865F2;font-weight:bold";
const log = (...a: any[]) => console.log(TAG, CSS, ...a);

const fnSrc = (f: any, n = 4000) => {
    try { return typeof f === "function" ? String(f).slice(0, n) : `<not a fn: ${typeof f}>`; }
    catch (e: any) { return `<toString threw: ${e?.message}>`; }
};
const methodsOf = (o: any) => {
    try {
        const proto = o && Object.getPrototypeOf(o);
        const pm = proto && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : [];
        return [...new Set([...Object.getOwnPropertyNames(o), ...pm])].filter(k => k !== "constructor");
    } catch { return []; }
};
const shallow = (o: any) => {
    const out: Record<string, any> = {};
    if (!o || typeof o !== "object") return o;
    for (const k in o) {
        try {
            const v = o[k];
            out[k] = v && typeof v === "object" ? `[${v.constructor?.name || "obj"}]` : v;
        } catch { out[k] = "<throws>"; }
    }
    return out;
};

const getPopout = () =>
    findByProps("open", "setAlwaysOnTop", "openCallTilePopout") ?? findByProps("open", "setAlwaysOnTop");
const ASS = () => findStore("ApplicationStreamingStore") as any;
const PWS = () => findStore("PopoutWindowStore") as any;

function streams() {
    const s = ASS()?.getAllApplicationStreams?.() ?? [];
    s.forEach((st: any, i: number) => log(`stream[${i}]`, shallow(st)));
    return s;
}

function popTile(channelId: string, participantId: string) {
    const P: any = getPopout();
    log("openCallTilePopout(", channelId, ",", participantId, ")");
    P?.openCallTilePopout?.(channelId, participantId);
    setTimeout(() => log("  → getWindowKeys():", PWS()?.getWindowKeys?.(), "| state keys:", Object.keys(PWS()?.getState?.() ?? {})), 900);
}

/** open a tile popout for every application stream; report how many windows result */
function popAll() {
    const s = streams();
    const P: any = getPopout();
    for (const st of s) {
        const cid = st.channelId ?? st.channel_id;
        const pid = st.ownerId ?? st.userId ?? st.user_id ?? st.streamerId;
        log("  popping", { cid, pid });
        P?.openCallTilePopout?.(cid, pid);
    }
    setTimeout(() => {
        const keys = PWS()?.getWindowKeys?.() ?? [];
        log(`RESULT: ${keys.length} popout window(s):`, keys);
        keys.forEach((k: string) => log("  ", k, shallow(PWS()?.getWindow?.(k))));
    }, 1500);
}

function popChannel(channelOrId: any) {
    const P: any = getPopout();
    P?.openChannelCallPopout?.(channelOrId);
    setTimeout(() => log("  → getWindowKeys():", PWS()?.getWindowKeys?.()), 900);
}

function closeKey(key: string) { getPopout()?.close?.(key); log("close", key); }
function closeAllPopouts() {
    const keys = PWS()?.getWindowKeys?.() ?? [];
    keys.forEach((k: string) => getPopout()?.close?.(k));
    log("closed", keys);
}

function discover() {
    log("=== discovery build 3 ===");
    const P: any = getPopout();
    log("popout module methods:", P ? methodsOf(P).join(", ") : "NOT FOUND");

    // who handles CALL_TILE_POPOUT_WINDOW_OPEN -> tells us the per-window key scheme
    for (const code of ["CALL_TILE_POPOUT_WINDOW_OPEN", "CALL_TILE_POPOUT", "CHANNEL_CALL_POPOUT"]) {
        try {
            const m: any = findByCode(code);
            log(`findByCode(${JSON.stringify(code)}) →`, m ? (m.name || methodsOf(m).slice(0, 15).join(",")) : "null");
            if (m) log("  src:\n" + fnSrc(m, 2500));
        } catch (e: any) { log(`findByCode(${code}) threw`, e?.message); }
    }

    log("PopoutWindowStore.getState() →", PWS()?.getState?.());
    log("PopoutWindowStore.getWindowKeys() →", PWS()?.getWindowKeys?.());

    log("--- current application streams ---");
    streams();

    log("=== end. Try: $sw.popAll()  (watch how many windows open) ===");
}

export default definePlugin({
    name: "StreamWindows",
    description: "Pop each watched stream into its own OS window (discovery build 3).",
    authors: [{ name: "theta", id: 0n } as any],
    commands: [
        {
            name: "streamwindows-discover",
            description: "StreamWindows: dump discovery to console",
            execute: () => { discover(); return { content: "→ console. Then run $sw.popAll()" }; }
        }
    ],
    start() {
        (window as any).$sw = {
            discover, streams, popTile, popAll, popChannel, closeKey, closeAllPopouts,
            getPopout, ASS, PWS,
            components: {
                streamIdOnReady: () => findComponentByCode("streamId", "onReady"),
                videoStream: () => findComponentByCode("VideoStream")
            }
        };
        setTimeout(discover, 2000);
        log("helpers on window.$sw");
    }
});
