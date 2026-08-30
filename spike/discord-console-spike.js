/*
 * StreamWindows — feasibility spike
 * ================================
 * Question this answers: can a live Discord stream's pixels be rendered in a
 * SEPARATE OS window (that you can drag to another monitor) without the frame
 * going black / stalling?
 *
 * How to run (no Vencord required):
 *   1. Enable DevTools in Discord:
 *        - If you run Vencord/BetterDiscord: Ctrl+Shift+I already works.
 *        - Stock Discord: close Discord, edit
 *          %APPDATA%\discord\settings.json  and add:
 *            "DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING": true
 *          then reopen Discord and press Ctrl+Shift+I.
 *   2. Join a voice channel and START WATCHING someone's stream (Go Live).
 *   3. Paste this whole file into the DevTools Console tab, hit Enter.
 *   4. Read the [spike] log lines. Drag the popped window to a 2nd monitor.
 *
 * Cleanup: run  __spike.close()  in the console.
 *
 * Two transport modes are tried automatically:
 *   A) "passthrough" — assign the element's own MediaStream (srcObject) straight
 *      into a <video> in the child window. No re-encode, full quality. Only works
 *      if the child window shares the renderer process (Electron about:blank child
 *      usually does).
 *   B) "capture"     — video.captureStream(): re-captures frames into a new
 *      MediaStream. Survives more boundaries but costs a re-encode.
 * If A stalls within ~4s we auto-fall back to B and log which one won.
 */

(() => {
  const TAG = "%c[spike]";
  const CSS = "color:#5865F2;font-weight:bold";
  const log = (...a) => console.log(TAG, CSS, ...a);
  const warn = (...a) => console.warn(TAG, CSS, ...a);

  if (window.__spike) {
    warn("previous spike still open — closing it first");
    try { window.__spike.close(); } catch {}
  }

  // ---- 1. locate the stream video element -------------------------------------
  const candidates = [...document.querySelectorAll("video")]
    .filter(v => v.srcObject instanceof MediaStream && v.videoWidth > 0 && !v.paused)
    .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight);

  if (!candidates.length) {
    return warn(
      "No playing stream <video> found.\n" +
      "Make sure you are actively WATCHING a stream (not just in the channel), " +
      "then re-run."
    );
  }
  const srcVideo = candidates[0];
  const srcStream = srcVideo.srcObject;
  log(`source video ${srcVideo.videoWidth}x${srcVideo.videoHeight}`,
      "tracks:", srcStream.getTracks().map(t => `${t.kind}:${t.readyState}`), srcVideo);

  // ---- 2. open a real child window ------------------------------------------
  const child = window.open(
    "about:blank",
    "streamwindows_spike",
    "width=960,height=540"
  );
  if (!child) return warn("window.open() returned null (blocked). Spike cannot proceed.");

  child.document.title = "StreamWindows spike";
  const d = child.document;
  d.body.style.cssText = "margin:0;background:#000;overflow:hidden;font:12px system-ui;color:#8f9;";
  const v = d.createElement("video");
  v.autoplay = true; v.muted = true; v.playsInline = true;
  v.style.cssText = "width:100vw;height:100vh;object-fit:contain;background:#000";
  d.body.appendChild(v);
  const hud = d.createElement("div");
  hud.style.cssText = "position:fixed;left:6px;top:6px;padding:2px 6px;background:#000a;border-radius:4px";
  d.body.appendChild(hud);
  const setHud = t => (hud.textContent = t);

  // ---- 3. try passthrough, watchdog, fall back to capture -------------------
  let captureStream = null;
  const attach = (mode, stream) => {
    v.srcObject = stream;
    v.play().then(
      () => log(`attached (${mode}) and play() resolved`),
      e => warn(`attach (${mode}) play() rejected:`, e)
    );
  };

  attach("passthrough", srcStream);

  let last = -1, stalls = 0, mode = "passthrough", settled = false;
  const iv = child.setInterval(() => {
    const t = +v.currentTime.toFixed(2);
    const painting = t !== last;
    last = t;

    if (painting) {
      stalls = 0;
      if (!settled) {
        settled = true;
        log(`✅ RENDERING in child window via "${mode}". ` +
            `Drag the window to another monitor and confirm it keeps moving.`);
      }
      setHud(`${mode}  t=${t}  ${v.videoWidth}x${v.videoHeight}`);
      return;
    }

    stalls++;
    setHud(`${mode}  STALLED (${stalls})  t=${t}`);
    if (stalls === 4 && mode === "passthrough") {
      warn('passthrough stalled — falling back to video.captureStream()');
      try {
        captureStream = srcVideo.captureStream
          ? srcVideo.captureStream()
          : srcVideo.mozCaptureStream();
        mode = "capture";
        settled = false;
        attach("capture", captureStream);
      } catch (e) {
        warn("captureStream() threw:", e);
      }
    }
    if (stalls === 10) {
      warn(`still stalled after fallback — mode "${mode}". ` +
           `This transport does NOT survive into a separate window on this build.`);
    }
  }, 1000);

  child.addEventListener("beforeunload", () => child.clearInterval(iv));

  // ---- 4. handle ---------------------------------------------------------
  window.__spike = {
    child, srcVideo, srcStream,
    get mode() { return mode; },
    close() {
      try { child.clearInterval(iv); } catch {}
      try { captureStream && captureStream.getTracks().forEach(t => t.stop()); } catch {}
      try { child.close(); } catch {}
      delete window.__spike;
      log("spike closed");
    }
  };
  log('handle ready: __spike.mode , __spike.close()');
})();
