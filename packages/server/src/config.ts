// Configuration par variables d'environnement (SPEC 8.1).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_HOST, DEFAULT_PORT, TOKEN_STORAGE_KEY } from "@openrct2-claude/protocol";

export interface Config {
    host: string;
    port: number;
    token: string | null;
    userDir: string;
    bin: string | null;
    logLevel: "debug" | "info" | "warn" | "error";
    logFile: string | null;
    enableDebugEval: boolean;
    sessionId: string;
}

export function defaultUserDir(): string {
    if (process.platform === "win32") return join(homedir(), "Documents", "OpenRCT2");
    if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "OpenRCT2");
    return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "OpenRCT2");
}

/** Jeton : OPENRCT2_TOKEN, sinon celui que le plugin a mémorisé dans plugin.store.json. */
export function readToken(userDir: string, env = process.env): string | null {
    if (env.OPENRCT2_TOKEN) return env.OPENRCT2_TOKEN;
    const store = join(userDir, "plugin.store.json");
    if (!existsSync(store)) return null;
    try {
        const data = JSON.parse(readFileSync(store, "utf8")) as Record<string, unknown>;
        const direct = data[TOKEN_STORAGE_KEY];
        if (typeof direct === "string") return direct;
        // sharedStorage peut imbriquer les clés pointées : { "claude-bridge": { "token": … } }
        const [ns, key] = TOKEN_STORAGE_KEY.split(".");
        const nested = (data[ns] as Record<string, unknown> | undefined)?.[key];
        return typeof nested === "string" ? nested : null;
    } catch {
        return null;
    }
}

export function loadConfig(env = process.env): Config {
    const userDir = env.OPENRCT2_USER_DIR ?? defaultUserDir();
    const level = (env.LOG_LEVEL ?? "info") as Config["logLevel"];
    return {
        host: env.OPENRCT2_HOST ?? DEFAULT_HOST,
        port: Number(env.OPENRCT2_PORT ?? DEFAULT_PORT),
        token: readToken(userDir, env),
        userDir,
        bin: env.OPENRCT2_BIN ?? null,
        logLevel: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
        logFile: env.OPENRCT2_LOG_FILE ?? null,
        enableDebugEval: false,
        sessionId: new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14),
    };
}

export const paths = {
    screenshots: (c: Config) => join(c.userDir, "screenshot"),
    saves: (c: Config) => join(c.userDir, "save"),
};
