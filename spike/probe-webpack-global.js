/*
 * StreamWindows — probe #5: find Discord's real webpack chunk global.
 *
 * probe #4 accidentally created its own empty runtime (webpackChunkdiscord_app
 * was undefined, so `|| []` made a fresh one -> only 102 modules). This finds
 * the actual one WITHOUT clobbering anything.
 *
 * Paste all [probe5] output.
 */
(() => {
  const log = (...a) => console.log("%c[probe5]", "color:#5865F2;font-weight:bold", ...a);
  const keysOf = o => { try { return Object.keys(o); } catch { return []; } };

  // client-mod globals (easy path if present)
  for (const g of ["Vencord", "BdApi", "powercord", "replugged", "BetterDiscord"]) {
    log(`window.${g}:`, g in window ? "PRESENT " + keysOf(window[g]).slice(0, 20).join(",") : "absent");
  }

  // every global that smells like webpack
  const wpKeys = Object.getOwnPropertyNames(window).filter(k => /webpack|chunk|wreq|__d|jsonp/i.test(k));
  log("webpack-ish window keys:", wpKeys);
  for (const k of wpKeys) {
    let v;
    try { v = window[k]; } catch { log(`  ${k}: <throws>`); continue; }
    const t = Array.isArray(v) ? `array(len=${v.length})` : typeof v;
    log(`  ${k}: ${t}`);
    if (Array.isArray(v) && v.length) {
      try { log(`    [0] shape:`, Array.isArray(v[0]) ? `tuple(${v[0].length})` : typeof v[0], v[0]); } catch {}
    }
  }

  // try the canonical hook against whatever chunk arrays exist
  for (const k of wpKeys) {
    let arr;
    try { arr = window[k]; } catch { continue; }
    if (!Array.isArray(arr) || typeof arr.push !== "function") continue;
    try {
      let req;
      arr.push([[Symbol("p5_" + k)], {}, r => (req = r)]);
      if (req && req.c) {
        const n = Object.keys(req.c).length;
        log(`hooked ${k} -> module cache size ${n}`);
        if (n > 500) {
          window.__wpreq = req;
          log(`  ✅ real registry. saved as window.__wpreq (${n} modules)`);
        }
      } else {
        log(`hooked ${k} -> no req.c`);
      }
    } catch (e) { log(`push into ${k} threw:`, e.message); }
  }

  // fallbacks
  for (const g of ["__webpack_require__", "webpackJsonp", "require"]) {
    log(`window.${g}:`, g in window ? typeof window[g] : "absent");
  }
  log("done.");
})();
