#!/usr/bin/env node
// Client de spike (Phase 0) : parle au plugin claude-bridge en NDJSON brut et exécute une expérience.
//   node tools/spike.mjs <user-dir> <expérience> [args JSON]
//   node tools/spike.mjs ~/.config/OpenRCT2 call map.tile '{"x":10,"y":10}'
// Expériences : hello, call <méthode> <params>, s9 (mesures de performance).

import { readFileSync } from "node:fs";
import { Socket } from "node:net";
import { join } from "node:path";

const [userDir, experiment, ...rest] = process.argv.slice(2);
if (!userDir || !experiment) {
    console.error("usage : node tools/spike.mjs <user-dir> <hello|call|s9> [méthode] [params JSON]");
    process.exit(2);
}
const store = JSON.parse(readFileSync(join(userDir, "plugin.store.json"), "utf8"));
const token = store["claude-bridge.token"] ?? store["claude-bridge"]?.token;
const port = Number(process.env.OPENRCT2_PORT ?? 38491);

const socket = new Socket();
socket.setEncoding("utf8");
let buffer = "";
let nextId = 1;
const pending = new Map();
const events = [];
socket.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        const msg = JSON.parse(line);
        if (msg.event) {
            events.push(msg);
            continue;
        }
        const p = pending.get(msg.id);
        if (p) {
            pending.delete(msg.id);
            p(msg);
        }
    }
});

export function call(method, params = {}) {
    const id = `s-${nextId++}`;
    return new Promise((resolve) => {
        pending.set(id, resolve);
        socket.write(JSON.stringify({ v: 1, id, method, params }) + "\n");
    });
}

async function timed(label, fn) {
    const t = performance.now();
    const r = await fn();
    const ms = performance.now() - t;
    console.log(JSON.stringify({ label, ms: Math.round(ms * 10) / 10, ok: r?.ok }));
    return r;
}

await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.connect(port, "127.0.0.1", resolve);
});
const hello = await call("session.hello", { token, clientVersion: "spike" });
if (!hello.ok) {
    console.error(JSON.stringify(hello));
    process.exit(1);
}

if (experiment === "hello") {
    console.log(JSON.stringify(hello.result, null, 1));
} else if (experiment === "call") {
    const [method, params] = rest;
    const r = await call(method, params ? JSON.parse(params) : {});
    console.log(JSON.stringify(r, null, 1));
    // Laisse le temps aux événements différés (map_changed).
    await new Promise((r) => setTimeout(r, Number(process.env.WAIT_EVENTS_MS ?? 0)));
    if (events.length) console.log(JSON.stringify({ events }, null, 1));
} else if (experiment === "s9") {
    const n = 20;
    let total = 0;
    for (let i = 0; i < n; i++) {
        const t = performance.now();
        await call("session.ping");
        total += performance.now() - t;
    }
    console.log(JSON.stringify({ label: "ping aller-retour moyen", ms: Math.round((total / n) * 10) / 10 }));
    const size = (await call("map.size")).result;
    await timed(`map.region 64×64`, () => call("map.region", { x1: 0, y1: 0, x2: 63, y2: 63 }));
    await timed(`map.region 128×128`, () => call("map.region", { x1: 0, y1: 0, x2: Math.min(127, size.x - 1), y2: Math.min(127, size.y - 1) }));
    const [x0, y0] = rest.length ? JSON.parse(rest[0]) : [10, 10];
    const items = [];
    for (let i = 0; i < 400; i++) items.push({ object: process.env.SPIKE_SCENERY ?? 0, x: x0 + (i % 20), y: y0 + Math.floor(i / 20), quadrant: 0 });
    await timed("scenery.place_small 400 (query)", () => call("scenery.place_small", { items, dryRun: true }));
    await timed("objects.list installés (25)", () => call("objects.list", { limit: 25 }));
    await timed("capture.view 1920×1080", () => call("capture.view", { name: "spike-s9", center: { x: Math.floor(size.x / 2), y: Math.floor(size.y / 2) }, width: 1920, height: 1080, zoom: 0, rotation: 0 }));
}
socket.end();
process.exit(0);
