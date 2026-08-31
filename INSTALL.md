# Installing StreamWindows

Watch several Discord streams at once, each in its **own window**, so you can put
them on different monitors and fullscreen them separately.

Takes about two minutes. You only do this once.

---

## Before you start

- **Desktop Discord only.** This does not work in a browser.
- **If you have Vencord, uninstall it first.** Vencord and BetterDiscord modify
  the same Discord file and will break each other. (Vencord users: run its
  installer and choose *Uninstall*.)
- Only the people **watching** need this. Whoever is streaming doesn't need
  anything.

---

## Step 1 — Install BetterDiscord

1. Go to **https://betterdiscord.app** and download the installer.
2. Run it, choose **Install**, and let it patch Discord.
3. Restart Discord when it asks.

You'll know it worked when Discord's Settings has a **BetterDiscord** section in
the left sidebar.

## Step 2 — Add the plugin

1. Get the file **`StreamWindows.plugin.js`** (whoever sent you this has it).
   If it arrived as a `.zip`, unzip it first — you need the `.js` file itself.
2. In Discord: **Settings → Plugins → Open Plugins Folder**.
   A folder opens.
3. **Drag `StreamWindows.plugin.js` into that folder.**

> Don't rename the file. It must keep the `.plugin.js` ending.

## Step 3 — Turn it on

Back in **Settings → Plugins**, find **StreamWindows** and flip the toggle **on**.

Done.

---

## How to use it

1. Join a voice channel where someone is streaming.
2. **Right-click the person who's streaming** — either their name in the voice
   channel list, or their video tile.
3. Choose **"Pop Out Stream to Window"**.

Their stream opens in its own window. Drag it wherever you like — another
monitor, off to the side, whatever.

**Repeat for each person** you want to watch. Each one gets its own window.

### Controls inside each window

Move your mouse over the window and controls fade in at the **bottom-left**:

| | |
|---|---|
| 🔊 | Click to **mute/unmute** that stream |
| | **Hover** the buttons for a **volume slider** |
| 📌 | **Picture-in-picture** — shrinks the window, sticks it to a corner of your screen, and keeps it **on top of other windows**. Shift-click to move it to a different corner. |
| ⛶ | **Fullscreen** — or just **double-click the video** |

Right-clicking the streamer again gives you **Toggle Fullscreen** and
**Close Stream Window**.

> **Pinning it on top of a game:** the pinned window stays above normal windows,
> **borderless / windowed-fullscreen** games, and fullscreen videos. It *cannot*
> appear over a game running in **exclusive fullscreen** — Windows hands that
> game the entire display and nothing is allowed to draw over it. If your stream
> disappears behind a game, open the game's video settings and switch it to
> **Borderless** or **Windowed Fullscreen**.

---

## If something goes wrong

**The right-click menu doesn't show "Pop Out Stream to Window"**
- Are you actually *in* the voice channel? You have to be connected, not just
  looking at it.
- Is that person actually streaming right now?
- Check Settings → Plugins and confirm StreamWindows is toggled on.

**The window opens but shows their avatar instead of the stream**
- Give it a few seconds — it has to start the video first.
- If it stays as an avatar, close the window and try again.

**The plugin vanished after a Discord update**
- Discord updates sometimes undo BetterDiscord. Re-run the BetterDiscord
  installer; your plugin file is still there and will come back.

**Discord won't start after installing BetterDiscord**
- Run the BetterDiscord installer again and choose **Repair**.

---

## Updating

There's no auto-update. When you're sent a newer `StreamWindows.plugin.js`, drop
it in the same folder, replace the old one, and restart Discord.

## Uninstalling

- **Just the plugin:** toggle it off in Settings → Plugins, or delete
  `StreamWindows.plugin.js` from the plugins folder.
- **All of BetterDiscord:** run its installer and choose **Uninstall**.

---

*This is an unofficial Discord modification and isn't affiliated with Discord.
Client mods are against Discord's Terms of Service; in practice nobody gets
actioned for using them, but you should know that before installing.*
