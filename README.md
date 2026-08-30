# StreamWindows

A Vencord user plugin that pops each watched Discord stream into its **own OS
window**, so multiple simultaneous streams can be spread across multiple
monitors and fullscreened independently.

## Why this plugin

| Option | Multiple streams at once | Separate OS windows | Per-monitor fullscreen |
|---|---|---|---|
| Discord native Multistream | yes (grid) | no | no (thumbnails) |
| Discord native pop-out | no (one at a time) | yes (one small floating window) | partial |
| [PopIns](https://github.com/funteaqueue/PopIns) plugin | yes | no — stays inside the Discord window | yes, if the Discord window spans monitors |
| **StreamWindows (goal)** | yes | **yes** | **yes** |

Discord's Multistream engine already decodes N streams simultaneously, so the
only unsolved problem is getting a live stream's pixels into an independent
window without the frame going black. That is the entire technical risk.

## Step 0 — the feasibility spike (do this first)

`spike/discord-console-spike.js` answers the risk question in ~5 minutes and
needs no build:

1. Enable DevTools in Discord (instructions at the top of the spike file).
2. Join a voice channel and start **watching** a stream.
3. Paste the whole spike file into the DevTools Console.
4. Read the `[spike]` logs; drag the popped window to another monitor.
5. `__spike.close()` to clean up.

It tries two transports and reports which survives into a separate window:

- **passthrough** — assign the source element's `MediaStream` (`srcObject`)
  straight into a `<video>` in the child window. No re-encode, full quality.
- **capture** — `video.captureStream()`: re-captures frames into a fresh
  `MediaStream`. Survives more boundaries, costs a re-encode.

### Decision gate

| Spike result | Next step |
|---|---|
| passthrough renders in the child window and keeps moving on a 2nd monitor | Build **Arch A** (renderer-owned `window.open`). Fast path. |
| only capture works | Build **Arch A** with the capture transport. Watch CPU/quality. |
| neither survives `window.open` | Fall back to **Arch B**: a native Electron `BrowserWindow` that re-subscribes to the stream via Discord's media engine (how Discord's own popout works). See `src/StreamWindows/native.ts`. |

## Repo layout

```
spike/discord-console-spike.js   standalone feasibility test (no build)
src/StreamWindows/index.tsx      plugin entry: context-menu item + Arch A
src/StreamWindows/native.ts      Arch B stub: native BrowserWindow helper
scripts/link-into-vencord.mjs    junction-link this folder into a Vencord checkout
```

## Dev setup (after the spike passes)

Prereqs: Node (have it), **pnpm** (`npm i -g pnpm`), git.

```powershell
# 1. Vencord dev build
git clone https://github.com/Vendicated/Vencord "$env:USERPROFILE\Dev\Vencord"
cd "$env:USERPROFILE\Dev\Vencord"
pnpm i

# 2. link this plugin in as a userplugin
cd C:\Users\theta\Documents\Dev\DiscordPlugin
node scripts/link-into-vencord.mjs "$env:USERPROFILE\Dev\Vencord"

# 3. build + inject
cd "$env:USERPROFILE\Dev\Vencord"
pnpm build
pnpm inject        # patches the Discord install; pick your Discord branch

# 4. restart Discord, enable "StreamWindows" in Settings > Vencord > Plugins
```

Iterate: edit files here → `pnpm build` in Vencord → `Ctrl+R` in Discord.

## Open questions / TODO

- Verify the stream context-menu id and the props shape in `index.tsx`
  (`CONTEXT_MENU_ID`, `patchStreamMenu`) against current Vencord source.
- Disambiguate which `<video>` belongs to which stream key (right now it grabs
  the largest playing one).
- Per-window bounds persistence.
- Audio routing: a popped window shouldn't double up the stream audio.

## Legal

Client modification is against Discord's ToS. Enforcement against plugin users
is effectively nonexistent, but this is unofficial and could break on any
Discord update. Not affiliated with Discord.
