#!/usr/bin/env node
// Lance OpenRCT2 (mode A, solo avec fenêtre) avec le plugin claude-bridge, dans un dossier utilisateur isolé.
//   node tools/game.mjs [parc.park | scénario.sc6] [-- options supplémentaires d'openrct2]
//
// Variables :
//   OPENRCT2_BIN        binaire du jeu (défaut : ../build/openrct2)
//   OPENRCT2_USER_DIR   dossier utilisateur (défaut : .userdata/ du dépôt, pour ne pas toucher ~/.config/OpenRCT2)
//   OPENRCT2_RCT2_PATH  fichiers de RCT2 (défaut : game_path du config.ini de l'utilisateur)
//   OPENRCT2_DATA_PATH  données d'OpenRCT2 (défaut : <dossier du binaire>/data si présent)
//
// Le dossier utilisateur reçoit un config.ini minimal (hot reload actif) et le plugin compilé.
// Sans argument, le jeu s'ouvre sur l'écran titre.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

export function gameUserDir() {
    return resolve(process.env.OPENRCT2_USER_DIR ?? join(root, ".userdata"));
}

function personalConfig() {
    const dir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
    const file = join(dir, "OpenRCT2", "config.ini");
    return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function rct2Path() {
    if (process.env.OPENRCT2_RCT2_PATH) return process.env.OPENRCT2_RCT2_PATH;
    return /^game_path\s*=\s*"(.*)"$/m.exec(personalConfig())?.[1] ?? "";
}

// Clés imposées. use_vsync : avec la vsync, une fenêtre masquée ou sur un autre bureau est limitée par le
// compositeur à ~1 image/s, et toute la boucle du jeu (donc la pompe du plugin) avec : 1 s par requête (SPIKES S9).
const FORCED = { enable_hot_reloading: "true", use_vsync: "false" };

/** config.ini minimal ; les clés déjà présentes sont conservées, sauf celles de FORCED. */
function writeConfig(userDir) {
    const file = join(userDir, "config.ini");
    if (existsSync(file)) {
        let text = readFileSync(file, "utf8");
        for (const [key, value] of Object.entries(FORCED)) {
            text = text.replace(new RegExp(`^${key}\\s*=.*$`, "m"), `${key} = ${value}`);
        }
        writeFileSync(file, text);
        return;
    }
    const game = rct2Path();
    if (!game) throw new Error("Chemin de RCT2 inconnu : définis OPENRCT2_RCT2_PATH.");
    writeFileSync(
        file,
        [
            "[general]",
            `game_path = "${game}"`,
            "play_intro = false",
            "confirmation_prompt = false",
            "autosave = 0",
            "scenario_unlocking_enabled = false",
            `use_vsync = ${FORCED.use_vsync}`,
            "",
            "[plugin]",
            `enable_hot_reloading = ${FORCED.enable_hot_reloading}`,
            'allowed_hosts = ""',
            "",
        ].join("\n"),
    );
}

function installPlugin(userDir) {
    const built = join(root, "packages", "plugin", "dist", "claude-bridge.js");
    if (!existsSync(built)) throw new Error("Plugin non compilé : lance d'abord « pnpm build ».");
    mkdirSync(join(userDir, "plugin"), { recursive: true });
    copyFileSync(built, join(userDir, "plugin", "claude-bridge.js"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const sep = args.indexOf("--");
    const extra = sep >= 0 ? args.slice(sep + 1) : [];
    const positional = sep >= 0 ? args.slice(0, sep) : args;

    const bin = resolve(process.env.OPENRCT2_BIN ?? join(root, "..", "build", "openrct2"));
    if (!existsSync(bin)) {
        console.error(`Binaire introuvable : ${bin} (définis OPENRCT2_BIN).`);
        process.exit(2);
    }
    const userDir = gameUserDir();
    mkdirSync(userDir, { recursive: true });
    writeConfig(userDir);
    installPlugin(userDir);

    const gameArgs = [];
    if (positional[0]) gameArgs.push(resolve(positional[0]));
    gameArgs.push(`--user-data-path=${userDir}`);
    // Build CMake non installé : les données sont dans build/usr/local/share/openrct2 (ou build/data).
    const dataPath = [process.env.OPENRCT2_DATA_PATH, join(dirname(bin), "data"), join(dirname(bin), "usr", "local", "share", "openrct2")]
        .filter(Boolean)
        .find((p) => existsSync(join(p, "language")));
    if (dataPath) gameArgs.push(`--openrct2-data-path=${dataPath}`);
    gameArgs.push(...extra);

    console.log(`[game] ${bin} ${gameArgs.join(" ")}`);
    console.log(`[game] serveur MCP : OPENRCT2_USER_DIR=${userDir}`);
    const child = spawn(bin, gameArgs, { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
}
