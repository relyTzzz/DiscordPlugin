/*
 * StreamWindows — probe #2: find Discord's internal popout / second-window API.
 *
 * Raw window.open() is denied in Discord's renderer (probe #1 result), but
 * Discord itself opens separate OS windows for stream pop-out, PiP, and
 * tear-off popups. This locates the module(s) that do it.
 *
 * Run in the Discord DevTools console (while watching a stream is ideal but not
 * required). Paste the whole [probe] output back.
 */
(() => {
  const log = (...a) => console.log("%c[probe]", "color:#5865F2;font-weight:bold", ...a);
  const short = o => {
    try { return (typeof o === "object" || typeof o === "function")
      ? Object.keys(o).slice(0, 40) : String(o); } catch { return "<throws>"; }
  };

  // 1. is window.open wrapped?
  log("window.open =", String(window.open).slice(0, 300));
  log("window.open native?", String(window.open).includes("[native code]"));

  // 2. DiscordNative surface
  try { log("DiscordNative.window:", short(DiscordNative.window)); } catch (e) { log("DiscordNative.window err", e); }
  try { log("DiscordNative keys:", short(DiscordNative)); } catch {}

  // 3. bootstrap webpack require
  let req;
  try {
    (window.webpackChunkdiscord_app = window.webpackChunkdiscord_app || [])
      .push([[Symbol("swprobe")], {}, r => (req = r)]);
  } catch (e) { return log("webpack bootstrap failed:", e); }
  if (!req || !req.c) return log("no webpack module cache");
  log("modules in cache:", Object.keys(req.c).length);

  // 4. scan for popout / second-window / always-on-top modules
  const RX = /popout|PopOut|Popout|AlwaysOnTop|renderWindow|externalWindow|streamPopout|windowKey/i;
  const hits = [];
  for (const id in req.c) {
    const ex = req.c[id] && req.c[id].exports;
    if (!ex) continue;
    for (const o of [ex, ex.default, ex.Z, ex.ZP, ex.__esModule ? ex : null].filter(Boolean)) {
      let keys;
      try { keys = (typeof o === "object" || typeof o === "function") ? Object.keys(o) : null; }
      catch { continue; }
      if (!keys || !keys.length) continue;
      const name = (o.displayName || o.name || "");
      if (RX.test(keys.join(",")) || RX.test(name)) {
        hits.push({ id, name, keys: keys.slice(0, 40) });
      }
    }
  }
  log("popout-ish modules:", hits.length);
  hits.forEach(h => log("  #" + h.id, h.name || "", "→", h.keys.join(", ")));

  // 5. specifically look for the stream-popout opener (function names / stores)
  const RX2 = /open.*[Pp]opout|[Pp]opout.*open|setPopout|PopoutWindowStore|PopoutWindowActionCreators/;
  const named = [];
  for (const id in req.c) {
    const ex = req.c[id] && req.c[id].exports;
    if (!ex) continue;
    for (const o of [ex, ex.default, ex.Z, ex.ZP].filter(Boolean)) {
      try {
        for (const k of Object.keys(o)) {
          if (typeof o[k] === "function" && RX2.test(k)) named.push({ id, prop: k });
        }
      } catch {}
    }
  }
  log("popout opener fns:", named);

  log("done — copy everything above.");
})();
