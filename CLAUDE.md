# StreamWindows — notes for Claude

**Goal:** Vencord user plugin that pops each watched Discord stream into its own
OS window for multi-monitor viewing. See `README.md` for the full picture.

## Current state

Scaffold only. Nothing verified against a running client yet. The gating task is
the feasibility spike in `spike/discord-console-spike.js` — until it passes we
don't know whether Arch A (renderer `window.open`) or Arch B (native
`BrowserWindow` + media-engine re-subscribe) is the right build.

## Prior art

- [PopIns](https://github.com/funteaqueue/PopIns) — Vencord plugin, per-stream
  pop-out cards, but windows can't leave the Discord window. Closest existing
  thing; study it.
- Discord native "Multistream" — proves the client can decode many streams at
  once.

## Environment

- Windows 11, PowerShell. Node 24 present. **pnpm NOT installed** (Vencord needs
  it: `npm i -g pnpm`). Discord installed at `%LOCALAPPDATA%\Discord`. Vencord
  not installed yet.
- This repo holds only the plugin source; it gets junction-linked into a
  separate Vencord checkout via `scripts/link-into-vencord.mjs`.

## Conventions

- Anything unverified against live Vencord/Discord internals is marked
  `TODO(verify)` in code. Don't remove those without actually checking.
