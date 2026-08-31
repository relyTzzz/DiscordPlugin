/*
 * Bump the project version in one place and propagate it everywhere the version
 * is written by hand.
 *
 *   node scripts/bump-version.mjs patch    1.1.0 -> 1.1.1
 *   node scripts/bump-version.mjs minor    1.1.0 -> 1.2.0
 *   node scripts/bump-version.mjs major    1.1.0 -> 2.0.0
 *   node scripts/bump-version.mjs 1.5.2    set an explicit version
 *
 * Pass --no-bundle to only rewrite the version and skip the rebuild.
 *
 * Updates:
 *   - package.json            "version"
 *   - package-lock.json       top-level "version" and packages[""]("version")
 *   - dist/StreamWindows.plugin.js   the "@version" line in the BD meta header
 *       (only if the file exists; the `npm run bundle` below regenerates it
 *        from package.json anyway)
 *
 * Then runs `npm run bundle` (build:bd + build-bundle.mjs) so dist/ and the
 * shipped zip carry the new version. Skipped on a no-op bump or with --no-bundle.
 *
 * Does NOT touch git — no commit, no tag. Run it, eyeball the diff, commit yourself.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const noBundle = args.includes("--no-bundle");
const arg = args.find(a => !a.startsWith("-"));
if (!arg) {
    console.error("usage: node scripts/bump-version.mjs <major|minor|patch|X.Y.Z> [--no-bundle]");
    process.exit(1);
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
if (!SEMVER_RE.test(current)) {
    console.error(`package.json version "${current}" is not X.Y.Z — fix it first`);
    process.exit(1);
}

let next;
if (arg === "major" || arg === "minor" || arg === "patch") {
    let [major, minor, patch] = current.split(".").map(Number);
    if (arg === "major") { major++; minor = 0; patch = 0; }
    else if (arg === "minor") { minor++; patch = 0; }
    else { patch++; }
    next = `${major}.${minor}.${patch}`;
} else if (SEMVER_RE.test(arg)) {
    next = arg;
} else {
    console.error(`"${arg}" is neither major|minor|patch nor an X.Y.Z version`);
    process.exit(1);
}

if (next === current) {
    console.log(`version already ${current} — nothing to do`);
    process.exit(0);
}

/** Rewrite a JSON file's top-level "version" (and packages[""] for the lockfile)
 *  as text, so key order and formatting are left untouched. */
function patchJsonVersion(relPath, { lockfile = false } = {}) {
    const p = join(root, relPath);
    if (!existsSync(p)) {
        console.warn(`- ${relPath} not found, skipped`);
        return;
    }
    let text = readFileSync(p, "utf8");
    // top-level "version": "..." — the first one in the file
    text = text.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`);
    if (lockfile) {
        // packages[""] block also carries a "version"
        text = text.replace(
            /("":\s*\{[^}]*?"version":\s*")[^"]+(")/s,
            `$1${next}$2`
        );
    }
    writeFileSync(p, text);
    console.log(`+ ${relPath}`);
}

patchJsonVersion("package.json");
patchJsonVersion("package-lock.json", { lockfile: true });

const distPath = join(root, "dist", "StreamWindows.plugin.js");
if (existsSync(distPath)) {
    const text = readFileSync(distPath, "utf8");
    const patched = text.replace(/(@version\s+)\d+\.\d+\.\d+/, `$1${next}`);
    if (patched !== text) {
        writeFileSync(distPath, patched);
        console.log("+ dist/StreamWindows.plugin.js");
    }
}

console.log(`\nbumped ${current} -> ${next}`);

if (noBundle) {
    console.log("skipping bundle (--no-bundle)");
} else {
    console.log("\nrunning npm run bundle …\n");
    // string form + shell so Windows resolves npm.cmd (execFileSync on .cmd
    // throws EINVAL on modern Node)
    execSync("npm run bundle", { cwd: root, stdio: "inherit" });
}
