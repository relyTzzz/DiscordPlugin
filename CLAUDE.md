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

## Shipped

Right-click a streamer → *Pop Out Stream to Window*; `/streamwindows` pops all in
the connected channel. Each popped window gets an injected overlay (mute button,
vertical volume slider, fullscreen) mounted into the popout's own document via
`PopoutWindowStore.getWindow(key)`.

Two non-obvious requirements, both discovered the hard way:
- `openCallTilePopout`'s `participantId` must be the **stream key**
  (`guild:<g>:<c>:<u>`), not the user id — a user id resolves to the voice
  participant, which has no `streamId`, so the window shows an avatar.
- The stream must already be **decoding** before the tile mounts. Call the watch
  thunk (`findByCode("STREAM_WATCH","streamKey")`) as
  `fn(streamDescriptor, { forceMultiple: true, noFocus: true })` — omitting
  `forceMultiple` makes Discord *replace* the watch set and tears down an open
  grid — then `selectParticipant`, wait ~1.3s, then pop.

Volume/mute go through `setLocalVolume(id, v, "stream")` /
`setLocalMute(id, bool, "stream")`. Never dispatch `AUDIO_SET_LOCAL_VOLUME`
directly: `setLocalVolume` dispatches it *and* applies to the media engine, so a
raw dispatch updates the store while leaving audio unchanged.

### Public download repo + self-update

`github.com/relyTzzz/StreamWindows` — three files (the plugin, a short README,
the screenshot), what BD users actually download. It's a sibling checkout at
`../StreamWindows`; `npm run publish:public -- --push` copies the built `dist/`
files there, commits, and pushes. `.gitignore` keeps `dist/*` ignored except
those three.

BetterDiscord only auto-updates addons published to *its* store — `@updateUrl`
is not a field BD acts on — so `src/bd/self-update.ts` does it manually: on
`start()` it fetches its own raw file from that repo, compares `@version`, and on
the user's confirm overwrites the installed `.plugin.js` (BD's file watcher
reloads it). Silent when current or on network failure. Manual trigger:
`$sw.checkForUpdates()`. (Built in 1.3.0, removed in 1.4.0, restored in 1.5.0 —
the on-by-default confirm-then-overwrite behaviour is what the user wants.)

`scripts/build-bd.mjs` derives `@source` / `@website` / `@updateUrl` from
`package.json` `repository` / `homepage`, and injects `__SW_VERSION__` /
`__SW_UPDATE_URL__` via esbuild `define` (one derivation, kept in sync with the
meta). `external: ["fs","path"]` is set so esbuild leaves the imported module's
`require()` calls as runtime calls rather than trying to bundle them. Still
`TODO(verify)` against live BD: `BdApi.Net.fetch`,
`BdApi.Plugins.get(name).filename`, `BdApi.UI.showConfirmationModal`, file-watch
reload.

## Always-on-top / PiP: ruled out (2026-08-31)

Do not re-attempt without a native component. Every renderer-reachable route was
measured and failed:
- `popoutModule.setAlwaysOnTop(key, true)` sets `PopoutWindowStore`'s flag and the
  window never floats — live, or preset before closing and reopening the popout
- the popout window exposes no `DiscordNative` / `require` / `process` / `electron`
- `require("electron")` in the host renderer gives only
  `ipcRenderer, shell, webUtils` — no `BrowserWindow`
- `win.focus()` does not raise it; the pinned window even sank behind others
- `documentPictureInPicture.requestWindow()` throws
  `InvalidStateError: Internal error: no window` inside a popout (not a
  top-level browsing context); triggering from the main window is one-per-document

All PiP code and UI was removed. Corner-snapping (`moveTo`/`resizeTo`) did work
and could return as its own feature if wanted — it was only dropped because it
was bundled with always-on-top.

## Still open / next

1. Overlay mounts via a 1.5s poll; a `PopoutWindowStore` subscription would be
   cleaner.
2. Overlay doesn't live-update when volume/mute is changed from Discord's own
   right-click menu.
3. No "stream ended" handling — window stays until closed.
4. Volume is written under both stream key and owner id because it's unconfirmed
   which one Discord actually reads; narrow it once verified.
5. Nice-to-have: "spread windows across monitors" command.

## Architecture: one source, two client mods

`src/core/streamwindows.ts` holds **all** behaviour and depends only on
`src/core/platform.ts` (a ~5-method interface: getByProps / getByCode / getStore
/ find / log). Two thin adapters implement it:

- `src/StreamWindows/index.tsx` — Vencord (this path is the junction target, do
  not move it)
- `src/bd/entry.ts` — BetterDiscord, built by `scripts/build-bd.mjs` into
  `dist/StreamWindows.plugin.js`

**Put new logic in core, never in an adapter.** Adapters only translate APIs and
render the `MenuEntry[]` that `core.menuEntriesFor(props)` returns.

The one deliberate exception is `src/bd/self-update.ts` (see *Public download
repo + self-update* above): every line of it is about BD's install model —
plugins folder, `BdApi.Net`, file-watch reload — and has no Vencord meaning
(Vencord ships its own updater), so it stays in the BD adapter. If a change
would apply to both mods, it still belongs in core.

This works because the plugin declares **zero webpack patches** — it only does
read-only module lookup plus one context-menu item, which is why it ports across
client mods cheaply.

Why BD exists at all: Vencord globs `src/userplugins` at *build* time
(`scripts/build/common.mjs:148`) and has no runtime plugin loading, so ordinary
Vencord users cannot install this without building Vencord from source. BD loads
a single file from a folder.

Commands: `npm run build:bd`, `npm run install:bd`, `npm run watch:bd`,
`npm run typecheck` (scoped to core+bd; checking the Vencord adapter drags in
Vencord's whole source and floods errors).

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
