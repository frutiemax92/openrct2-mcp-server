#!/usr/bin/env node
// Bundle du plugin : un seul script IIFE ES2020, sans import/export ni Intl (ADR 0001).
//   node scripts/build.mjs [--watch] [--install]
// --install copie le fichier dans <dossier utilisateur OpenRCT2>/plugin/.

import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const outfile = join(pkg, "dist", "claude-bridge.js");
const watch = process.argv.includes("--watch");
const install = process.argv.includes("--install");

export function userDir() {
    if (process.env.OPENRCT2_USER_DIR) return process.env.OPENRCT2_USER_DIR;
    if (process.platform === "win32") return join(homedir(), "Documents", "OpenRCT2");
    if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "OpenRCT2");
    return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "OpenRCT2");
}

/** Vérifie les contraintes du moteur (QuickJS-NG, scripts globaux). Lève une erreur sinon. */
export function checkBundle(code) {
    const problems = [];
    if (/^\s*(import|export)\s/m.test(code)) problems.push("import/export au niveau module");
    if (/\bIntl\b/.test(code)) problems.push("référence à Intl");
    if (!/registerPlugin\(/.test(code)) problems.push("registerPlugin absent");
    if (problems.length) throw new Error(`Bundle invalide : ${problems.join(", ")}`);
}

const postBuild = {
    name: "post-build",
    setup(build) {
        build.onEnd((result) => {
            if (result.errors.length) return;
            const code = readFileSync(outfile, "utf8");
            try {
                checkBundle(code);
            } catch (e) {
                console.error(String(e));
                if (!watch) process.exitCode = 1;
                return;
            }
            console.log(`[plugin] ${outfile} (${(code.length / 1024).toFixed(1)} Ko)`);
            if (install) {
                const dest = join(userDir(), "plugin", "claude-bridge.js");
                mkdirSync(dirname(dest), { recursive: true });
                copyFileSync(outfile, dest);
                console.log(`[plugin] copié dans ${dest}`);
            }
        });
    },
};

const options = {
    entryPoints: [join(pkg, "src", "main.ts")],
    outfile,
    bundle: true,
    format: "iife",
    target: "es2020",
    platform: "neutral",
    charset: "utf8",
    legalComments: "none",
    logLevel: "warning",
    alias: { "@openrct2-claude/protocol": join(pkg, "..", "protocol", "src", "index.ts") },
    define: {
        __BRIDGE_DEFAULT_TOKEN__: JSON.stringify(process.env.OPENRCT2_TOKEN ?? ""),
        __BRIDGE_DEFAULT_PORT__: String(Number(process.env.OPENRCT2_PORT ?? 38491)),
    },
    plugins: [postBuild],
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("[plugin] watch…");
} else {
    await esbuild.build(options);
}
