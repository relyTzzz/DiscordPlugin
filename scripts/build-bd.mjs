/*
 * Build the BetterDiscord flavour: bundles src/bd/entry.ts (+ the shared core)
 * into a single dist/StreamWindows.plugin.js with BD's metadata header.
 *
 *   node scripts/build-bd.mjs            build once
 *   node scripts/build-bd.mjs --watch    rebuild on change
 *   node scripts/build-bd.mjs --install  also copy into the BD plugins folder
 *
 * BD evaluates a plugin file as CommonJS and expects module.exports to be the
 * plugin class, hence format: "cjs".
 */
import esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const watch = process.argv.includes("--watch");
const install = process.argv.includes("--install");

const OUT_NAME = "StreamWindows.plugin.js";
const outfile = join(root, "dist", OUT_NAME);

/*
 * BD's documented meta fields: name/author/description/version are required;
 * invite, authorId, authorLink, donate, patreon, website, source are optional.
 * There is no @updateUrl — BD only auto-updates addons from its own store, so a
 * side-loaded copy of this does not self-update.
 *
 * @source/@website are emitted only if package.json actually declares them, so
 * we never ship a link that doesn't exist.
 */
const repoUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
const optional = [
    repoUrl && ` * @source ${repoUrl.replace(/^git\+/, "").replace(/\.git$/, "")}`,
    pkg.homepage && ` * @website ${pkg.homepage}`
].filter(Boolean).join("\n");

const meta = `/**
 * @name StreamWindows
 * @author ${pkg.author}
 * @description ${pkg.description.split(" Builds as")[0]}
 * @version ${pkg.version}
${optional ? optional + "\n" : ""} */
`;

/** %APPDATA%\\BetterDiscord\\plugins on Windows, XDG/Library elsewhere */
function bdPluginsDir() {
    if (process.platform === "win32" && process.env.APPDATA)
        return join(process.env.APPDATA, "BetterDiscord", "plugins");
    if (process.platform === "darwin")
        return join(process.env.HOME ?? "", "Library", "Application Support", "BetterDiscord", "plugins");
    return join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "BetterDiscord", "plugins");
}

function installToBd() {
    const dir = bdPluginsDir();
    if (!existsSync(dir)) {
        console.warn(`! BetterDiscord plugins folder not found: ${dir}`);
        console.warn("  Install BetterDiscord first, or copy dist/" + OUT_NAME + " manually.");
        return;
    }
    copyFileSync(outfile, join(dir, OUT_NAME));
    console.log(`installed -> ${join(dir, OUT_NAME)}`);
}

const options = {
    entryPoints: [join(root, "src", "bd", "entry.ts")],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: ["esnext"],
    // BD plugins are read by humans in the plugins folder; keep it legible.
    minify: false,
    banner: { js: meta },
    logLevel: "info"
};

mkdirSync(join(root, "dist"), { recursive: true });

if (watch) {
    const ctx = await esbuild.context({
        ...options,
        plugins: [{
            name: "post-build",
            setup: b => b.onEnd(r => {
                if (r.errors.length) return;
                console.log("built", outfile);
                if (install) installToBd();
            })
        }]
    });
    await ctx.watch();
    console.log("watching…");
} else {
    await esbuild.build(options);
    console.log("built", outfile);
    if (install) installToBd();
}
