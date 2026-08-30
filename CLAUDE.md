# StreamWindows — notes for Claude

**Goal:** Vencord user plugin that pops each watched Discord stream into its own
OS window for multi-monitor viewing. See `README.md` for the full picture.

## Feasibility: PROVEN (2026-08-30)

The core mechanism is one Flux dispatch, no hacks:

```
popoutModule = findByProps("open", "setAlwaysOnTop", "openCallTilePopout")
popoutModule.openCallTilePopout(channelId, participantId)
    -> dispatch { type: "CALL_TILE_POPOUT_WINDOW_OPEN", channelId, participantId }
```

Verified in the live desktop client (build 603738): calling this once per
streamer opens **one real, separate, movable OS window per streamer**,
simultaneously. `PopoutWindowStore` tracks them; `popoutModule.close(key)` /
`setAlwaysOnTop(key, bool)` control them. Requirement: you must be connected to
that voice channel (you don't have to be "watching" the specific stream).

Other resolved handles:
- `popoutModule`: `open(key,render,features)` [custom keys REJECTED -> opens
  discord.com/popout in a browser], `close(key)`, `setAlwaysOnTop(key,bool)`,
  `openChannelCallPopout(channel)`, `addStylesheet(url,integrity)`
- `findStore("PopoutWindowStore")`: getWindowKeys / getWindow / getIsAlwaysOnTop
  / isWindowFullScreen / getWindowFocused / getState / unmountWindow
- `findStore("ApplicationStreamingStore")`: getAllApplicationStreams (→ objects
  with `{streamType, ownerId, guildId, channelId, discoverable}`),
  getActiveStreamForUser, getAnyStreamForUser, getViewerIds, getRTCStream, …
- Stream tile render path (only if we ever need custom render): the
  CHANNEL_CALL_POPOUT participant component uses
  `videoComponent = <mediaEngineStore>.getVideoComponent()` then renders a
  wrapper with `{ streamId, videoComponent, userId, fit, paused, mirror }`.
- `findComponentByCode("streamId","onReady")` and
  `findComponentByCode("VideoStream")` both resolve.

## Still open / next

1. Exact window-key scheme for call-tile popouts (need it to dedupe, position,
   per-window always-on-top). Dump `PopoutWindowStore.getState()` /
   `getWindowKeys()` right after `openCallTilePopout`.
2. Real trigger UI (context-menu item / button) instead of `window.$sw` console
   helpers.
3. Edge cases: only offer for streamers in your connected voice channel; close
   / show "stream ended" when a stream stops; dedupe repeat opens.
4. Nice-to-have: remember per-streamer window bounds; "spread across monitors".

## Dev loop

- Vencord checkout: `C:\Users\theta\Documents\Dev\Vencord` (sibling; untouched
  upstream). Our plugin junction-linked into its `src/userplugins/StreamWindows`
  via `node scripts/link-into-vencord.mjs`.
- Our own `tsconfig.json` gives esbuild the `@utils`/`@webpack` aliases
  (baseUrl -> `../Vencord`), needed because the junction resolves outside Vencord.
- Iterate: edit `src/StreamWindows/*` → `cd ../Vencord && pnpm build` →
  `Ctrl+R` in Discord. No re-inject needed.
- Console helpers exposed at `window.$sw` by the plugin's `start()`.
- pnpm 11.24 vs Vencord's pinned 11.9 warning is harmless.

## Environment

- Windows 11, PowerShell. Node 24, pnpm 11.24 (global). Discord **stable**
  desktop, Vencord injected. User runs League + streams in voice a lot (handy
  for testing).

## Conventions

- Anything unverified against live internals is marked `TODO(verify)` in code.
