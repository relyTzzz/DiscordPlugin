/*
 * Push the public download repo. That repo is exactly two files — the built
 * plugin and its README — and nothing else; this script is the only way they
 * get there, so the private repo never has to track a copy.
 *
 *   node scripts/publish-public.mjs              stage + commit into the sibling checkout
 *   node scripts/publish-public.mjs --push       ...and push it
 *   node scripts/publish-public.mjs --repo <dir> use a checkout somewhere else
 *
 * The sibling checkout defaults to ../StreamWindows (next to this repo, the same
 * way the Vencord checkout sits beside it). Create it once with:
 *
 *   git clone https://github.com/<you>/StreamWindows ../StreamWindows
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const args = process.argv.slice(2);
const push = args.includes("--push");
const repoArg = args[args.indexOf("--repo") + 1];
const target = resolve(root, repoArg && !repoArg.startsWith("--") ? repoArg : "../StreamWindows");

/** exactly what lands in the public repo: source in dist/ -> name in the repo root */
const FILES = [
    ["dist/StreamWindows.plugin.js", "StreamWindows.plugin.js"],
    ["dist/README.md", "README.md"],
    ["dist/two-streams-windowed.png", "two-streams-windowed.png"]
];

function die(msg) {
    console.error(msg);
    process.exit(1);
}

function git(cwd, ...a) {
    return execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim();
}

for (const [src] of FILES) {
    if (!existsSync(join(root, src))) die(`${src} is missing — run \`npm run build:bd\` first.`);
}

if (!existsSync(join(target, ".git"))) {
    die(`No git checkout at ${target}\n` +
        `Clone the public repo there first:\n` +
        `  git clone https://github.com/<you>/StreamWindows "${target}"\n` +
        `or point this at an existing checkout with --repo <dir>.`);
}

// Guard against copying into the wrong repo (e.g. this one).
let origin = "";
try { origin = git(target, "remote", "get-url", "origin"); } catch { /* no origin */ }
if (/DiscordPlugin(\.git)?$/i.test(origin)) {
    die(`${target} points at the private repo (${origin}). Refusing to publish into it.`);
}
console.log(`target : ${target}`);
console.log(`origin : ${origin || "(none)"}`);

for (const [src, dest] of FILES) {
    copyFileSync(join(root, src), join(target, dest));
    console.log(`copied : ${src} -> ${dest} (${(statSync(join(target, dest)).size / 1024).toFixed(1)} KB)`);
}

git(target, "add", "--", ...FILES.map(([, d]) => d));
const staged = git(target, "diff", "--cached", "--name-only");
if (!staged) {
    console.log("\nNothing changed — public repo already matches this build.");
    process.exit(0);
}

const msg = `Publish StreamWindows v${pkg.version}`;
git(target, "commit", "-m", msg);
console.log(`\ncommitted: ${msg}`);
console.log(git(target, "show", "--stat", "--oneline", "HEAD"));

if (push) {
    const branch = git(target, "rev-parse", "--abbrev-ref", "HEAD");
    execFileSync("git", ["-C", target, "push", "origin", branch], { stdio: "inherit" });
    console.log(`\npushed to origin/${branch}.`);
} else {
    console.log(`\nNot pushed. Review it, then:  git -C "${target}" push`);
    console.log("or re-run with --push.");
}
