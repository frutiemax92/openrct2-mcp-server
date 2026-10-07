#!/usr/bin/env node
// Exporte context.getAllTrackSegments() vers data/track_segments.json (SPEC 12.2, spike S5).
// Le jeu doit être ouvert avec le plugin claude-bridge.
//   node tools/export-segments.mjs [dossier utilisateur]   (défaut : .userdata/)

import { readFileSync, writeFileSync } from "node:fs";
import { Socket } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const userDir = resolve(process.argv[2] ?? process.env.OPENRCT2_USER_DIR ?? join(root, ".userdata"));
const store = JSON.parse(readFileSync(join(userDir, "plugin.store.json"), "utf8"));
const token = store["claude-bridge.token"] ?? store["claude-bridge"]?.token;
const port = Number(process.env.OPENRCT2_PORT ?? 38491);

const socket = new Socket();
socket.setEncoding("utf8");
let buffer = "";
let nextId = 1;
const pending = new Map();
socket.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    }
});

function call(method, params = {}) {
    const id = `x-${nextId++}`;
    return new Promise((res, rej) => {
        pending.set(id, (m) => (m.ok ? res(m.result) : rej(new Error(`${method} : ${JSON.stringify(m.error)}`))));
        socket.write(JSON.stringify({ v: 1, id, method, params }) + "\n");
    });
}

await new Promise((res, rej) => {
    socket.once("error", rej);
    socket.connect(port, "127.0.0.1", res);
});
const hello = await call("session.hello", { token, clientVersion: "export-segments" });
const items = [];
let cursor = 0;
while (cursor !== null) {
    const page = await call("track.segments", { cursor, limit: 50 });
    items.push(...page.items);
    cursor = page.nextCursor;
}
const out = {
    source: `context.getAllTrackSegments(), apiVersion ${hello.apiVersion}`,
    count: items.length,
    segments: items,
};
const file = join(root, "data", "track_segments.json");
writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`${items.length} segments → ${file}`);
socket.end();
process.exit(0);
