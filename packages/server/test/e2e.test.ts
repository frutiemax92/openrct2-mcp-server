// Tests de bout en bout : client MCP → serveur → faux plugin (SPEC 15.1, contrats ; 1.3 critère MVP).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { World } from "@openrct2-claude/fake-plugin";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;

beforeEach(async () => {
    h = await startHarness(new World(64, 64, 7));
});

afterEach(async () => {
    await h.close();
});

describe("session et observation", () => {
    it("liste les outils P1 avec des descriptions", async () => {
        const tools = (await h.client.listTools()).tools.map((t) => t.name);
        for (const name of [
            "session_info",
            "session_set_mode",
            "session_set_paused",
            "list_objects",
            "load_objects",
            "get_park_overview",
            "get_region_map",
            "inspect_tile",
            "capture_view",
            "list_rides",
            "get_ride",
            "terrain_flatten",
            "terrain_set_surface",
            "session_set_landscape",
            "land_set_ownership",
            "path_build",
            "path_remove",
            "path_check_connectivity",
            "ride_place",
            "ride_set_status",
            "ride_configure",
            "ride_get_report",
            "ride_demolish",
            "park_set_entrance",
            "park_configure",
            "scenery_place",
            "scenery_remove",
            "undo_last",
        ]) {
            expect(tools).toContain(name);
        }
    });

    it("session_info résume la connexion et le parc", async () => {
        const r = await h.call("session_info");
        expect(r.isError).toBe(false);
        expect(r.json.connected).toBe(true);
        expect(r.json.mapSize).toEqual({ x: 64, y: 64 });
        expect(r.json.mode).toBe("strict");
    });

    it("list_objects filtre par rôle et indique les attractions plaçables", async () => {
        const trees = await h.call("list_objects", { type: "small_scenery", role: "tree_conifer", loadedOnly: true });
        expect(trees.json.items.map((i: { id: string }) => i.id)).toEqual(["rct2.scenery_small.tcf", "rct2.scenery_small.tsp"]);
        const rides = await h.call("list_objects", { type: "ride", loadedOnly: true });
        const mgr = rides.json.items.find((i: { id: string }) => i.id === "rct2.ride.mgr1");
        expect(mgr).toMatchObject({ category: "gentle", placeable: true });
    });

    it("load_objects signale les objets inconnus", async () => {
        const r = await h.call("load_objects", { identifiers: ["rct2.ride.chpsh", "inexistant.obj"] });
        expect(r.json.loaded).toHaveLength(1);
        expect(r.json.failed[0].id).toBe("inexistant.obj");
    });

    it("get_region_map renvoie une carte texte bornée et un PNG", async () => {
        const r = await h.call("get_region_map", { x1: 0, y1: 0, x2: 20, y2: 10, format: "both" });
        expect(r.text[1].split("\n")).toHaveLength(12);
        expect(r.images).toBe(1);
        const tooBig = await h.call("get_region_map", { x1: 0, y1: 0, x2: 63, y2: 63, format: "text", layer: "height" });
        expect(tooBig.isError).toBe(false);
        const err = await h.call("get_region_map", { x1: 0, y1: 0, x2: 100, y2: 100, format: "text" });
        expect(err.isError).toBe(false); // borné à la carte (64×64)
    });
});

