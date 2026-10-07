// Enregistrement de session (SPEC 8.7) : appels et réponses tronquées, en JSONL, pour rejouer ou analyser.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const MAX_TEXT = 2000;

export class SessionRecorder {
    private seq = 0;

    constructor(private readonly file: string) {
        mkdirSync(dirname(file), { recursive: true });
    }

    record(tool: string, args: unknown, res: CallToolResult): void {
        const content = res.content.map((c) =>
            c.type === "text" ? { type: "text", text: c.text.length > MAX_TEXT ? c.text.slice(0, MAX_TEXT) + "…" : c.text } : { type: c.type },
        );
        const line = JSON.stringify({ seq: ++this.seq, t: new Date().toISOString(), tool, args, isError: !!res.isError, content });
        try {
            appendFileSync(this.file, line + "\n");
        } catch {
            // ignoré
        }
    }
}
