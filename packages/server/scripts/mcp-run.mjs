#!/usr/bin/env node
// Lance le serveur MCP (stdio) et exécute une séquence d'appels d'outils, comme le ferait Claude.
//   node packages/server/scripts/mcp-run.mjs '[["session_info",{}],["get_region_map",{"x1":0,"y1":0,"x2":30,"y2":30}]]' [dossier-images]
// Variables : OPENRCT2_USER_DIR, OPENRCT2_PORT… (transmises au serveur).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "..", "dist", "index.js");
const steps = JSON.parse(process.argv[2] ?? "[]");
const imageDir = process.argv[3];

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...process.env, LOG_LEVEL: process.env.LOG_LEVEL ?? "warn" },
    stderr: "inherit",
});
const client = new Client({ name: "mcp-run", version: "0.1.0" });
await client.connect(transport);

let n = 0;
for (const [name, args] of steps) {
    const t = performance.now();
    const res = await client.callTool({ name, arguments: args ?? {} });
    const ms = Math.round(performance.now() - t);
    console.log(`\n=== ${name} ${JSON.stringify(args ?? {})} (${ms} ms)${res.isError ? " ERREUR" : ""}`);
    for (const c of res.content) {
        if (c.type === "text") console.log(c.text);
        else if (c.type === "image") {
            n++;
            if (imageDir) {
                mkdirSync(imageDir, { recursive: true });
                const file = join(imageDir, `${String(n).padStart(2, "0")}-${name}.png`);
                writeFileSync(file, Buffer.from(c.data, "base64"));
                console.log(`[image] ${file}`);
            } else console.log(`[image ${c.mimeType}, ${c.data.length} octets base64]`);
        }
    }
}
await client.close();
