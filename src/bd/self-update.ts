/*
 * BD-only self-updater.
 *
 * BetterDiscord natively updates *only* addons published to its store — the
 * client diffs installed addons against the store API and knows nothing about a
 * `@updateUrl` in a side-loaded file (verified against the BD docs, 2026-08). So
 * a hand-installed StreamWindows would never self-update. This fills that gap for
 * the public build: on start it fetches the raw plugin file from the download
 * repo, compares `@version`, and — with the user's OK — overwrites the installed
 * file. BD's plugins-folder watcher then hot-reloads it.
 *
 * This lives in the BD adapter, not core, on purpose: every line is about BD's
 * install model (plugins folder, BdApi.Net, file-watch reload) and has no
 * Vencord meaning. Vencord ships its own updater.
 *
 * __SW_UPDATE_URL__ / __SW_VERSION__ are injected by scripts/build-bd.mjs from
 * package.json (esbuild `define`); an empty update URL disables the checker.
 */

declare const BdApi: any;
declare const require: (m: string) => any;
declare const process: any;
declare const __SW_UPDATE_URL__: string;
declare const __SW_VERSION__: string;

const ADDON_NAME = "StreamWindows";

type Log = (...a: any[]) => void;

/** BD 1.9-ish moved these under BdApi.UI; older builds had them on BdApi. */
const UI = (): any => (BdApi.UI ?? BdApi);

function parseVersion(src: string): string | null {
    const m = src.match(/@version\s+([0-9]+(?:\.[0-9]+)*(?:-[0-9A-Za-z.-]+)?)/);
    return m ? m[1] : null;
}

/** >0 if a newer than b, <0 if older, 0 if equal. Pre-release tags are ignored. */
function cmpVersion(a: string, b: string): number {
    const na = a.split("-")[0].split(".").map(n => parseInt(n, 10) || 0);
    const nb = b.split("-")[0].split(".").map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
        const d = (na[i] ?? 0) - (nb[i] ?? 0);
        if (d) return d;
    }
    return 0;
}

async function fetchText(url: string): Promise<string> {
    // BdApi.Net.fetch bypasses Discord's CSP; global fetch is the fallback and
    // works here because raw.githubusercontent.com sends permissive CORS.
    const net = BdApi?.Net?.fetch;
    const res = net ? await net(url, { cache: "no-cache" }) : await fetch(url, { cache: "no-cache" });
    if (res && res.ok === false) throw new Error(`HTTP ${res.status}`);
    return await res.text();
}

/** Where BD installed us, so we can overwrite the right file. */
function installedFile(): string {
    const path = require("path");
    // TODO(verify): BdApi.Plugins.get(name) exposes .filename and BdApi.Plugins
    // .folder is the plugins dir. Both hold on BD stable as of writing.
    const meta = BdApi?.Plugins?.get?.(ADDON_NAME) ?? {};
    const folder = BdApi?.Plugins?.folder
        ?? path.join(process.env.APPDATA || "", "BetterDiscord", "plugins");
    return path.join(folder, meta.filename || `${ADDON_NAME}.plugin.js`);
}

export function makeSelfUpdater(log: Log) {
    let busy = false;

    /**
     * @param silent when true (the on-start check), stay quiet unless an update
     *        is actually available — no "up to date" / "check failed" toasts.
     */
    async function check({ silent = false }: { silent?: boolean; } = {}): Promise<void> {
        if (!__SW_UPDATE_URL__) { log("self-update disabled (no update URL in build)"); return; }
        if (busy) return;
        busy = true;
        try {
            const remoteSrc = await fetchText(__SW_UPDATE_URL__);
            const remote = parseVersion(remoteSrc);
            if (!remote) throw new Error("remote file has no @version");

            const local = __SW_VERSION__ || BdApi?.Plugins?.get?.(ADDON_NAME)?.version || "0.0.0";
            if (cmpVersion(remote, local) <= 0) {
                log(`up to date (installed ${local}, remote ${remote})`);
                if (!silent) UI().showToast?.(`StreamWindows is up to date (v${local})`, { type: "success" });
                return;
            }

            log(`update available: ${local} -> ${remote}`);
            UI().showConfirmationModal?.(
                "StreamWindows update",
                `Version ${remote} is available — you have ${local}. Update now?`,
                {
                    confirmText: "Update",
                    cancelText: "Later",
                    onConfirm: () => {
                        try {
                            const dest = installedFile();
                            require("fs").writeFileSync(dest, remoteSrc);
                            log(`wrote ${dest}; BD will reload the plugin`);
                            UI().showToast?.(`StreamWindows updated to v${remote}`, { type: "success" });
                        } catch (e: any) {
                            log("update write failed", e?.message);
                            UI().showToast?.(`StreamWindows update failed: ${e?.message}`, { type: "error" });
                        }
                    }
                }
            );
        } catch (e: any) {
            log("update check failed", e?.message);
            if (!silent) UI().showToast?.(`StreamWindows update check failed: ${e?.message}`, { type: "error" });
        } finally {
            busy = false;
        }
    }

    return { check };
}
