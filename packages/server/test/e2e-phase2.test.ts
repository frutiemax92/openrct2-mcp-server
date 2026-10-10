// Phase 2 (SPEC 16.3) de bout en bout contre le faux plugin : terraformage, eau, zones et scénerie générative,
// mobilier, audit, cartes annotées, captures annotées et planches-contacts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { World } from "@openrct2-claude/fake-plugin";
import { cornerLevels, tileFromCorners } from "../src/planners/heightmap.js";
import { tileCenterZ, worldToPixel } from "../src/render/projection.js";
import { startHarness, type Harness } from "./harness.js";

let h: Harness;

beforeEach(async () => {
    h = await startHarness(new World(64, 64, 7));
});

afterEach(async () => {
    await h.close();
});

const types = (r: { json: { issues: { type: string }[] } }) => r.json.issues.map((i) => i.type);

/** Entrée du parc + avenue nord-sud + rue est-ouest (deux impasses en bout de rue). */
async function smallNetwork(): Promise<void> {
    expect((await h.call("session_set_mode", { mode: "sandbox" })).isError).toBe(false);
    expect((await h.call("park_set_entrance", { x: 32, y: 60, direction: 3, spawnDistance: 2 })).isError).toBe(false);
    expect((await h.call("path_build", { points: [{ x: 32, y: 59 }, { x: 32, y: 30 }] })).isError).toBe(false);
    expect((await h.call("path_build", { points: [{ x: 20, y: 30 }, { x: 44, y: 30 }] })).isError).toBe(false);
}

describe("outils de la Phase 2", () => {
    it("sont tous exposés", async () => {
        const tools = (await h.client.listTools()).tools.map((t) => t.name);
        for (const name of [
            "terrain_shape",
            "water_create_lake",
            "zones_paint",
            "zones_get",
            "scenery_scatter_zone",
            "path_add_furniture",
            "landscape_audit",
            "capture_contact_sheet",
            "staff_hire",
            "staff_list",
            "checkpoint_save",
            "checkpoint_restore",
            "run_time",
        ]) {
            expect(tools).toContain(name);
        }
    });
});

