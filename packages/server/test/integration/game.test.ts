// Tests d'intégration contre le vrai jeu (SPEC 15.1, niveau 3). Exige une partie ouverte avec le plugin :
//   pnpm game <parc>   puis   OPENRCT2_USER_DIR=.userdata pnpm test:integration
//
// Le scénario construit dans une zone de travail (OPENRCT2_IT_AREA="x,y", défaut 48,20 ; 14×12 tuiles),
// puis restaure un checkpoint pris au départ : le parc revient à son état initial.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Bridge } from "../../src/bridge.js";
import { loadConfig, readToken } from "../../src/config.js";
import { configureLog } from "../../src/log.js";
import { createServer } from "../../src/server.js";

const [AX, AY] = (process.env.OPENRCT2_IT_AREA ?? "48,20").split(",").map(Number);
const CHECKPOINT = "it-start";

let bridge: Bridge;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
    const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text?: string }[]; isError?: boolean };
    const text = res.content.find((c) => c.type === "text")?.text ?? "";
    let json: any = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }
    return { json, text, images: res.content.filter((c) => c.type === "image").length, isError: !!res.isError };
}

async function ok(name: string, args: Record<string, unknown> = {}) {
    const r = await call(name, args);
    if (r.isError) throw new Error(`${name} : ${r.text}`);
    return r.json;
}

beforeAll(async () => {
    configureLog("error", null);
    const config = loadConfig();
    bridge = new Bridge({ host: config.host, port: config.port, token: () => readToken(config.userDir) ?? config.token, clientVersion: "integration" });
    const { server } = createServer(bridge, config);
    bridge.start();
    await bridge.ensureConnected();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    client = new Client({ name: "integration", version: "0" });
    await client.connect(b);
}, 30_000);

afterAll(async () => {
    bridge?.stop();
    await client?.close();
});

describe("vrai jeu (mode A)", () => {
    let initialRides = 0;

    it("handshake : solo, API 124, captures disponibles", async () => {
        const info = await ok("session_info");
        expect(info.connected).toBe(true);
        expect(info.plugin.apiVersion).toBeGreaterThanOrEqual(124);
        expect(info.plugin.networkMode).toBe("none");
        expect(info.capabilities.captureImage).toBe(true);
        initialRides = (await ok("list_rides")).rides.length;
        await ok("checkpoint_save", { name: CHECKPOINT });
    });

    it("construit entrée, allée, attraction 3×3, boutique, tous raccordés", async () => {
        await ok("session_set_mode", { mode: "sandbox" });
        const area = { x1: AX, y1: AY, x2: AX + 13, y2: AY + 11 };
        await ok("land_set_ownership", { mode: "set_owned", ...area });
        await ok("terrain_flatten", { ...area, level: "auto" });
        const ent = await ok("park_set_entrance", { x: AX + 6, y: AY + 11, direction: 3 });
        const inside = ent.insideAccess;
        const path = await ok("path_build", { points: [inside, { x: inside.x, y: AY + 5 }, { x: AX + 12, y: AY + 5 }] });
        expect(path.failures).toEqual([]);
        const ride = await ok("ride_place", { object: await firstPlaceable("merry_go_round", "circus", "space_rings", "twist"), x: AX + 9, y: AY + 2, direction: 1 });
        expect(ride.connected).toBe(true);
        expect(ride.footprint.x2 - ride.footprint.x1).toBe(2);
        const shop = await ok("ride_place", { object: await firstPlaceable("food_stall"), x: inside.x - 1, y: AY + 8, direction: 2 });
        expect(shop.kind).toBe("shop");
        expect(shop.connected).toBe(true);
        const conn = await ok("path_check_connectivity", { x1: AX - 2, y1: AY - 2, x2: AX + 15, y2: AY + 15 });
        expect(conn.ridesWithProblems).toEqual([]);
    });

    it("capture : une image PNG", async () => {
        const r = await call("capture_view", { x: AX + 6, y: AY + 6, zoom: 1, rotation: 0, width: 640, height: 360 });
        expect(r.isError).toBe(false);
        expect(r.images).toBe(1);
    });

    it("phase 2 : audit, mobilier, scénerie générative sans échec", async () => {
        const area = { x1: AX - 2, y1: AY - 2, x2: AX + 15, y2: AY + 15 };
        const audit = await ok("landscape_audit", { ...area, checks: ["connectivity"] });
        expect(audit.issues.map((i: { type: string }) => i.type)).not.toContain("ride_unconnected");
        const furniture = await ok("path_add_furniture", area);
        expect(furniture.failures).toEqual([]);
        expect(furniture.changed.elements).toBeGreaterThan(0);
        const scatter = await ok("scenery_scatter_zone", { zoneType: "meadow", x1: AX, y1: AY, x2: AX + 4, y2: AY + 4, seed: 1, densityScale: 2 });
        expect(scatter.failures).toEqual([]);
    });

    it("phase 2 : colline et lac valides, annulables", async () => {
        const hill = await ok("terrain_shape", { op: "hill", center: { x: AX + 20, y: AY + 6 }, radius: 4, height: 3 });
        expect(hill.failures).toEqual([]);
        expect(hill.levels.after.max).toBeGreaterThan(hill.levels.before.max);
        const lake = await ok("water_create_lake", { x1: AX + 27, y1: AY, x2: AX + 34, y2: AY + 6, depth: 2 });
        expect(lake.failures).toEqual([]);
        expect(lake.changed.water).toBeGreaterThan(10);
        const undo = await ok("undo_last", { count: 2 });
        expect(undo.undone).toHaveLength(2);
        expect(undo.warnings).toEqual([]);
    });

    it("phase 2 : capture annotée et planche-contact", async () => {
        const one = await call("capture_view", { x: AX + 6, y: AY + 6, zoom: 1, width: 640, height: 360, annotate: true });
        expect(one.isError).toBe(false);
        expect(one.text).toContain("grille annotée");
        const sheet = await call("capture_contact_sheet", { x: AX + 6, y: AY + 6, zoom: 2, width: 480, height: 270 });
        expect(sheet.images).toBe(1);
    });

    it("checkpoint : restauration rapide, connexion conservée, état initial retrouvé", async () => {
        const t = Date.now();
        await ok("checkpoint_restore", { name: CHECKPOINT });
        expect(Date.now() - t).toBeLessThan(10_000);
        expect((await ok("list_rides")).rides.length).toBe(initialRides);
    });
});

async function firstPlaceable(...rideTypes: string[]): Promise<string> {
    for (const rideType of rideTypes) {
        for (let cursor = 0; cursor !== null; ) {
            const page = await ok("list_objects", { type: "ride", loadedOnly: true, cursor });
            const hit = page.items.find((i: { rideType: string; placeable: boolean }) => i.rideType === rideType && i.placeable);
            if (hit) return hit.id;
            cursor = page.nextCursor;
        }
    }
    throw new Error(`Aucun objet chargé parmi ${rideTypes.join(", ")}.`);
}