describe("erreurs actionnables", () => {
    it("path_build refuse une pente irrégulière sans rien poser", async () => {
        h.plugin.world.tile(12, 10).s = 1;
        const r = await h.call("path_build", { points: [{ x: 10, y: 10 }, { x: 14, y: 10 }] });
        expect(r.isError).toBe(true);
        expect(r.json.error.code).toBe("BAD_SLOPE");
        // Relief verrouillé par défaut (SPEC 9.2) : le hint ne propose de terrasser qu'avec l'accord de l'utilisateur.
        expect(r.json.error.hint).not.toContain("terrain_flatten");
        expect(h.plugin.world.tile(10, 10).paths).toHaveLength(0);
        await h.call("session_set_landscape", { allowed: true, userRequest: "tu peux aplanir" });
        const again = await h.call("path_build", { points: [{ x: 10, y: 10 }, { x: 14, y: 10 }] });
        expect(again.json.error.hint).toContain("terrain_flatten");
    });

    it("le relief reste intact sans l'accord de l'utilisateur", async () => {
        const w = h.plugin.world;
        await h.call("session_set_mode", { mode: "sandbox" });
        const before = w.tile(20, 20).h;
        const r = await h.call("terrain_flatten", { x1: 18, y1: 18, x2: 22, y2: 22, level: before + 3 });
        expect(r.isError).toBe(true);
        expect(r.json.error.code).toBe("NOT_SUPPORTED_IN_MODE");
        expect(r.json.error.hint).toContain("session_set_landscape");
        expect(w.tile(20, 20).h).toBe(before);
        expect((await h.call("terrain_flatten", { x1: 18, y1: 18, x2: 22, y2: 22, level: before + 3, dryRun: true })).isError).toBe(false);
        expect(w.tile(20, 20).h).toBe(before);
        for (const [tool, args] of [
            ["terrain_set_surface", { x1: 18, y1: 18, x2: 22, y2: 22, surface: "rct2.terrain_surface.sand" }],
            ["terrain_shape", { op: "hill", center: { x: 20, y: 20 }, radius: 4, height: 3 }],
            ["water_create_lake", { x1: 18, y1: 18, x2: 26, y2: 24, depth: 2 }],
        ] as const) {
            const res = await h.call(tool, args);
            expect(res.json.error?.code, tool).toBe("NOT_SUPPORTED_IN_MODE");
        }
        expect((await h.call("session_set_landscape", { allowed: true })).isError).toBe(true);
        expect((await h.call("session_info")).json.landscapeAllowed).toBe(false);
        expect((await h.call("session_set_landscape", { allowed: true, userRequest: "aplanis la zone" })).isError).toBe(false);
        expect((await h.call("terrain_flatten", { x1: 18, y1: 18, x2: 22, y2: 22, level: before + 3 })).isError).toBe(false);
        expect(w.tile(20, 20).h).toBe(before + 3);
        await h.call("session_set_landscape", { allowed: false });
        expect((await h.call("terrain_flatten", { x1: 18, y1: 18, x2: 22, y2: 22, level: before })).isError).toBe(true);
    });

    it("en mode strict, le terrain non possédé bloque la construction", async () => {
        const r = await h.call("path_build", { points: [{ x: 0, y: 5 }, { x: 3, y: 5 }] });
        expect(r.isError).toBe(false);
        expect(r.json.summary).toMatch(/Rien posé/);
        expect(r.json.failures[0].code).toBe("NOT_OWNED");
        expect(r.json.next_hints[0]).toContain("land_set_ownership");
    });

    it("park_set_entrance exige le mode sandbox", async () => {
        const r = await h.call("park_set_entrance", { x: 32, y: 60, direction: 3 });
        expect(r.isError).toBe(true);
        expect(r.json.error.code).toBe("NOT_SUPPORTED_IN_MODE");
    });

    it("ride_place refuse un coaster avec un hint", async () => {
        await h.call("load_objects", { identifiers: ["rct2.ride.rct1.wooden"] });
        const r = await h.call("ride_place", { object: "rct2.ride.rct1.wooden", x: 20, y: 20 });
        expect(r.isError).toBe(true);
        expect(r.json.error.code).toBe("NOT_SUPPORTED_IN_MODE");
    });
});

describe("reconnexion", () => {
    it("le serveur se reconnecte après une coupure", async () => {
        await h.call("session_info");
        h.plugin.dropClient();
        await new Promise((r) => setTimeout(r, 200));
        const r = await h.call("get_park_overview");
        expect(r.isError).toBe(false);
    });
});