describe("terrain_shape et water_create_lake", () => {
    beforeEach(async () => {
        await h.call("session_set_landscape", { allowed: true, userRequest: "modèle le terrain" });
    });

    it("une colline donne des pentes valides, s'annule avec undo_last", async () => {
        await h.call("session_set_mode", { mode: "sandbox" });
        const r = await h.call("terrain_shape", { op: "hill", center: { x: 30, y: 30 }, radius: 6, height: 4 });
        expect(r.isError).toBe(false);
        expect(r.json.changed.tiles).toBeGreaterThan(30);
        const w = h.plugin.world;
        expect(w.tile(30, 30).h).toBeGreaterThanOrEqual(10);
        for (let y = 22; y <= 38; y++)
            for (let x = 22; x <= 38; x++) {
                const t = w.tile(x, y);
                expect(tileFromCorners(cornerLevels(t))).not.toBeNull();
            }
        // Bord de la zone de travail intact
        expect(w.tile(23, 30).h).toBe(7);
        expect((await h.call("undo_last")).json.undone).toHaveLength(1);
        expect(w.tile(30, 30)).toMatchObject({ h: 7, s: 0 });
    });

    it("plateau : surface plate au niveau demandé, talus autour", async () => {
        await h.call("session_set_mode", { mode: "sandbox" });
        const r = await h.call("terrain_shape", { op: "plateau", x1: 20, y1: 20, x2: 26, y2: 24, level: 10 });
        expect(r.isError).toBe(false);
        const w = h.plugin.world;
        for (let y = 20; y <= 24; y++) for (let x = 20; x <= 26; x++) expect(w.tile(x, y)).toMatchObject({ h: 10, s: 0 });
        expect(w.tile(19, 22).s).not.toBe(0);
    });

    it("bruit et lissage restent valides et reproductibles", async () => {
        await h.call("session_set_mode", { mode: "sandbox" });
        const a = await h.call("terrain_shape", { op: "noise", x1: 5, y1: 5, x2: 40, y2: 40, amplitude: 3, scale: 6, seed: 9, dryRun: true });
        const b = await h.call("terrain_shape", { op: "noise", x1: 5, y1: 5, x2: 40, y2: 40, amplitude: 3, scale: 6, seed: 9, dryRun: true });
        expect(a.json.changed).toEqual(b.json.changed);
        expect((await h.call("terrain_shape", { op: "noise", x1: 5, y1: 5, x2: 40, y2: 40, amplitude: 3, scale: 6, seed: 9 })).isError).toBe(false);
        expect((await h.call("terrain_shape", { op: "smooth", x1: 5, y1: 5, x2: 40, y2: 40, iterations: 2 })).isError).toBe(false);
        const w = h.plugin.world;
        for (let y = 5; y <= 40; y++) for (let x = 5; x <= 40; x++) expect(tileFromCorners(cornerLevels(w.tile(x, y)))).not.toBeNull();
    });

    it("refuse une forme incomplète avec un message clair", async () => {
        const r = await h.call("terrain_shape", { op: "hill", center: { x: 10, y: 10 } });
        expect(r.isError).toBe(true);
        expect(r.json.error.code).toBe("INVALID_PARAMS");
    });

    it("un lac creuse un bassin, le remplit, et s'annule", async () => {
        await h.call("session_set_mode", { mode: "sandbox" });
        const r = await h.call("water_create_lake", { x1: 20, y1: 20, x2: 32, y2: 28, depth: 2 });
        expect(r.isError).toBe(false);
        expect(r.json.waterLevel).toBe(7);
        const w = h.plugin.world;
        const c = w.tile(26, 24);
        expect(c.w).toBe(7);
        expect(c.h).toBe(5);
        // Rive : bord du rectangle au niveau d'origine, sans eau
        expect(w.tile(20, 20)).toMatchObject({ h: 7, w: 0 });
        const map = await h.call("get_region_map", { x1: 18, y1: 18, x2: 34, y2: 30, format: "text" });
        expect(map.text[1]).toContain("~");
        // Pas de trou : toute tuile dont un coin est sous la surface est remplie (bords de l'ellipse compris)
        for (let y = 20; y <= 28; y++)
            for (let x = 20; x <= 32; x++) {
                const t = w.tile(x, y);
                if (Math.min(...cornerLevels(t)) < 7) expect(t.w, `tuile (${x},${y})`).toBe(7);
            }
        await h.call("undo_last");
        expect(w.tile(26, 24)).toMatchObject({ h: 7, w: 0 });
    });
});

describe("zones et scénerie générative", () => {
    it("peindre, lire, simuler, remplir, annuler", async () => {
        await smallNetwork();
        const paint = await h.call("zones_paint", { type: "forest_dense", x1: 2, y1: 2, x2: 28, y2: 20 });
        expect(paint.json.summary).toContain("513 tuile(s)");
        await h.call("zones_paint", { type: "path_border", x1: 33, y1: 31, x2: 44, y2: 40 });
        const get = await h.call("zones_get", { x1: 0, y1: 0, x2: 40, y2: 32 });
        expect(get.text[1]).toContain("F");
        expect(get.text[1]).toContain("#");

        const dry = await h.call("scenery_scatter_zone", { zoneType: "forest_dense", seed: 3, dryRun: true });
        expect(dry.isError).toBe(false);
        expect(dry.json.summary).toContain("[simulation]");
        const before = h.plugin.world.tiles.reduce((n, t) => n + t.small.length, 0);
        expect(before).toBe(0);

        const real = await h.call("scenery_scatter_zone", { zoneType: "forest_dense", seed: 3 });
        expect(real.isError).toBe(false);
        expect(real.json.changed.elements).toBeGreaterThan(150);
        expect(real.json.byRole.tree_conifer).toBeGreaterThan(50);
        expect(real.json.byRole.rock ?? 0).toBeLessThan(real.json.byRole.tree_conifer);
        const w = h.plugin.world;
        const placed = w.tiles.reduce((n, t) => n + t.small.length, 0);
        expect(placed).toBe(real.json.changed.elements);
        // Dégagement de 2 tuiles le long de la rue (y = 30) pour forest_dense
        for (let x = 2; x <= 28; x++) expect(w.tile(x, 29).small).toHaveLength(0);

        const border = await h.call("scenery_scatter_zone", { x1: 33, y1: 31, x2: 44, y2: 40, seed: 1 });
        expect(border.json.changed.elements).toBeGreaterThan(0);
        for (let y = 31; y <= 40; y++)
            for (let x = 33; x <= 44; x++) if (w.tile(x, y).small.length) expect(Math.min(Math.abs(y - 30), Math.abs(x - 32))).toBeLessThanOrEqual(1);

        await h.call("undo_last", { count: 2 });
        expect(w.tiles.reduce((n, t) => n + t.small.length, 0)).toBe(0);
    });

    it("les zones survivent à un checkpoint", async () => {
        await h.call("zones_paint", { type: "meadow", x1: 5, y1: 5, x2: 9, y2: 9 });
        expect((await h.call("checkpoint_save", { name: "zones" })).isError).toBe(false);
        await h.call("zones_paint", { type: "none", x1: 0, y1: 0, x2: 63, y2: 63 });
        expect((await h.call("zones_get")).json.zones).toHaveLength(0);
        expect((await h.call("checkpoint_restore", { name: "zones" })).isError).toBe(false);
        expect((await h.call("zones_get")).json.zones).toEqual([{ type: "meadow", tiles: 25, bbox: { x1: 5, y1: 5, x2: 9, y2: 9 } }]);
    });

    it("thème inconnu et zone vide renvoient un hint", async () => {
        const r = await h.call("scenery_scatter_zone", { theme: "lunaire", zoneType: "meadow", x1: 1, y1: 1, x2: 5, y2: 5 });
        expect(r.json.error.code).toBe("NOT_FOUND");
        expect(r.json.error.hint).toContain("temperate");
        const e = await h.call("scenery_scatter_zone", {});
        expect(e.json.error.hint).toContain("zones_paint");
    });
});

