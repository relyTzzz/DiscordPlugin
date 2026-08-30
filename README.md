# StreamWindows

A Vencord user plugin that pops each watched Discord stream into its **own OS
window**, so several simultaneous streams can be spread across multiple monitors
and fullscreened independently.

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

## Install / dev

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

```
src/StreamWindows/index.tsx     the plugin
scripts/link-into-vencord.mjs   junction-link into a Vencord checkout
tsconfig.json                   @utils/@webpack aliases (baseUrl -> ../Vencord)
spike/                          historical console probes from the feasibility
                                phase; not used by the plugin
```

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
