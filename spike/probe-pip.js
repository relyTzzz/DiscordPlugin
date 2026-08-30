/*
 * StreamWindows — probe #3: Document Picture-in-Picture as the stream window.
 *
 * Leads from probe #2:
 *   - window.open is native (main-process handler vetoed about:blank, not a JS wrap)
 *   - DiscordNative.window.openDocumentPip exists -> Chrome Document PiP is available
 *
 * Document PiP gives a real, movable, separate OS window in the SAME renderer
 * document, so assigning video.srcObject straight across should work with no
 * re-encode.
 *
 * requestWindow() needs a real user gesture, so this script injects buttons.
 * Run it, then:
 *   1. Start watching a stream.
 *   2. Click "PiP the stream" (bottom-left). Confirm video plays; drag window to
 *      another monitor; confirm it keeps moving.
 *   3. Click "PiP #2" — does a SECOND PiP window open, or does it throw / reuse
 *      the first? This answers whether N-windows is possible via Document PiP.
 * Cleanup: __pipCleanup()
 */
(() => {
  const log = (...a) => console.log("%c[probe3]", "color:#5865F2;font-weight:bold", ...a);

  log("window.documentPictureInPicture:", typeof window.documentPictureInPicture,
      window.documentPictureInPicture);
  try { log("openDocumentPip =", String(DiscordNative.window.openDocumentPip)); } catch {}

  const pips = [];
  const streamVideo = () =>
    [...document.querySelectorAll("video")]
      .filter(v => v.srcObject instanceof MediaStream && v.videoWidth > 0 && !v.paused)
      .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0] || null;

  async function pip(tag) {
    const src = streamVideo();
    if (!src) return log(tag, "no playing stream <video> — start watching a stream");
    log(tag, `source ${src.videoWidth}x${src.videoHeight}`);
    if (!window.documentPictureInPicture) return log(tag, "Document PiP API absent");
    try {
      const w = await window.documentPictureInPicture.requestWindow({ width: 960, height: 540 });
      log(tag, "✅ requestWindow resolved", w);
      w.document.title = "StreamWindows " + tag;
      w.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
      const v = w.document.createElement("video");
      v.autoplay = v.muted = v.playsInline = true;
      v.style.cssText = "width:100vw;height:100vh;object-fit:contain";
      v.srcObject = src.srcObject;                 // passthrough, same document
      w.document.body.appendChild(v);
      await v.play().then(() => log(tag, "play() ok")).catch(e => log(tag, "play() err", e));
      let last = -1, n = 0;
      const iv = w.setInterval(() => {
        const t = +v.currentTime.toFixed(2);
        log(tag, t !== last ? `painting t=${t} ${v.videoWidth}x${v.videoHeight}` : `STALLED t=${t}`);
        last = t;
        if (++n > 8) w.clearInterval(iv);
      }, 1000);
      pips.push(w);
      window.__pips = pips;
    } catch (e) {
      log(tag, "requestWindow threw:", e && e.name, e && e.message, e);
    }
  }

  const mkBtn = (text, bottom, fn) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.dataset.swProbe = "1";
    b.style.cssText =
      `position:fixed;z-index:99999;left:16px;bottom:${bottom}px;padding:10px 14px;` +
      "background:#5865F2;color:#fff;border:0;border-radius:8px;font:14px system-ui;cursor:pointer";
    b.onclick = fn;
    document.body.appendChild(b);
    return b;
  };
  document.querySelectorAll('[data-sw-probe]').forEach(e => e.remove());
  mkBtn("▶ PiP the stream", 16, () => pip("PiP#1"));
  mkBtn("▶ PiP #2 (multi test)", 60, () => pip("PiP#2"));

  window.__pipCleanup = () => {
    pips.forEach(w => { try { w.close(); } catch {} });
    pips.length = 0;
    document.querySelectorAll('[data-sw-probe]').forEach(e => e.remove());
    log("cleaned up");
  };
  log("buttons injected bottom-left. __pipCleanup() to remove.");
})();