describe("path_add_furniture", () => {
    it("pose bancs, poubelles et lampadaires espacés, sans doublon au second passage", async () => {
        await smallNetwork();
        const r = await h.call("path_add_furniture", { x1: 10, y1: 25, x2: 50, y2: 62 });
        expect(r.isError).toBe(false);
        expect(r.json.placed.bench).toBeGreaterThan(2);
        expect(r.json.placed.bin).toBeGreaterThan(2);
        expect(r.json.placed.lamp).toBeGreaterThan(4);
        const again = await h.call("path_add_furniture", { x1: 10, y1: 25, x2: 50, y2: 62 });
        expect(again.json.existing.bench).toBe(r.json.placed.bench);
        expect(again.json.changed.elements).toBeLessThan(3);
        await h.call("undo_last", { count: 2 });
        expect(h.plugin.world.tiles.some((t) => t.paths.some((p) => p.a))).toBe(false);
    });
});

describe("landscape_audit : critère « Vision » (SPEC 1.3)", () => {
    it("détecte puis fait corriger une attraction non raccordée, des impasses et des zones vides", async () => {
        await smallNetwork();
        // Défaut 1 : attraction posée sans raccord, entrée et sortie côté rue.
        const mgr = await h.call("ride_place", { object: "rct2.ride.mgr1", x: 26, y: 26, entrance: { x: 26, y: 28 }, exit: { x: 27, y: 28 }, connectToPath: false });
        expect(mgr.isError).toBe(false);

        const audit = await h.call("landscape_audit", { image: true });
        expect(audit.isError).toBe(false);
        expect(audit.images).toBe(1);
        const found = types(audit);
        expect(found).toContain("ride_unconnected");
        expect(found).toContain("path_dead_end");
        expect(found).toContain("empty_area");
        expect(audit.json.issues[0].severity).toBe("high");
        // L'allée extérieure vers le point d'apparition n'est pas une impasse à corriger.
        const dead = audit.json.issues.find((i: { type: string }) => i.type === "path_dead_end");
        expect(dead.tiles).not.toContainEqual({ x: 32, y: 62 });

        // La carte d'analyse montre les mêmes problèmes.
        const map = await h.call("get_region_map", { x1: 10, y1: 20, x2: 50, y2: 63, format: "png", analysis: true });
        expect(map.json.analysis.unconnectedRides).toHaveLength(1);
        expect(map.json.analysis.deadEnds.items.length).toBeGreaterThan(0);

        // Corrections.
        expect((await h.call("path_build", { points: [{ x: 26, y: 29 }], queue: true })).isError).toBe(false);
        expect((await h.call("path_build", { points: [{ x: 27, y: 29 }] })).isError).toBe(false);
        expect((await h.call("path_build", { points: [{ x: 20, y: 30 }, { x: 20, y: 40 }, { x: 44, y: 40 }, { x: 44, y: 30 }] })).isError).toBe(false);
        for (const r of audit.json.issues.find((i: { type: string }) => i.type === "empty_area").rects) {
            const fill = await h.call("scenery_scatter_zone", { zoneType: "forest_dense", ...r, maxItems: 1500, seed: 2 });
            expect(fill.isError).toBe(false);
        }

        const after = await h.call("landscape_audit", { checks: ["connectivity", "empty"] });
        expect(types(after)).not.toContain("ride_unconnected");
        expect(types(after)).not.toContain("path_dead_end");
        expect(after.json.issues.find((i: { type: string }) => i.type === "empty_area")?.count ?? 0).toBeLessThan(
            audit.json.issues.find((i: { type: string }) => i.type === "empty_area").count,
        );
    });

    it("signale le manque de mobilier et la scénerie en grille", async () => {
        await smallNetwork();
        const items = [];
        for (let y = 2; y <= 20; y += 2) for (let x = 2; x <= 20; x += 2) items.push({ role: "tree_conifer", x, y });
        await h.call("scenery_place", { items });
        const r = await h.call("landscape_audit", { checks: ["furniture", "regularity"] });
        expect(types(r)).toContain("missing_bin");
        expect(types(r)).toContain("regular_grid");
    });
});

