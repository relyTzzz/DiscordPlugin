/*
 * StreamWindows — Vencord user plugin (discovery build 2)
 *
 * Established so far (see ../../spike + discovery build 1):
 *   - Popout module (findByProps "open","setAlwaysOnTop"):
 *       open(key, render, features)  -> dispatch POPOUT_WINDOW_OPEN
 *       also: close, setAlwaysOnTop, openCallTilePopout, openChannelCallPopout,
 *             addStylesheet
 *   - PopoutWindowStore: getWindowKeys(), getWindow(key), getWindowOpen(), getState()
 *   - ApplicationStreamingStore resolves (enumerate streams / stream keys)
 *   - stream frames ride a native per-streamId "direct frames" bus, multi-consumer
 *     (log: "[DirectVideo] attaching srcObject for N" / "count for stream: 2")
 *
 * Still needed: the stream <video> component to render inside our window, and how
 * a stream key maps to it. This build reads openCallTilePopout / openChannelCallPopout
 * source to find that, and gives console helpers to actually open a test window.
 *
 * Console: window.$sw.discover()  /  $sw.testWindow()  /  $sw.closeTest()
 * Chat command: /streamwindows-discover   (type in a channel, NOT devtools)
 */

import { Devs } from "@utils/constants";
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
        const own = Object.getOwnPropertyNames(o);
        const proto = o && Object.getPrototypeOf(o);
        const pm = proto && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : [];
        return [...new Set([...own, ...pm])].filter(k => k !== "constructor");
    } catch { return []; }
};
const tryCall = (label: string, fn: () => any) => {
    try { log(label, "→", fn()); } catch (e: any) { log(label, "THREW", e?.message); }
};

// ---------------------------------------------------------------------------

function getPopoutModule() {
    return findByProps("open", "setAlwaysOnTop", "openCallTilePopout")
        ?? findByProps("open", "setAlwaysOnTop");
}

function discover() {
    log("=== discovery build 2 ===");

    const P: any = getPopoutModule();
    log("popout module:", P ? methodsOf(P).join(", ") : "NOT FOUND");
    if (P) {
        for (const m of ["open", "close", "setAlwaysOnTop", "openCallTilePopout", "openChannelCallPopout", "addStylesheet"]) {
            log(`  ${m}():\n` + fnSrc(P[m]));
        }
    }

    const PWS: any = findStore("PopoutWindowStore");
    log("PopoutWindowStore:", PWS ? "ok" : "NOT FOUND", PWS && methodsOf(PWS).join(", "));
    if (PWS) {
        tryCall("  getWindowKeys()", () => PWS.getWindowKeys?.());
        tryCall("  getState()", () => PWS.getState?.());
    }

    const ASS: any = findStore("ApplicationStreamingStore");
    log("ApplicationStreamingStore:", ASS ? "ok" : "NOT FOUND", ASS && methodsOf(ASS).join(", "));
    if (ASS) {
        tryCall("  getAllApplicationStreams()", () => ASS.getAllApplicationStreams?.());
        tryCall("  getAllActiveStreams()", () => ASS.getAllActiveStreams?.());
        tryCall("  getCurrentUserActiveStream()", () => ASS.getCurrentUserActiveStream?.());
    }

    // stream key encode/decode
    log("stream key utils:");
    for (const probe of [
        ["findByProps('encodeStreamKey')", () => findByProps("encodeStreamKey")],
        ["findByProps('getStreamKey')", () => findByProps("getStreamKey")],
        ["findByCode('\"guild\",') keyish", () => findByCode('"guild:"')],
    ] as const) {
        try { const r = probe[1](); log("  " + probe[0], "→", r ? methodsOf(r).join(",") : "null"); }
        catch (e: any) { log("  " + probe[0], "threw", e?.message); }
    }

    // the stream video component
    log("stream video component candidates:");
    for (const probe of [
        ["findByCode('handleReady for')", () => findByCode("handleReady for")],
        ["findByCode('spinner visible for')", () => findByCode("spinner visible for")],
        ["findByCode('attaching srcObject')", () => findByCode("attaching srcObject")],
        ["findComponentByCode('streamId','onReady')", () => findComponentByCode("streamId", "onReady")],
        ["findComponentByCode('VideoStream')", () => findComponentByCode("VideoStream")],
        ["findByProps('VideoStream')", () => findByProps("VideoStream")],
        ["find(m=>m?.displayName?.includes('DirectVideo'))",
            () => find((m: any) => typeof m?.displayName === "string" && m.displayName.includes("DirectVideo"))],
    ] as const) {
        try {
            const r: any = probe[1]();
            log("  " + probe[0], "→", r
                ? (r.displayName || r.name || methodsOf(r).slice(0, 20).join(","))
                : "null");
        } catch (e: any) { log("  " + probe[0], "threw", e?.message); }
    }

    log("=== end. also: $sw.testWindow() opens a blank test popout ===");
    return P;
}

let testKey = "STREAMWINDOWS_TEST";
function testWindow(features?: Record<string, any>) {
    const P: any = getPopoutModule();
    if (!P?.open) return log("no popout module");
    const feats = { width: 640, height: 360, left: 120, top: 120, ...features };
    log("open(", testKey, ", <render>,", feats, ")");
    P.open(
        testKey,
        () => React.createElement(
            "div",
            { style: { width: "100%", height: "100%", background: "#101018", color: "#8f9", display: "flex", alignItems: "center", justifyContent: "center", font: "16px system-ui" } },
            "StreamWindows test window — " + new Date().toLocaleTimeString()
        ),
        feats
    );
    setTimeout(() => {
        const PWS: any = findStore("PopoutWindowStore");
        log("after open, getWindowKeys() →", PWS?.getWindowKeys?.());
    }, 500);
}
function closeTest() {
    const P: any = getPopoutModule();
    P?.close?.(testKey);
    log("closed", testKey);
}
function setTestAlwaysOnTop(v: boolean) {
    const P: any = getPopoutModule();
    P?.setAlwaysOnTop?.(testKey, v);
    log("setAlwaysOnTop", testKey, v);
}

export default definePlugin({
    name: "StreamWindows",
    description: "Pop each watched stream into its own OS window (discovery build 2).",
    authors: [{ name: "theta", id: 0n } as any],
    commands: [
        {
            name: "streamwindows-discover",
            description: "StreamWindows: dump module discovery to console",
            execute: () => {
                discover();
                return { content: "StreamWindows discovery → console (Ctrl+Shift+I). Also try $sw.testWindow()" };
            }
        }
    ],
    start() {
        (window as any).$sw = { discover, testWindow, closeTest, setTestAlwaysOnTop, getPopoutModule };
        setTimeout(discover, 2000);
        log("helpers on window.$sw");
    }
});