describe("scénario MVP (SPEC 1.3)", () => {
    it("construit un petit parc jouable en moins de 80 appels", async () => {
        const w = h.plugin.world;
        expect((await h.call("session_info")).json.connected).toBe(true);
        expect((await h.call("session_set_mode", { mode: "sandbox" })).isError).toBe(false);
        expect((await h.call("session_set_landscape", { allowed: true, userRequest: "aplanis le terrain du parc" })).isError).toBe(false);
        expect((await h.call("terrain_flatten", { x1: 10, y1: 20, x2: 50, y2: 62, level: "auto" })).isError).toBe(false);

        const ent = await h.call("park_set_entrance", { x: 32, y: 60, direction: 3, spawnDistance: 2 });
        expect(ent.isError).toBe(false);
        expect(ent.json.insideAccess).toEqual({ x: 32, y: 59 });

        const avenue = await h.call("path_build", { points: [{ x: 32, y: 59 }, { x: 32, y: 30 }] });
        expect(avenue.json.changed.tiles).toBe(30);
        expect(avenue.json.localNetwork.touchesParkEntrance).toBe(true);
        const street = await h.call("path_build", { points: [{ x: 20, y: 30 }, { x: 44, y: 30 }] });
        expect(street.isError).toBe(false);

        const mgr = await h.call("ride_place", { object: "rct2.ride.mgr1", x: 26, y: 26, direction: 0, name: "Carrousel" });
        expect(mgr.isError).toBe(false);
        expect(mgr.json.connected).toBe(true);
        expect(mgr.json.footprint).toEqual({ x1: 25, y1: 25, x2: 27, y2: 27 });
        const twist = await h.call("ride_place", { object: "rct2.ride.twist1", x: 38, y: 26, direction: 0 });
        expect(twist.json.connected).toBe(true);

        for (const [object, x] of [["rct2.ride.burgb", 28], ["rct2.ride.drnks", 34], ["rct2.ride.tlt1", 40]] as const) {
            const shop = await h.call("ride_place", { object, x, y: 31, direction: 3 });
            expect(shop.isError).toBe(false);
            expect(shop.json.kind).toBe("shop");
            expect(shop.json.connected).toBe(true);
        }

        const trees = await h.call("scenery_place", {
            items: [
                { role: "tree_conifer", x: 20, y: 24 },
                { role: "tree_deciduous", x: 21, y: 24 },
                { role: "shrub", x: 22, y: 24, quadrant: 1 },
                { role: "flower", x: 31, y: 40 },
            ],
        });
        expect(trees.json.changed.elements).toBe(4);

        const conn = await h.call("path_check_connectivity");
        expect(conn.json.ridesWithProblems).toEqual([]);
        expect(conn.json.components).toHaveLength(1);
        expect(conn.json.parkEntrances[0].connected).toBe(true);

        const rides = await h.call("list_rides");
        expect(rides.json.rides).toHaveLength(5);
        expect(rides.json.rides.every((r: { status: string }) => r.status === "open")).toBe(true);
        expect((await h.call("park_configure", { open: true, entranceFee: 0 })).isError).toBe(false);
        expect(w.parkOpen).toBe(true);
        expect(h.calls).toBeLessThan(80);

        const map = await h.call("get_region_map", { x1: 18, y1: 22, x2: 46, y2: 62, format: "text", diff: false });
        expect(map.text[1]).toContain("E");
        expect(map.json.legend.join(" ")).toContain("Carrousel");
    });
});

describe("journal, undo et checkpoints", () => {
    it("undo_last retire la dernière scénerie posée puis le chemin", async () => {
        await h.call("session_set_mode", { mode: "sandbox" });
        await h.call("path_build", { points: [{ x: 10, y: 10 }, { x: 15, y: 10 }] });
        await h.call("scenery_place", { items: [{ object: "rct2.scenery_small.tcf", x: 12, y: 12 }] });
        expect(h.plugin.world.tile(12, 12).small).toHaveLength(1);
        let r = await h.call("undo_last");
        expect(r.json.undone).toHaveLength(1);
        expect(h.plugin.world.tile(12, 12).small).toHaveLength(0);
        r = await h.call("undo_last");
        expect(h.plugin.world.tile(12, 10).paths).toHaveLength(0);
    });

    it("undo_last annule ride_place (démolition + raccords)", async () => {
        await h.call("session_set_mode", { mode: "sandbox" });
        await h.call("path_build", { points: [{ x: 10, y: 20 }, { x: 20, y: 20 }] });
        const placed = await h.call("ride_place", { object: "rct2.ride.mgr1", x: 15, y: 16, direction: 0 });
        expect(placed.json.connected).toBe(true);
        await h.call("undo_last");
        expect(h.plugin.world.rides).toHaveLength(0);
        expect(h.plugin.world.tile(15, 18).paths.length + h.plugin.world.tile(14, 18).paths.length + h.plugin.world.tile(16, 18).paths.length).toBe(0);
    });

    it("checkpoint_save puis checkpoint_restore remet l'état", async () => {
        await h.call("session_set_mode", { mode: "sandbox" });
        await h.call("path_build", { points: [{ x: 5, y: 5 }, { x: 8, y: 5 }] });
        expect((await h.call("checkpoint_save", { name: "t1" })).isError).toBe(false);
        await h.call("path_build", { points: [{ x: 5, y: 7 }, { x: 8, y: 7 }] });
        expect((await h.call("checkpoint_list")).json.checkpoints[0].name).toBe("t1");
        const r = await h.call("checkpoint_restore", { name: "t1" });
        expect(r.isError).toBe(false);
        expect(h.plugin.world.tile(6, 7).paths).toHaveLength(0);
        expect(h.plugin.world.tile(6, 5).paths).toHaveLength(1);
    });

    it("capture_view lit l'image écrite par le jeu", async () => {
        const r = await h.call("capture_view", { x: 10, y: 10 });
        expect(r.isError).toBe(false);
        expect(r.images).toBe(1);
    });
});
