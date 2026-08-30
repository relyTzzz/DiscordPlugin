/*
 * Junction-links src/StreamWindows into a Vencord checkout's src/userplugins/
 * so `pnpm build` in Vencord picks it up. Windows junctions don't need admin.
 *
 *   node scripts/link-into-vencord.mjs "C:\path\to\Vencord"
 *   node scripts/link-into-vencord.mjs --remove "C:\path\to\Vencord"
 *
 * The Vencord path is remembered in .vencord-path after the first run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const remove = args.includes("--remove");
const pathArg = args.find(a => !a.startsWith("--"));
const memo = join(root, ".vencord-path");

const vencord = pathArg
    ?? (existsSync(memo) ? readFileSync(memo, "utf8").trim() : null);

if (!vencord) {
    console.error("Pass your Vencord checkout path once: node scripts/link-into-vencord.mjs \"C:\\path\\to\\Vencord\"");
    process.exit(1);
}
if (!existsSync(join(vencord, "src"))) {
    console.error(`Not a Vencord checkout: ${vencord}`);
    process.exit(1);
}
writeFileSync(memo, vencord);

const userplugins = join(vencord, "src", "userplugins");
mkdirSync(userplugins, { recursive: true });
const linkPath = join(userplugins, "StreamWindows");
const target = join(root, "src", "StreamWindows");

if (existsSync(linkPath)) rmSync(linkPath, { recursive: true, force: true });
if (remove) {
    console.log("unlinked", linkPath);
    process.exit(0);
}

// mklink /J  <link> <target>   — directory junction, no admin needed
execFileSync("cmd", ["/c", "mklink", "/J", linkPath, target], { stdio: "inherit" });
console.log(`linked ${linkPath} -> ${target}`);
console.log("Now run `pnpm build` in the Vencord checkout and reload Discord (Ctrl+R).");
