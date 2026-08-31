/**
 * @name StreamWindows
 * @author theta
 * @description Pop each watched Discord stream into its own OS window for multi-monitor viewing.
 * @version 1.0.0
 */


// src/core/streamwindows.ts
var DECODE_WAIT_MS = 1300;
var OVERLAY_POLL_MS = 1500;
var STREAM_CTX = "stream";
var PIP_W = 480;
var PIP_H = 270;
var PIP_MARGIN = 16;
var CORNERS = ["bottom-right", "bottom-left", "top-left", "top-right"];
var OVERLAY_ID = "streamwindows-overlay";
var STREAM_KEY_RE = /^DISCORD_CALL_TILE_POPOUT_\d+_((?:guild|call):.+)$/;
var OVERLAY_CSS = `
#${OVERLAY_ID}{position:fixed;left:10px;bottom:10px;z-index:2147483647;display:flex;flex-direction:column;
 align-items:center;gap:6px;opacity:0;transition:opacity .12s;font:12px system-ui,sans-serif;color:#fff;
 -webkit-app-region:no-drag}
html:hover #${OVERLAY_ID}{opacity:.95}
#${OVERLAY_ID} .sw-pop{display:none;flex-direction:column;align-items:center;gap:4px;padding:8px 6px 6px;
 border-radius:9px;background:rgba(0,0,0,.72)}
#${OVERLAY_ID}:hover .sw-pop,#${OVERLAY_ID}.sw-open .sw-pop{display:flex}
#${OVERLAY_ID} input[type=range]{writing-mode:vertical-lr;direction:rtl;width:20px;height:92px;
 accent-color:#5865f2;cursor:pointer}
#${OVERLAY_ID} .sw-val{opacity:.8;font-variant-numeric:tabular-nums}
#${OVERLAY_ID} .sw-btns{display:flex;gap:6px}
#${OVERLAY_ID} button{width:30px;height:30px;border:0;border-radius:8px;background:rgba(0,0,0,.6);
 color:#fff;cursor:pointer;font-size:14px;line-height:1}
#${OVERLAY_ID} button:hover{background:rgba(0,0,0,.85)}
#${OVERLAY_ID} button.sw-on{background:#5865f2}
/* Hide the popout's own title bar so the video runs edge to edge. It is lifted
   out of flow (position:fixed) rather than display:none'd, because Discord puts
   -webkit-app-region:drag on it \u2014 display:none would make the window
   undraggable. Hovering the top strip fades the window buttons back in,
   semi-transparent; hovering a button itself brings it to full opacity. */
[class*="titleBar"]{
 position:fixed!important;top:0;left:0;right:0;height:26px;z-index:2147483646;
 background:transparent!important;border:0!important;box-shadow:none!important;
 opacity:0;transition:opacity .15s;-webkit-app-region:drag}
[class*="titleBar"]:hover{opacity:.55}
/* the title text / wordmark never comes back, only the controls */
[class*="titleBar"] [class*="wordmark"],[class*="titleBar"] [class*="title_"]{display:none!important}
[class*="winButtons"]{-webkit-app-region:no-drag}
[class*="winButton"]:hover{opacity:1!important;background:rgba(255,255,255,.15)!important}
/* fullscreen hides the bar outright */
:fullscreen [class*="titleBar"],:fullscreen [class*="typeWindows"],:fullscreen [class*="titlebar"]{display:none!important}
`;
function createStreamWindows(P) {
  const log = P.log;
  const popoutModule = () => P.getByProps("open", "setAlwaysOnTop", "openCallTilePopout") ?? P.getByProps("open", "setAlwaysOnTop");
  const streamStore = () => P.getStore("ApplicationStreamingStore");
  const popoutStore = () => P.getStore("PopoutWindowStore");
  const voiceStore = () => P.getStore("VoiceStateStore");
  const mediaEngine = () => P.getStore("MediaEngineStore");
  const volumeActions = () => P.getByProps("setLocalVolume");
  const selectedChannel = () => P.getByProps("getVoiceChannelId", "getChannelId");
  const dispatcher = () => P.getByProps("dispatch", "subscribe");
  const selectParticipant = () => P.getByProps("selectParticipant");
  const watchThunk = () => P.getByCode("STREAM_WATCH", "streamKey");
  const streamKeyOf = (s) => s?.streamType === "call" ? `call:${s.channelId}:${s.ownerId}` : `guild:${s.guildId}:${s.channelId}:${s.ownerId}`;
  const ownerOf = (streamKey) => streamKey.split(":").pop();
  function streamForUser(userId) {
    const s = streamStore();
    return s?.getAnyStreamForUser?.(userId) ?? s?.getStreamForUser?.(userId) ?? null;
  }
  function connectedVoiceChannelId() {
    try {
      return selectedChannel()?.getVoiceChannelId?.() ?? void 0;
    } catch {
      return void 0;
    }
  }
  function readVol(id) {
    try {
      const v = mediaEngine()?.getLocalVolume?.(id, STREAM_CTX);
      return typeof v === "number" ? v : void 0;
    } catch {
      return void 0;
    }
  }
  function getVolume(streamKey) {
    return readVol(streamKey) ?? readVol(ownerOf(streamKey)) ?? 100;
  }
  function setVolume(streamKey, v) {
    const VA = volumeActions();
    for (const id of [streamKey, ownerOf(streamKey)]) {
      try {
        VA?.setLocalVolume?.(id, v, STREAM_CTX);
      } catch (e) {
        log("setLocalVolume", id, "threw", e?.message);
      }
    }
  }
  function isMuted(streamKey) {
    const me = mediaEngine();
    try {
      return !!(me?.isLocalMute?.(streamKey, STREAM_CTX) || me?.isLocalMute?.(ownerOf(streamKey), STREAM_CTX));
    } catch {
      return false;
    }
  }
  function toggleMute(streamKey) {
    const VA = volumeActions();
    const next = !isMuted(streamKey);
    for (const id of [streamKey, ownerOf(streamKey)]) {
      try {
        if (VA?.setLocalMute) VA.setLocalMute(id, next, STREAM_CTX);
        else VA?.toggleLocalMute?.(id, STREAM_CTX);
      } catch (e) {
        log("mute toggle threw", id, e?.message);
      }
    }
    return next;
  }
  const windowFor = (key) => {
    try {
      return popoutStore()?.getWindow?.(key);
    } catch {
      return null;
    }
  };
  const liveKeys = () => popoutStore()?.getWindowKeys?.() ?? [];
  function existingWindowKey(channelId, userId) {
    return liveKeys().find((k) => k.includes(channelId) && k.endsWith(userId));
  }
  function toggleWinFullscreen(win) {
    try {
      const dn = win?.DiscordNative?.window;
      if (dn?.fullscreen) {
        dn.fullscreen();
        return;
      }
      if (dn?.setFullscreen) {
        win.__swFs = !win.__swFs;
        dn.setFullscreen(win.__swFs);
        return;
      }
    } catch (e) {
      log("DiscordNative fullscreen threw", e?.message);
    }
    try {
      const d = win?.document;
      if (!d) return;
      if (d.fullscreenElement) d.exitFullscreen?.();
      else d.documentElement?.requestFullscreen?.()?.catch((e) => log("requestFullscreen rejected", e?.message));
    } catch (e) {
      log("toggleWinFullscreen threw", e?.message);
    }
  }
  const toggleFullscreen = (windowKey) => toggleWinFullscreen(windowFor(windowKey));
  function workArea(win) {
    const sc = win.screen ?? {};
    return {
      left: sc.availLeft ?? 0,
      top: sc.availTop ?? 0,
      width: sc.availWidth ?? 1920,
      height: sc.availHeight ?? 1080
    };
  }
  function nearestCorner(win) {
    const a = workArea(win);
    const cx = (win.screenX ?? 0) + (win.outerWidth ?? PIP_W) / 2;
    const cy = (win.screenY ?? 0) + (win.outerHeight ?? PIP_H) / 2;
    const vert = cy < a.top + a.height / 2 ? "top" : "bottom";
    const horiz = cx < a.left + a.width / 2 ? "left" : "right";
    return `${vert}-${horiz}`;
  }
  function snapToCorner(win, corner) {
    const a = workArea(win);
    const x = corner.endsWith("right") ? a.left + a.width - PIP_W - PIP_MARGIN : a.left + PIP_MARGIN;
    const y = corner.startsWith("bottom") ? a.top + a.height - PIP_H - PIP_MARGIN : a.top + PIP_MARGIN;
    try {
      win.resizeTo(PIP_W, PIP_H);
      win.moveTo(x, y);
    } catch (e) {
      log("snapToCorner threw", e?.message);
    }
  }
  const isPip = (win) => !!win?.__swPip;
  function setAlwaysOnTopFor(windowKey, win, on) {
    const tried = [];
    try {
      popoutModule()?.setAlwaysOnTop?.(windowKey, on);
      tried.push("popout.setAlwaysOnTop");
    } catch (e) {
      log("popout.setAlwaysOnTop threw", e?.message);
    }
    const dn = win?.DiscordNative?.window;
    if (dn?.setAlwaysOnTop) {
      try {
        dn.setAlwaysOnTop(on);
        tried.push("DiscordNative(bool)");
      } catch (e) {
        log("DiscordNative.setAlwaysOnTop(bool) threw", e?.message);
      }
      try {
        dn.setAlwaysOnTop(on, on ? "screen-saver" : "normal");
        tried.push("DiscordNative(bool,level)");
      } catch {
      }
    }
    const readBack = (() => {
      try {
        return popoutStore()?.getIsAlwaysOnTop?.(windowKey);
      } catch {
        return "?";
      }
    })();
    log("alwaysOnTop", on, "via", tried.join(" + ") || "NOTHING", "| store says:", readBack);
  }
  function setPip(windowKey, on, corner) {
    const win = windowFor(windowKey);
    if (!win) return log("no window for", windowKey);
    if (on) {
      if (!win.__swPip) {
        win.__swPrevBounds = {
          x: win.screenX,
          y: win.screenY,
          w: win.outerWidth,
          h: win.outerHeight
        };
      }
      const c = corner ?? win.__swPipCorner ?? nearestCorner(win);
      win.__swPip = true;
      win.__swPipCorner = c;
      snapToCorner(win, c);
      setAlwaysOnTopFor(windowKey, win, true);
      log("pip on:", windowKey, c);
    } else {
      win.__swPip = false;
      setAlwaysOnTopFor(windowKey, win, false);
      const b = win.__swPrevBounds;
      if (b) {
        try {
          win.resizeTo(b.w, b.h);
          win.moveTo(b.x, b.y);
        } catch (e) {
          log("restore bounds threw", e?.message);
        }
      }
      log("pip off:", windowKey);
    }
    refreshOverlayState(win);
  }
  const togglePip = (windowKey) => setPip(windowKey, !isPip(windowFor(windowKey)));
  function cyclePipCorner(windowKey) {
    const win = windowFor(windowKey);
    if (!win) return;
    const cur = win.__swPipCorner ?? nearestCorner(win);
    const next = CORNERS[(CORNERS.indexOf(cur) + 1) % CORNERS.length];
    setPip(windowKey, true, next);
  }
  function refreshOverlayState(win) {
    try {
      win?.__swRefresh?.();
    } catch {
    }
  }
  function mountOverlay(win, streamKey, windowKey) {
    const doc = win?.document;
    if (!doc?.body || doc.getElementById(OVERLAY_ID)) return;
    if (!doc.getElementById(OVERLAY_ID + "-css")) {
      const style = doc.createElement("style");
      style.id = OVERLAY_ID + "-css";
      style.textContent = OVERLAY_CSS;
      (doc.head ?? doc.documentElement).appendChild(style);
    }
    const vol = Math.round(getVolume(streamKey));
    const el = doc.createElement("div");
    el.id = OVERLAY_ID;
    el.innerHTML = `<div class="sw-pop"><input type="range" min="0" max="200" step="1" value="${vol}"><span class="sw-val">${vol}%</span></div><div class="sw-btns"><button class="sw-vol" title="Mute / volume"></button><button class="sw-pip" title="Picture-in-picture: pin to a screen corner, always on top (shift-click to move corner)">\u{1F4CC}</button><button class="sw-fs" title="Fullscreen (or double-click video)">\u26F6</button></div>`;
    doc.body.appendChild(el);
    const range = el.querySelector("input");
    const valEl = el.querySelector(".sw-val");
    const volBtn = el.querySelector(".sw-vol");
    const pipBtn = el.querySelector(".sw-pip");
    const reflectMute = () => {
      const muted = isMuted(streamKey);
      volBtn.textContent = muted ? "\u{1F507}" : "\u{1F50A}";
      volBtn.classList.toggle("sw-on", muted);
    };
    const reflectPip = () => pipBtn.classList.toggle("sw-on", isPip(win));
    reflectMute();
    reflectPip();
    win.__swRefresh = () => {
      reflectMute();
      reflectPip();
    };
    range.addEventListener("input", () => {
      const v = +range.value;
      setVolume(streamKey, v);
      valEl.textContent = Math.round(v) + "%";
    });
    volBtn.addEventListener("click", () => {
      toggleMute(streamKey);
      setTimeout(reflectMute, 60);
    });
    pipBtn.addEventListener("click", (ev) => {
      if (ev.shiftKey && isPip(win)) cyclePipCorner(windowKey);
      else togglePip(windowKey);
    });
    el.querySelector(".sw-fs").addEventListener("click", () => toggleWinFullscreen(win));
    if (!win.__swDblBound) {
      win.__swDblBound = true;
      win.addEventListener("dblclick", (e) => {
        const bar = win.document?.getElementById(OVERLAY_ID);
        if (!bar || !bar.contains(e.target)) toggleWinFullscreen(win);
      });
    }
  }
  function overlayTick() {
    for (const k of liveKeys()) {
      const m = STREAM_KEY_RE.exec(k);
      if (!m) continue;
      const win = windowFor(k);
      if (win?.document?.body && !win.document.getElementById(OVERLAY_ID)) {
        try {
          mountOverlay(win, m[1], k);
        } catch (e) {
          log("mountOverlay threw", e?.message);
        }
      }
    }
  }
  function removeAllOverlays() {
    for (const k of liveKeys()) {
      try {
        const doc = windowFor(k)?.document;
        doc?.getElementById(OVERLAY_ID)?.remove();
        doc?.getElementById(OVERLAY_ID + "-css")?.remove();
      } catch {
      }
    }
  }
  function streamState(key) {
    const s = streamStore();
    return {
      viewers: s?.getViewerIds?.(key),
      rtc: !!s?.getRTCStream?.(key),
      active: (s?.getAllActiveStreams?.() ?? []).map(streamKeyOf)
    };
  }
  function ensureWatching(stream, channelId) {
    const key = streamKeyOf(stream);
    const fn = watchThunk();
    if (typeof fn === "function") {
      try {
        fn(stream, { forceMultiple: true, noFocus: true });
      } catch (e) {
        log("watch thunk threw", e?.message);
      }
    } else {
      try {
        dispatcher()?.dispatch?.({ type: "STREAM_WATCH", streamKey: key, allowMultiple: true });
      } catch (e) {
        log("STREAM_WATCH dispatch threw", e?.message);
      }
    }
    try {
      selectParticipant()?.selectParticipant?.(channelId, key);
    } catch (e) {
      log("selectParticipant threw", e?.message);
    }
  }
  function popOut(channelId, userId) {
    const P0 = popoutModule();
    if (!P0?.openCallTilePopout) return log("openCallTilePopout not found");
    const already = existingWindowKey(channelId, userId);
    if (already) return log("window already open:", already);
    const stream = streamForUser(userId);
    if (stream) ensureWatching(stream, channelId);
    else log("no stream for", userId, "\u2014 popping anyway");
    const participantId = stream ? streamKeyOf(stream) : userId;
    setTimeout(() => {
      log("openCallTilePopout(", channelId, ",", participantId, ")");
      P0.openCallTilePopout(channelId, participantId);
      for (const d of [400, 900, 1600, 2600]) setTimeout(overlayTick, d);
    }, DECODE_WAIT_MS);
  }
  function popAllInConnectedChannel() {
    const cid = connectedVoiceChannelId();
    if (!cid) return log("not connected to a voice channel");
    const s = streamStore();
    const streams = s?.getAllApplicationStreamsForChannel?.(cid) ?? (s?.getAllApplicationStreams?.() ?? []).filter((x) => x.channelId === cid);
    log("popping", streams.length, "stream(s) in", cid);
    streams.forEach((st, i) => setTimeout(() => popOut(cid, st.ownerId ?? st.userId), i * 500));
  }
  function closeFor(channelId, userId) {
    const key = existingWindowKey(channelId, userId);
    if (key) {
      popoutModule()?.close?.(key);
      log("closed", key);
    }
  }
  function closeAll() {
    const keys = liveKeys();
    keys.forEach((k) => popoutModule()?.close?.(k));
    log("closed", keys);
  }
  function setAlwaysOnTop(channelId, userId, v) {
    const key = existingWindowKey(channelId, userId);
    if (!key) return log("no open window for", userId);
    popoutModule()?.setAlwaysOnTop?.(key, v);
  }
  function dumpKeys() {
    log("live keys:", liveKeys());
    log("state:", popoutStore()?.getState?.());
  }
  function discover() {
    log("=== discovery ===");
    log("popout module:", popoutModule() && Object.keys(popoutModule()).join(","));
    log("watch thunk:", typeof watchThunk());
    log("stores:", {
      streaming: !!streamStore(),
      popout: !!popoutStore(),
      voice: !!voiceStore(),
      mediaEngine: !!mediaEngine()
    });
    log("volume actions:", volumeActions() && Object.keys(volumeActions()).slice(0, 20).join(","));
    log("streams:", streamStore()?.getAllApplicationStreams?.());
    log("connected voice channel:", connectedVoiceChannelId());
    for (const k of liveKeys()) {
      log(`window ${k}: document =`, !!windowFor(k)?.document);
    }
    dumpKeys();
  }
  function inspectChrome() {
    for (const k of liveKeys()) {
      const doc = windowFor(k)?.document;
      if (!doc) continue;
      log("window", k);
      const seen = /* @__PURE__ */ new Set();
      for (const el of Array.from(doc.querySelectorAll("*"))) {
        const cls = typeof el.className === "string" ? el.className : "";
        if (!/titlebar|titleBar|winButton|wordmark|typeWindows/i.test(cls)) continue;
        if (seen.has(cls)) continue;
        seen.add(cls);
        const r = el.getBoundingClientRect?.();
        log(
          "  ",
          el.tagName,
          JSON.stringify(cls),
          r ? `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.top)}` : ""
        );
      }
      if (!seen.size) log("   (no titlebar-ish elements found)");
    }
  }
  function pipDiag() {
    const keys = liveKeys();
    if (!keys.length) return log("no popout windows open");
    for (const k of keys) {
      const win = windowFor(k);
      if (!win) {
        log(k, "-> no window object");
        continue;
      }
      const sc = win.screen ?? {};
      const a = workArea(win);
      log("window:", k);
      log(
        "   position   screenX/Y:",
        win.screenX,
        win.screenY,
        "| outer:",
        win.outerWidth + "x" + win.outerHeight,
        "| inner:",
        win.innerWidth + "x" + win.innerHeight
      );
      log(
        "   screen     avail L/T/W/H:",
        sc.availLeft,
        sc.availTop,
        sc.availWidth,
        sc.availHeight,
        "| full:",
        sc.width + "x" + sc.height
      );
      log("   workArea   ->", a);
      log("   corner     nearest:", nearestCorner(win), "| remembered:", win.__swPipCorner ?? "(none)");
      log("   pip state  __swPip:", !!win.__swPip, "| prevBounds:", win.__swPrevBounds ?? "(none)");
      log("   alwaysTop  store:", (() => {
        try {
          return popoutStore()?.getIsAlwaysOnTop?.(k);
        } catch {
          return "threw";
        }
      })());
      const dn = win.DiscordNative?.window;
      log("   native     DiscordNative.window:", dn ? Object.keys(dn).join(",") : "ABSENT");
      log("   canMove    moveTo:", typeof win.moveTo, "resizeTo:", typeof win.resizeTo);
    }
  }
  function menuEntriesFor(props) {
    const user = props?.user;
    if (!user?.id) return [];
    const stream = streamForUser(user.id);
    if (!stream) return [];
    const channelId = props?.channel?.id ?? voiceStore()?.getVoiceStateForUser?.(user.id)?.channelId;
    if (!channelId) return [];
    const connected = connectedVoiceChannelId();
    const canPop = !connected || connected === channelId;
    const winKey = existingWindowKey(channelId, user.id);
    const entries = [{
      id: "streamwindows-popout",
      label: winKey ? "Stream Window Open" : "Pop Out Stream to Window",
      disabled: !canPop || !!winKey,
      action: () => popOut(channelId, user.id)
    }];
    if (winKey) {
      entries.push({
        id: "streamwindows-pip",
        label: isPip(windowFor(winKey)) ? "Exit Picture-in-Picture" : "Picture-in-Picture",
        action: () => togglePip(winKey)
      });
      entries.push({
        id: "streamwindows-fullscreen",
        label: "Toggle Fullscreen",
        action: () => toggleFullscreen(winKey)
      });
      entries.push({
        id: "streamwindows-close",
        label: "Close Stream Window",
        danger: true,
        action: () => closeFor(channelId, user.id)
      });
    }
    return entries;
  }
  let poll;
  return {
    start() {
      poll = setInterval(overlayTick, OVERLAY_POLL_MS);
      log("ready \u2014 right-click a streamer in voice");
    },
    stop() {
      if (poll) clearInterval(poll);
      poll = void 0;
      removeAllOverlays();
    },
    menuEntriesFor,
    popOut,
    popAllInConnectedChannel,
    closeAll,
    dumpKeys,
    discover,
    debug: {
      popOut,
      popAllInConnectedChannel,
      closeAll,
      closeFor,
      setAlwaysOnTop,
      dumpKeys,
      discover,
      overlayTick,
      toggleFullscreen,
      ensureWatching,
      inspectChrome,
      setPip,
      togglePip,
      cyclePipCorner,
      snapToCorner,
      isPip,
      pipDiag,
      nearestCorner,
      workArea,
      getVolume,
      setVolume,
      isMuted,
      toggleMute,
      streamKeyOf,
      streamForUser,
      streamState,
      connectedVoiceChannelId,
      liveKeys,
      windowFor,
      existingWindowKey,
      stores: { streamStore, popoutStore, voiceStore, mediaEngine, popoutModule }
    }
  };
}

