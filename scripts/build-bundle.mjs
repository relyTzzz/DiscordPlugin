/*
 * Build the thing you actually send to someone: a zip containing the plugin file
 * and a PDF of the install guide.
 *
 *   node scripts/build-bundle.mjs        -> dist/StreamWindows-v<version>.zip
 *
 * The PDF is rendered by whatever Chromium-based browser is already installed
 * (Edge ships with Windows), so this pulls in no headless-browser download. If
 * none is found we fall back to putting INSTALL.md in the zip and say so, rather
 * than failing the build.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";


const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dist = join(root, "dist");
const plugin = join(dist, "StreamWindows.plugin.js");
const guideMd = join(root, "INSTALL.md");

if (!existsSync(plugin)) {
    console.error("dist/StreamWindows.plugin.js is missing — run `npm run build:bd` first.");
    process.exit(1);
}

/** Chromium-based browsers that can do --print-to-pdf, most likely first. */
function findBrowser() {
    const candidates = process.platform === "win32"
        ? [
            "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
            "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
        ]
        : process.platform === "darwin"
            ? [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
            ]
            : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"];
    return candidates.find(existsSync) ?? null;
}

const CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 11pt/1.55 "Segoe UI", system-ui, sans-serif; color: #16181d; }
  h1 { font-size: 21pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 20pt 0 6pt; padding-bottom: 3pt;
       border-bottom: 1px solid #d8dbe0; page-break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 14pt 0 4pt; page-break-after: avoid; }
  p, li { orphans: 2; widows: 2; }
  code { font: 10pt ui-monospace, Consolas, monospace; background: #f1f2f4;
         padding: 1px 4px; border-radius: 3px; }
  pre { background: #f1f2f4; padding: 8pt; border-radius: 5px; overflow-wrap: anywhere; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  th, td { border: 1px solid #d8dbe0; padding: 5pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f1f2f4; }
  blockquote { margin: 8pt 0; padding: 6pt 10pt; border-left: 3px solid #5865f2;
               background: #f6f7fb; }
  blockquote p { margin: 0; }
  hr { border: 0; border-top: 1px solid #d8dbe0; margin: 14pt 0; }
  a { color: #3b49df; text-decoration: none; }
  img { max-width: 100%; height: auto; border: 1px solid #d8dbe0; border-radius: 4px;
        display: block; margin: 8pt auto; page-break-inside: avoid; }
`;

async function renderPdf(outPdf) {
    const browser = findBrowser();
    if (!browser) {
        console.warn("! No Chromium-based browser found (Edge/Chrome) — cannot render the PDF.");
        return null;
    }

    const html = `<!doctype html><meta charset="utf-8">
<title>StreamWindows ${pkg.version} — Install Guide</title>
<base href="${pathToFileURL(root + "/").href}">
<style>${CSS}</style>
${marked.parse(readFileSync(guideMd, "utf8"))}`;

    const tmpHtml = join(dist, "_install.tmp.html");
    const tmpProfile = mkdtempSync(join(tmpdir(), "sw-browser-"));
    writeFileSync(tmpHtml, html, "utf8");
    try {
        execFileSync(browser, [
            "--headless=new",
            "--disable-gpu",
            "--no-pdf-header-footer",
            // Without a private profile, launching Edge/Chrome while a normal
            // window is open just hands the arguments to the running instance,
            // which ignores them and leaves an error page behind.
            `--user-data-dir=${tmpProfile}`,
            `--print-to-pdf=${outPdf}`,
            // a file:// URL, not a bare Windows path, or Chromium reports
            // ERR_FILE_NOT_FOUND and prints its error page instead
            pathToFileURL(tmpHtml).href
        ], { stdio: "ignore", timeout: 120000 });

        /*
         * The launcher process exits before rendering finishes, so returning here
         * and deleting the temp HTML is a race the browser loses — it then prints
         * its own "file not found" page into the PDF. Wait for the file to appear
         * and stop growing before letting the caller clean up.
         */
        const deadline = Date.now() + 60000;
        let lastSize = -1, stable = 0;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 250));
            if (!existsSync(outPdf)) continue;
            const size = statSync(outPdf).size;
            stable = size > 0 && size === lastSize ? stable + 1 : 0;
            lastSize = size;
            if (stable >= 3) return outPdf;      // ~750ms unchanged
        }
        console.warn("! PDF did not finish rendering within 60s");
        return existsSync(outPdf) ? outPdf : null;
    } catch (e) {
        console.warn("! PDF render failed:", e.message);
        return null;
    } finally {
        rmSync(tmpHtml, { force: true });
        // the browser can still be releasing profile locks as it exits; a failed
        // cleanup of a temp dir must never fail the build
        try {
            rmSync(tmpProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch { /* the OS will reap it from tmp */ }
    }
}

mkdirSync(dist, { recursive: true });
const pdf = join(dist, "StreamWindows - Install Guide.pdf");
const madePdf = await renderPdf(pdf);
if (madePdf) console.log("rendered", pdf);
else console.warn("! Shipping INSTALL.md instead of a PDF.");

const zipPath = join(dist, `StreamWindows-v${pkg.version}.zip`);
rmSync(zipPath, { force: true });

// Stage exactly what the recipient should see, then zip the staging folder.
// No zip library: Windows has Compress-Archive built in and other platforms have
// the zip CLI, which keeps this script dependency-free.
const stage = join(dist, "_bundle");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(plugin, join(stage, "StreamWindows.plugin.js"));
if (madePdf) cpSync(madePdf, join(stage, "StreamWindows - Install Guide.pdf"));
else cpSync(guideMd, join(stage, "INSTALL.md"));

try {
    if (process.platform === "win32") {
        execFileSync("powershell", [
            "-NoProfile", "-NonInteractive", "-Command",
            `Compress-Archive -Path '${stage.replace(/'/g, "''")}\*' ` +
            `-DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
        ], { stdio: "inherit" });
    } else {
        execFileSync("zip", ["-j", "-9", zipPath, ...readdirSync(stage).map(f => join(stage, f))],
            { stdio: "inherit" });
    }
} finally {
    rmSync(stage, { recursive: true, force: true });
}

if (!existsSync(zipPath)) {
    console.error("zip step produced no file");
    process.exit(1);
}
console.log(`built ${zipPath} (${(statSync(zipPath).size / 1024).toFixed(1)} KB)`);
console.log("send that one file — it has the plugin and the install guide.");