describe("personnel", () => {
    it("embauche avec ordres et patrouille, liste, annule", async () => {
        await smallNetwork();
        const r = await h.call("staff_hire", { type: "handyman", count: 2, orders: ["sweeping", "empty_bins"], patrol: { x1: 20, y1: 25, x2: 44, y2: 40 } });
        expect(r.isError).toBe(false);
        expect(r.json.ids).toHaveLength(2);
        await h.call("staff_hire", { type: "mechanic" });
        const list = await h.call("staff_list");
        expect(list.json.byType).toEqual({ handyman: 2, mechanic: 1 });
        expect(list.json.staff[0]).toMatchObject({ type: "handyman", orders: ["sweeping", "empty_bins"], patrolTiles: 25 * 16 });
        expect((await h.call("staff_hire", { type: "security", orders: ["mowing"] })).json.error.code).toBe("INVALID_PARAMS");
        await h.call("undo_last", { count: 2 });
        expect((await h.call("staff_list")).json.staff).toHaveLength(0);
    });
});

describe("captures annotées", () => {
    it("projection : décalages de F28 à rotation 0 et symétrie des rotations", () => {
        const view = { centerX: 16, centerY: 16, centerZ: 0, zoom: 0, rotation: 0, width: 200, height: 100 };
        const c = worldToPixel(view, 16, 16, 0);
        expect(c).toEqual({ px: 100, py: 50 });
        expect(worldToPixel(view, 48, 16, 0)).toEqual({ px: 68, py: 66 });
        expect(worldToPixel(view, 16, 48, 0)).toEqual({ px: 132, py: 66 });
        // Rotation 2 : la vue est retournée.
        const v2 = { ...view, rotation: 2 };
        expect(worldToPixel(v2, 48, 16, 0)).toEqual({ px: 132, py: 34 });
        // Zoom 1 : décalages divisés par 2 ; une marche (16) monte l'image.
        expect(worldToPixel({ ...view, zoom: 1 }, 48, 16, 16)).toEqual({ px: 84, py: 50 });
        expect(tileCenterZ([5, 5, 5, 5])).toBe(80);
        expect(tileCenterZ([6, 6, 5, 5])).toBe(88);
    });

    it("capture_view annotée et planche-contact renvoient une seule image", async () => {
        const one = await h.call("capture_view", { x: 30, y: 30, annotate: true, highlight: [{ x: 30, y: 30 }] });
        expect(one.isError).toBe(false);
        expect(one.images).toBe(1);
        const sheet = await h.call("capture_contact_sheet", { x: 30, y: 30 });
        expect(sheet.isError).toBe(false);
        expect(sheet.images).toBe(1);
        expect(sheet.json.views).toEqual(["R0", "R1", "R2", "R3"]);
    });
});