// src/bd/entry.ts
var W = () => BdApi.Webpack;
var F = () => BdApi.Webpack.Filters;
var platform = {
  getByProps: (...props) => W().getByKeys(...props),
  // BD's byStrings matches module source, same idea as Vencord's findByCode.
  // searchExports is needed for bare function exports like the watch thunk.
  getByCode: (...code) => W().getModule(F().byStrings(...code), { searchExports: true }),
  getStore: (name) => W().getStore(name),
  find: (filter) => W().getModule(filter, { searchExports: true }),
  log: (...a) => console.log("%c[StreamWindows]", "color:#5865F2;font-weight:bold", ...a)
};
var sw = createStreamWindows(platform);
var NAV_IDS = ["user-context", "stream-context"];
function renderEntry(e) {
  return BdApi.ContextMenu.buildItem({
    type: "text",
    id: e.id,
    label: e.label,
    disabled: e.disabled,
    danger: e.danger,
    action: e.action
  });
}
function childrenArrayOf(tree) {
  const kids = tree?.props?.children;
  if (Array.isArray(kids)) return kids;
  if (kids && tree?.props) {
    tree.props.children = [kids];
    return tree.props.children;
  }
  return null;
}
var unpatchers = [];
module.exports = class StreamWindows {
  start() {
    for (const navId of NAV_IDS) {
      const unpatch = BdApi.ContextMenu.patch(navId, (tree, props) => {
        let entries = [];
        try {
          entries = sw.menuEntriesFor(props);
        } catch (e) {
          platform.log("menuEntriesFor threw", e?.message);
        }
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
    window.$sw = sw.debug;
  }
  stop() {
    while (unpatchers.length) {
      try {
        unpatchers.pop()();
      } catch {
      }
    }
    sw.stop();
    delete window.$sw;
  }
};
