// Journal structuré JSONL (SPEC 8.7). Jamais sur stdout : stdout porte le transport MCP.

import { appendFileSync } from "node:fs";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

let minLevel: Level = "info";
let file: string | null = null;

export function configureLog(level: Level, logFile: string | null): void {
    minLevel = level;
    file = logFile;
}

function write(level: Level, msg: string, data?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...data });
    process.stderr.write(line + "\n");
    if (file) {
        try {
            appendFileSync(file, line + "\n");
        } catch {
            // ignoré
        }
    }
}

export const log = {
    debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};

/** Compteurs d'observabilité : appels, erreurs par code, taille des réponses. */
export const metrics = {
    calls: new Map<string, { count: number; errors: number; totalMs: number; totalChars: number }>(),
    errorsByCode: new Map<string, number>(),
    record(tool: string, ms: number, chars: number, errorCode?: string) {
        const m = this.calls.get(tool) ?? { count: 0, errors: 0, totalMs: 0, totalChars: 0 };
        m.count++;
        m.totalMs += ms;
        m.totalChars += chars;
        if (errorCode) {
            m.errors++;
            this.errorsByCode.set(errorCode, (this.errorsByCode.get(errorCode) ?? 0) + 1);
        }
        this.calls.set(tool, m);
    },
};
