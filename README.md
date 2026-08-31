# StreamWindows

A Discord plugin that pops each watched stream into its **own OS window**, so
several simultaneous streams can be spread across multiple monitors and
fullscreened independently.

Ships as a **BetterDiscord** plugin (drop-in, what most people want) and as a
**Vencord** userplugin (dev), built from one shared source.

**Status: working.** Right-click a streamer in your voice channel → *Pop Out
Stream to Window*. Repeat per streamer for one window each.

## Why this plugin

| Option | Multiple streams at once | Separate OS windows | Per-monitor fullscreen |
|---|---|---|---|
| Discord native Multistream | yes (grid) | no | no (thumbnails) |
| Discord native pop-out | one at a time | yes (one small window) | partial |
| [PopIns](https://github.com/funteaqueue/PopIns) | yes | no — stays inside the Discord window | only if Discord spans monitors |
| **StreamWindows** | **yes** | **yes** | **yes** |

## Features

- **Pop Out Stream to Window** — right-click any streaming user (voice list or
  their tile). One real, movable, resizable OS window per streamer.
- **In-window controls** — hover the bottom-left of a popped window:
  - 🔊 speaker button toggles mute for that stream
  - hovering reveals a compact vertical volume slider (0–200%)
  - 📌 pins the window as **picture-in-picture**: snaps it to a screen corner at
    a compact size and keeps it above other windows (shift-click to walk it
    around the corners)
  - ⛶ button, or double-click the video, toggles fullscreen
- **`/streamwindows`** — pop out every stream in your current voice channel.
- Window position/size persist per streamer (Discord stores the bounds).
- Dedupe: an already-open stream shows *Stream Window Open* plus *Toggle
  Fullscreen* / *Close Stream Window*.

## How it works

Discord already has everything needed; the plugin just drives it correctly.

```
popoutModule = findByProps("open", "setAlwaysOnTop", "openCallTilePopout")
popoutModule.openCallTilePopout(channelId, participantId)
    -> dispatch { type: "CALL_TILE_POPOUT_WINDOW_OPEN", channelId, participantId }
```

Three findings made it work:

1. **`participantId` must be the stream key** (`guild:<guildId>:<channelId>:<userId>`),
   not the user id. A user id resolves to the *voice* participant, which has no
   `streamId` and renders an avatar.
2. **The stream must already be decoding.** The plugin calls Discord's watch
   thunk with `{ forceMultiple: true, noFocus: true }` so the stream is *added*
   to the multistream set rather than replacing it (which used to tear down an
   open grid), then `selectParticipant` to force the decode, then pops.
3. **`PopoutWindowStore.getWindow(key)` returns the popout's real same-origin
   `Window`**, so the control overlay is injected straight into its document.

Window keys:

```
live:   DISCORD_CALL_TILE_POPOUT_<channelId>_<streamKey>
bounds: DISCORD_CALL_TILE_POPOUT_<channelId>_<userId>  -> {x,y,width,height,alwaysOnTop}
```

## Install (for users)

> Sending this to someone? Point them at **[INSTALL.md](INSTALL.md)** — a
> plain-language walkthrough with troubleshooting, written for non-developers.

No build step — BetterDiscord loads plugins from a folder.

1. **Install [BetterDiscord](https://betterdiscord.app)** and run its installer.
   ⚠️ If you already run **Vencord**, uninstall it first — both replace the same
   Discord file and cannot coexist.
2. **Download `StreamWindows.plugin.js`** (in [`dist/`](dist/)).
3. **Put it in your plugins folder** — in Discord: Settings → Plugins → *Open
   Plugins Folder*. Or manually:
   - Windows: `%APPDATA%\BetterDiscord\plugins`
   - macOS: `~/Library/Application Support/BetterDiscord/plugins`
   - Linux: `~/.config/BetterDiscord/plugins`
4. **Enable "StreamWindows"** in Settings → Plugins.

Then: join a voice channel, right-click someone who's streaming, and pick
**Pop Out Stream to Window**.

Desktop Discord only. Updates are manual — replace the file and restart Discord
(BetterDiscord only auto-updates plugins published to its own store).

## Build it yourself

```powershell
npm install
npm run build:bd       # -> dist/StreamWindows.plugin.js
npm run install:bd     # build + copy straight into your BD plugins folder
npm run watch:bd       # rebuild + reinstall on every save
```

> Vencord **cannot** do this. Its build globs `src/userplugins` at compile time
> (`scripts/build/common.mjs`) and has no runtime plugin loading, so a Vencord
> user who installed it normally has no folder to drop this into — they'd have to
> build Vencord from source. That's why the BetterDiscord build exists.

## Install — Vencord (dev)

Prereqs: Node 20+, `pnpm` (`npm i -g pnpm`), git.

```powershell
# 1. Vencord dev build (sibling directory, kept pristine — never edited)
git clone https://github.com/Vendicated/Vencord "$env:USERPROFILE\Documents\Dev\Vencord"
cd "$env:USERPROFILE\Documents\Dev\Vencord"
pnpm i

# 2. junction-link this plugin into Vencord's userplugins
cd <this repo>
node scripts/link-into-vencord.mjs "$env:USERPROFILE\Documents\Dev\Vencord"

# 3. build + inject (Discord must be fully quit for inject)
cd "$env:USERPROFILE\Documents\Dev\Vencord"
pnpm build
pnpm inject

# 4. start Discord, enable "StreamWindows" in Settings > Vencord > Plugins
```

Iterating: edit `src/StreamWindows/` → `pnpm build` in Vencord → `Ctrl+R` in
Discord. Re-injecting is only needed once.

Console helpers are exposed on `window.$sw` (`popOut`, `closeAll`, `dumpKeys`,
`discover`, …).

## Repo layout

One source, two outputs. All behaviour lives in `src/core`; the adapters only
map a client mod's API onto a tiny `Platform` interface and render menu rows.

```
src/core/platform.ts            the ~5-method interface an adapter must satisfy
src/core/streamwindows.ts       ALL the logic — popout, watch, overlay, menu model
src/StreamWindows/index.tsx     Vencord adapter (junction target; keep this path)
src/bd/entry.ts                 BetterDiscord adapter
scripts/build-bd.mjs            esbuild -> dist/StreamWindows.plugin.js (+ --install)
scripts/link-into-vencord.mjs   junction-link into a Vencord checkout
tsconfig.json                   @utils/@webpack aliases (baseUrl -> ../Vencord)
tsconfig.check.json             typecheck scope: core + bd only (see its comment)
spike/                          historical console probes from the feasibility
                                phase; not used by either build
```

Adding a feature means touching `src/core/streamwindows.ts` only. If you find
yourself putting logic in an adapter, it belongs in core.

| Platform method | Vencord | BetterDiscord |
|---|---|---|
| `getByProps` | `findByProps` | `Webpack.getByKeys` |
| `getByCode` | `findByCode` | `getModule(Filters.byStrings(…), {searchExports:true})` |
| `getStore` | `findStore` | `Webpack.getStore` |
| `find` | `find` | `getModule(filter, {searchExports:true})` |
| menu | `addContextMenuPatch` + `Menu.*` | `ContextMenu.patch` + `buildItem` |

## Differences between the two builds

- **Slash commands** (`/streamwindows`, `/streamwindows-discover`) are Vencord
  only — BD has no command API. On BD use the context menu, or the console
  helpers on `window.$sw` (`$sw.popAllInConnectedChannel()`, `$sw.discover()`).
- Everything else — popping, the overlay, mute/volume/fullscreen — is identical,
  because it's the same `src/core` code.

## Picture-in-picture: what "always on top" actually covers

📌 pins a stream window above other windows. It **works** over normal windows,
**borderless / windowed-fullscreen** games, and fullscreen video players.

It does **not** work over a game in **exclusive fullscreen**. That game takes
exclusive control of the display, and no ordinary window — this plugin, Discord's
own popout, anything — can draw over it. That is exactly why Discord ships a
separate injected game overlay (`discord_overlay2`), which hooks the game's
render pipeline; replicating that is a completely different project.

**The fix is in the game:** set it to *Borderless* / *Windowed Fullscreen*.
Most modern titles default to it, and there's no meaningful performance cost.

## Known gaps

- Overlay is re-mounted by a 1.5s poll rather than a store subscription.
- Volume is written under both the stream key and the owner id (Discord's own
  naming says `userId`, but stream volume has been seen under both); the
  redundant write is inert.
- Overlay doesn't live-update if you change volume from Discord's own menu.
- No "stream ended" handling — the window stays until closed.

## Legal

Client modification is against Discord's ToS. Enforcement against plugin users is
effectively nonexistent, but this is unofficial and can break on any Discord
update. Not affiliated with Discord.
