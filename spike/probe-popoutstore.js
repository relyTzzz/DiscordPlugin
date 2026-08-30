/*
 * StreamWindows — probe #4: map PopoutWindowStore + DirectVideo.
 *
 * From the native-popout logs we know:
 *   [PopoutWindowStore] Opening popout window {key, encodedFeatures: '...left=1920,top=601'}
 *   [DirectVideo] attaching srcObject for <streamId>
 *   Subscribing to direct frames for streamId <n>   ("count for stream: 2" => multi-consumer OK)
 *
 * Goal: find the webpack handles to (a) open a popout window with a custom render,
 * (b) render a stream's video by streamId inside it.
 *
 * Run AFTER you've opened a native popout at least once this session (so the
 * chunks are loaded). Paste all [probe4] output.
 */
(() => {
  const log = (...a) => console.log("%c[probe4]", "color:#5865F2;font-weight:bold", ...a);
  const keysOf = o => { try { return Object.keys(o); } catch { return []; } };
  const isObjFn = o => o && (typeof o === "object" || typeof o === "function");

  // ---- bootstrap webpack -------------------------------------------------
  let req;
  (window.webpackChunkdiscord_app = window.webpackChunkdiscord_app || [])
    .push([[Symbol("p4")], {}, r => (req = r)]);
  if (!req || !req.c) return log("no webpack cache");
  const ids = Object.keys(req.c);
  log("modules in cache:", ids.length);

  const exportsList = [];
  for (const id of ids) {
    const ex = req.c[id] && req.c[id].exports;
    if (!ex) continue;
    for (const o of [ex, ex.default, ex.Z, ex.ZP].filter(isObjFn)) {
      exportsList.push({ id, o });
    }
  }
  const findByProps = (...props) =>
    exportsList.filter(({ o }) => props.every(p => { try { return o[p] !== undefined; } catch { return false; } }));
  const dump = (label, arr, max = 6) => {
    log(`${label}: ${arr.length} match`);
    arr.slice(0, max).forEach(({ id, o }) =>
      log(`  #${id}`, o.displayName || o.name || "", "→", keysOf(o).slice(0, 40).join(", ")));
  };

  // ---- 1. the popout window store / action creators --------------------
  dump("findByProps('PopoutWindowStore')", findByProps("PopoutWindowStore"));
  dump("has open+setAlwaysOnTop", findByProps("open", "setAlwaysOnTop"));
  dump("has open+close+getWindow", findByProps("open", "close", "getWindow"));
  dump("has renderWindow", findByProps("renderWindow"));
  dump("has setAlwaysOnTop+getWindow", findByProps("setAlwaysOnTop", "getWindow"));
  dump("has getWindowOpen / getWindows", findByProps("getWindow", "getWindowKeys"));

  // Flux store named PopoutWindowStore
  const stores = exportsList.filter(({ o }) => {
    try { return o.getName && typeof o.getName === "function"; } catch { return false; }
  });
  const named = stores.map(s => { try { return { id: s.id, name: s.o.getName(), o: s.o }; } catch { return null; } }).filter(Boolean);
  const popoutStore = named.find(s => /popout/i.test(s.name));
  log("Flux stores:", named.length, "| PopoutWindowStore ->", popoutStore ? "#" + popoutStore.id : "not found");
  if (popoutStore) {
    log("  methods:", keysOf(Object.getPrototypeOf(popoutStore.o)).concat(keysOf(popoutStore.o)).join(", "));
    for (const m of ["getWindowKeys", "getWindow", "getWindowOpen", "getState"]) {
      try { log(`  ${m}() ->`, popoutStore.o[m] && popoutStore.o[m]()); } catch (e) { log(`  ${m}() threw`, e.message); }
    }
  }

  // ---- 2. DirectVideo / direct-frames api -----------------------------
  dump("has 'DirectVideo'", findByProps("DirectVideo"));
  dump("direct frames subscribe", findByProps("subscribeToDirectFrames"));
  dump("has 'streamId'+'onReady'", findByProps("streamId", "onReady"));
  const dvByName = exportsList.filter(({ o }) => /DirectVideo|VideoStream|StreamVideo/.test(o.displayName || o.name || ""));
  dump("component name ~ *Video*", dvByName, 10);

  // ---- 3. anything with 'popout' in exported keys --------------------
  const popoutish = exportsList.filter(({ o }) =>
    keysOf(o).some(k => /popout/i.test(k)));
  dump("keys match /popout/i", popoutish, 12);

  // ---- 4. preload-exposed frame bridge -----------------------------
  for (const g of ["DiscordNative", "DiscordDirectVideo", "__streamFrames"]) {
    try { log(`window.${g}:`, g in window ? keysOf(window[g]).slice(0, 40) : "absent"); } catch {}
  }
  try { log("DiscordNative.nativeModules:", keysOf(DiscordNative.nativeModules)); } catch {}

  window.__p4 = { req, exportsList, findByProps, popoutStore };
  log("done. handles on window.__p4");
})();
