// Style Picker et Magic Fill (SPEC 13.7) : planificateur, masque des captures, et parcours complet contre le faux
// plugin (style enregistré en jeu → base de styles → demande Magic Fill → pose sans dégagement → undo_last).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { World } from "@openrct2-claude/fake-plugin";
import type { MagicFillRequest, StyleElement, StyleRecord } from "@openrct2-claude/protocol";
import { cornerLevels, tileFromCorners } from "../src/planners/heightmap.js";
import { planMagicFill, type FillOptions, type FillTargetTile } from "../src/planners/magicFill.js";
import { regionMask } from "../src/render/mask.js";
import { columnsOf, relevance, summarize } from "../src/styles/store.js";
import { startHarness, type Harness } from "./harness.js";

const OPTS: FillOptions = { seed: 1, density: 1, rotate: false, occupied: "skip", avoidPaths: true, include: ["small_scenery", "large_scenery", "wall"], matchWater: true };

function style(id: string, w: number, h: number, elements: Partial<StyleElement>[], extra: Partial<StyleRecord> = {}): StyleRecord {
    const tiles: [number, number][] = [];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) tiles.push([dx, dy]);
    return {
        format: 1,
        id,
        caption: id,
        createdAt: "2026-10-10T00:00:00Z",
        source: "user",
        park: null,
        origin: { x: 10, y: 10 },
        size: { x: w, y: h },
        tiles,
        surfaces: tiles.map(([dx, dy]) => ({ dx, dy, baseHeight: 14, slope: 0, surface: "grass", edge: "rock", water: 0, grassLength: 0, ownership: 0, parkFences: 0 })),
        elements: elements.map((e) => ({ t: "small_scenery", dx: 0, dy: 0, baseHeight: 14, clearanceHeight: 22, dz: 0, occupiedQuadrants: 15, object: "tree", direction: 0, quadrant: 0, colours: [1, 2, 3], ...e }) as StyleElement),
        objects: {},
        rides: [],
        screenshots: [],
        ...extra,
    };
}

/** Gratte-ciel RCT1 comme le Style Picker le relève : 4×4, colonne 2×2 au centre 16 niveaux plus haut, bordure Skyscraper, aucun objet. */
function tower(id: string, edge = "rct1ll.terrain_edge.skyscraper_b", name = "Skyscraper (B)"): StyleRecord {
    const s = style(id, 4, 4, [], { objects: { [edge]: { type: "terrain_edge", name } } });
    s.surfaces = s.surfaces.map((t) => ({ ...t, edge, baseHeight: t.dx >= 1 && t.dx <= 2 && t.dy >= 1 && t.dy <= 2 ? 46 : 14 }));
    return s;
}

function target(w: number, h: number, base = 20): FillTargetTile[] {
    const out: FillTargetTile[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push({ x: 50 + x, y: 60 + y, baseHeight: base, slope: 0, water: 0, blocked: false, occupied: false });
    return out;
}

describe("planificateur Magic Fill", () => {
    it("recopie un patch tel quel sans rotation : positions, couleurs, objets au sol en hauteur automatique", () => {
        const s = style("a", 1, 1, [{ object: "tree" }, { object: "flower", quadrant: 2, direction: 1, baseHeight: 18, dz: 4, colours: [5, 6, 7] }]);
        const plan = planMagicFill(target(3, 2), [{ record: s, weight: 1 }], OPTS);
        expect(plan.small).toHaveLength(12);
        const tree = plan.small.find((i) => i.object === "tree")!;
        expect(tree.baseHeight).toBeNull();
        expect(tree.colours).toEqual([1, 2, 3]);
        // Empilé à +4 baseHeight au-dessus du sol du style : +4 au-dessus du sol cible (20).
        const flower = plan.small.find((i) => i.object === "flower")!;
        expect(flower.baseHeight).toBe(24);
        expect(flower.quadrant).toBe(2);
        expect(flower.direction).toBe(1);
        expect(plan.tiles.filled).toBe(6);
    });

    it("tourne direction, quadrant et bord de mur avec le patch", () => {
        const s = style("a", 2, 1, [
            { object: "rock", dx: 1, dy: 0, quadrant: 0, direction: 0 },
            { t: "wall", object: "fence", dx: 0, dy: 0, direction: 3 },
        ]);
        for (let seed = 0; seed < 20; seed++) {
            const plan = planMagicFill(target(6, 6), [{ record: s, weight: 1 }], { ...OPTS, rotate: true, seed });
            for (const r of plan.small) expect(r.quadrant).toBe(r.direction);
            for (const w of plan.walls) expect([0, 1, 2, 3]).toContain(w.edge);
            const k = new Set(plan.small.map((r) => r.direction));
            if (k.size > 1) return;
        }
        throw new Error("aucune rotation tirée en 20 graines");
    });

    it("est déterministe pour une graine, et la densité éclaircit", () => {
        const s = style("a", 3, 3, [{ object: "tree", dx: 1, dy: 1 }, { object: "bush", dx: 0, dy: 2 }, { object: "bush", dx: 2, dy: 0 }]);
        const a = planMagicFill(target(10, 10), [{ record: s, weight: 1 }], { ...OPTS, rotate: true, seed: 7 });
        const b = planMagicFill(target(10, 10), [{ record: s, weight: 1 }], { ...OPTS, rotate: true, seed: 7 });
        expect(a).toEqual(b);
        const thin = planMagicFill(target(10, 10), [{ record: s, weight: 1 }], { ...OPTS, rotate: true, seed: 7, density: 0.3 });
        expect(thin.small.length).toBeLessThan(a.small.length);
        // Chaque tuile cible reçoit une tuile de style ; les vides du style restent vides.
        expect(a.tiles.filled + a.tiles.empty).toBe(100);
        expect(a.tiles.empty).toBeGreaterThan(0);
    });

    it("évite chemins et scénerie existante, vide la scénerie en mode replace", () => {
        const s = style("a", 1, 1, [{ object: "tree" }]);
        const t = target(3, 1);
        t[0].blocked = true;
        t[1].occupied = true;
        const skip = planMagicFill(t, [{ record: s, weight: 1 }], OPTS);
        expect(skip.small.map((i) => i.x)).toEqual([52]);
        expect(skip.tiles.skippedBlocked).toBe(1);
        expect(skip.tiles.skippedOccupied).toBe(1);
        const replace = planMagicFill(t, [{ record: s, weight: 1 }], { ...OPTS, occupied: "replace" });
        expect(replace.small).toHaveLength(2);
        expect(replace.clear).toEqual([{ x: 51, y: 60 }]);
    });

    it("ne pose pas une tuile de terre sur l'eau (matchWater) et garde l'écart à l'eau", () => {
        const land = style("land", 1, 1, [{ object: "tree" }]);
        const pond = style("pond", 1, 1, [{ object: "lily", baseHeight: 18, dz: 4 }]);
        pond.surfaces[0].water = 18;
        const t = target(2, 1);
        t[1].water = 26;
        const plan = planMagicFill(t, [{ record: land, weight: 1 }, { record: pond, weight: 1 }], OPTS);
        expect(plan.small.find((i) => i.x === 50)?.object).toBe("tree");
        const lily = plan.small.find((i) => i.x === 51)!;
        expect(lily.object).toBe("lily");
        expect(lily.baseHeight).toBeNull();
        const onlyLand = planMagicFill(t, [{ record: land, weight: 1 }], OPTS);
        expect(onlyLand.tiles.waterMismatch).toBe(1);
    });

    it("garde sous l'eau un rocher posé sur le lit (pas de hauteur automatique, qui le poserait sur l'eau)", () => {
        const bed = style("bed", 1, 1, [{ object: "rock", baseHeight: 10, clearanceHeight: 12 }, { object: "reed", baseHeight: 12, clearanceHeight: 16 }]);
        Object.assign(bed.surfaces[0], { baseHeight: 10, water: 12 });
        const t = target(1, 1, 16);
        t[0].water = 20;
        const plan = planMagicFill(t, [{ record: bed, weight: 1 }], OPTS);
        expect(plan.small.find((i) => i.object === "rock")!.baseHeight).toBe(16);
        // Sur l'eau dans le style : toujours en hauteur automatique (posé sur l'eau).
        expect(plan.small.find((i) => i.object === "reed")!.baseHeight).toBeNull();
        // Lit moins profond que l'objet : sommet ramené sous la surface, jamais sous le lit.
        t[0].water = 17;
        const shallow = planMagicFill(t, [{ record: bed, weight: 1 }], OPTS);
        expect(shallow.small.find((i) => i.object === "rock")!.baseHeight).toBe(16);
    });

    it("pose une grande scénerie seulement si toute son emprise tombe dans la région", () => {
        const big = style("big", 3, 3, [
            { t: "large_scenery", object: "castle", dx: 1, dy: 1, sequence: 0, direction: 0, origin: { dx: 1, dy: 1, baseHeight: 14 } },
            { t: "large_scenery", object: "castle", dx: 2, dy: 1, sequence: 1, direction: 0, origin: { dx: 1, dy: 1, baseHeight: 14 } },
        ]);
        big.objects.castle = { type: "large_scenery", name: "Castle", tiles: [{ x: 0, y: 0, z: 0 }, { x: 32, y: 0, z: 0 }] };
        const fits = planMagicFill(target(3, 3), [{ record: big, weight: 1 }], OPTS);
        expect(fits.large.length).toBeGreaterThan(0);
        expect(fits.large[0].baseHeight).toBe(20);
        const narrow = planMagicFill(target(1, 3), [{ record: big, weight: 1 }], OPTS);
        expect(narrow.large).toHaveLength(0);
        expect(narrow.notPlaced).toEqual({});
    });

    // Colline 5×5 : sommets à 7 + distance au bord (niveaux 7 à 9).
    function hill(id: string): StyleRecord {
        const s = style("hill-" + id, 5, 5, [{ dx: 2, dy: 2, baseHeight: 18 }]);
        const f = (vx: number, vy: number) => 7 + Math.min(vx, 5 - vx, vy, 5 - vy);
        s.surfaces = s.surfaces.map((t) => {
            const c = tileFromCorners([f(t.dx, t.dy), f(t.dx + 1, t.dy), f(t.dx + 1, t.dy + 1), f(t.dx, t.dy + 1)])!;
            return { ...t, baseHeight: c.level * 2, slope: c.slope };
        });
        return s;
    }

    it("recopie le relief du style (relief: copy), adouci vers le bord, sans toucher aux chemins", () => {
        const t = target(9, 9);
        t[40].blocked = true;
        const plan = planMagicFill(t, [{ record: hill("a"), weight: 1 }], { ...OPTS, relief: "copy" });
        expect(plan.terrain.length).toBeGreaterThan(0);
        expect(plan.relief.maxRise).toBeGreaterThan(0);
        expect(plan.relief.maxRise).toBeLessThanOrEqual(2);
        expect(plan.relief.cliffs).toBe(0);
        const after = new Map(plan.terrain.map((a) => [`${a.x},${a.y}`, a]));
        expect(after.has(`${t[40].x},${t[40].y}`)).toBe(false);
        for (const a of plan.terrain) {
            const c = cornerLevels({ h: a.level, s: a.slope ?? 0 });
            expect(Math.min(...c)).toBeGreaterThanOrEqual(10);
            // Bord de la région : les sommets extérieurs restent au niveau d'origine.
            if (a.x === 50) expect([c[0], c[3]]).toEqual([10, 10]);
            if (a.y === 68) expect([c[2], c[3]]).toEqual([10, 10]);
        }
        // La scénerie est posée sur le terrain remodelé (au sol : hauteur automatique).
        expect(plan.small.every((i) => i.baseHeight === null)).toBe(true);
    });

    it("garde les falaises et la pleine hauteur du style (plateau à falaise de 3 niveaux)", () => {
        // Style 5×5 au niveau 7, plateau central 3×3 au niveau 10 : falaise verticale, sans pente.
        const s = style("cliff", 5, 5, [{}]);
        s.surfaces = s.surfaces.map((t) => (t.dx >= 1 && t.dx <= 3 && t.dy >= 1 && t.dy <= 3 ? { ...t, baseHeight: 20 } : t));
        const plan = planMagicFill(target(15, 15), [{ record: s, weight: 1 }], { ...OPTS, relief: "copy" });
        expect(plan.relief.invalid).toBe(0);
        expect(plan.relief.maxRise).toBe(3);
        expect(plan.relief.cliffs).toBeGreaterThan(0);
        const after = new Map(plan.terrain.map((a) => [`${a.x},${a.y}`, a]));
        // Un plateau entier, loin du bord : plat à 10 + 3, et ses voisins hors plateau restent au pied (10).
        const tops = plan.terrain.filter((a) => a.level === 13 && (a.slope ?? 0) === 0);
        expect(tops.length).toBeGreaterThanOrEqual(9);
        const foot = tops.some((a) => {
            const n = after.get(`${a.x + 1},${a.y}`);
            return !n || n.level === 10;
        });
        expect(foot).toBe(true);
        for (const a of plan.terrain) {
            const c = cornerLevels({ h: a.level, s: a.slope ?? 0 });
            if (a.x === 50) expect([c[0], c[3]]).toEqual([10, 10]);
            if (a.y === 74) expect([c[2], c[3]]).toEqual([10, 10]);
        }
    });

    it("reliefScale multiplie la hauteur du relief recopié (collines plus hautes)", () => {
        const s = style("cliff2", 5, 5, [{}]);
        s.surfaces = s.surfaces.map((t) => (t.dx >= 1 && t.dx <= 3 && t.dy >= 1 && t.dy <= 3 ? { ...t, baseHeight: 20 } : t));
        const plan = planMagicFill(target(15, 15), [{ record: s, weight: 1 }], { ...OPTS, relief: "copy", reliefScale: 2 });
        expect(plan.relief.invalid).toBe(0);
        expect(plan.relief.maxRise).toBe(6);
        expect(plan.terrain.filter((a) => a.level === 16 && (a.slope ?? 0) === 0).length).toBeGreaterThanOrEqual(9);
    });

    it("recopie surface et bordure du style (texture: copy), sans retoucher les tuiles déjà identiques", () => {
        const s = style("sand", 2, 1, [{}]);
        s.surfaces[1] = { ...s.surfaces[1], surface: "sand", edge: "wood" };
        const t = target(4, 1).map((x) => ({ ...x, surface: "grass", edge: "rock" }));
        const plan = planMagicFill(t, [{ record: s, weight: 1 }], { ...OPTS, texture: "copy" });
        expect(plan.textures.length).toBeGreaterThan(0);
        for (const x of plan.textures) expect(x).toMatchObject({ surface: "sand", edge: "wood" });
        expect(plan.texturesBefore[0]).toMatchObject({ surface: "grass", edge: "rock" });
        expect(plan.objects).toEqual(expect.arrayContaining(["sand", "wood"]));
        expect(planMagicFill(t, [{ record: s, weight: 1 }], { ...OPTS, texture: "keep" }).textures).toEqual([]);
    });

    it("relief: keep, ou style plat : le terrain ne bouge pas", () => {
        expect(planMagicFill(target(9, 9), [{ record: hill("b"), weight: 1 }], { ...OPTS, relief: "keep" }).terrain).toEqual([]);
        expect(planMagicFill(target(9, 9), [{ record: style("flat", 5, 5, [{}]), weight: 1 }], { ...OPTS, relief: "copy" }).terrain).toEqual([]);
    });

    /** Tuiles d'eau reliées par les bords, d'un bord de la région à l'autre (axe x). */
    function spansX(water: { x: number; y: number }[], x1: number, x2: number): boolean {
        const set = new Set(water.map((w) => `${w.x},${w.y}`));
        const seen = new Set<string>();
        const queue = water.filter((w) => w.x === x1).map((w) => `${w.x},${w.y}`);
        queue.forEach((k) => seen.add(k));
        while (queue.length) {
            const [x, y] = queue.shift()!.split(",").map(Number);
            if (x === x2) return true;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const k = `${x + dx},${y + dy}`;
                if (set.has(k) && !seen.has(k)) (seen.add(k), queue.push(k));
            }
        }
        return false;
    }

    it("river trace un cours d'eau continu d'un bord à l'autre, lit creusé, eau au ras des berges, pas d'arbre dedans", () => {
        const t = target(30, 12);
        const plan = planMagicFill(t, [{ record: hill("r"), weight: 1 }], { ...OPTS, rotate: true, relief: "copy", water: "copy", river: { width: 2, depth: 2, bends: 3 } });
        expect(plan.waterInfo.river).not.toBeNull();
        expect(plan.waterInfo.leaked).toBe(0);
        expect(plan.water.length).toBe(plan.waterInfo.river!.tiles);
        expect(plan.water.length).toBeGreaterThanOrEqual(60);
        for (const w of plan.water) expect(w.level).toBe(10);
        expect(spansX(plan.water, 50, 79)).toBe(true);
        // Zigzag : la rivière ne reste pas sur une seule paire de lignes.
        expect(new Set(plan.water.map((w) => w.y)).size).toBeGreaterThan(4);
        const bed = new Map(plan.terrain.map((x) => [`${x.x},${x.y}`, x]));
        for (const w of plan.water) expect(bed.get(`${w.x},${w.y}`)).toMatchObject({ level: 8, slope: 0 });
        const wet = new Set(plan.water.map((w) => `${w.x},${w.y}`));
        expect(plan.small.filter((i) => wet.has(`${i.x},${i.y}`))).toEqual([]);
        // Berges : aucun coin voisin sous l'eau (relief recopié par-dessus, jamais en dessous).
        for (const x of plan.terrain) if (!wet.has(`${x.x},${x.y}`)) expect(x.level).toBeGreaterThanOrEqual(10);
    });

    it("river suit une ligne brisée donnée, et évite chemins", () => {
        const t = target(20, 10);
        t.find((x) => x.x === 60 && x.y === 65)!.blocked = true;
        const path = [{ x: 50, y: 65 }, { x: 69, y: 65 }];
        const plan = planMagicFill(t, [{ record: style("f", 3, 3, [{}]), weight: 1 }], { ...OPTS, relief: "copy", water: "copy", river: { path, width: 1, depth: 1, bends: 0 } });
        expect(plan.waterInfo.river!.path).toEqual(path);
        expect(plan.water.every((w) => w.y === 65)).toBe(true);
        expect(plan.water.find((w) => w.x === 60)).toBeUndefined();
        expect(plan.water).toHaveLength(19);
    });

    it("water: copy remet en eau la mare d'un style sur terrain sec (avant : matchWater l'écartait)", () => {
        // Style 5×5 plat (niveau 7), mare de 1 tuile au centre : lit au niveau 6, eau au niveau 7.
        const s = style("pond", 5, 5, [{ dx: 2, dy: 2, object: "lily", baseHeight: 14, dz: 0 }, { dx: 0, dy: 0 }]);
        const mid = s.surfaces.find((x) => x.dx === 2 && x.dy === 2)!;
        Object.assign(mid, { baseHeight: 12, water: 14 });
        const opts: FillOptions = { ...OPTS, relief: "copy", water: "copy" };
        const plan = planMagicFill(target(15, 15), [{ record: s, weight: 1 }], opts);
        expect(plan.waterInfo.fromStyles).toBeGreaterThan(0);
        expect(plan.water.length).toBe(plan.waterInfo.fromStyles);
        // Sol d'origine 10, mare un niveau sous le style : eau au niveau 11, berges relevées à 11.
        for (const w of plan.water) expect(w.level).toBe(11);
        expect(plan.small.some((i) => i.object === "lily")).toBe(true);
        // Sans copie de l'eau : la mare est écartée, comme avant.
        const keep = planMagicFill(target(15, 15), [{ record: s, weight: 1 }], { ...opts, water: "keep" });
        expect(keep.water).toEqual([]);
        expect(keep.small.some((i) => i.object === "lily")).toBe(false);
        // Relief gardé : la mare déborderait sur le sol plat, elle reste sèche (comptée).
        const flat = planMagicFill(target(15, 15), [{ record: s, weight: 1 }], { ...opts, relief: "keep" });
        expect(flat.water).toEqual([]);
        expect(flat.waterInfo.leaked).toBeGreaterThan(0);
    });

    it("bâtiment en terrain (gratte-ciel RCT1) : tamponné entier, jamais coupé ni changé en colline, à l'échelle 1", () => {
        const forest = style("forest", 3, 3, [{ object: "pine", dx: 1, dy: 1 }]);
        for (const seed of [1, 2, 3, 4, 5]) {
            const plan = planMagicFill(target(30, 30), [{ record: tower("t"), weight: 3 }, { record: forest, weight: 1 }], {
                ...OPTS,
                seed,
                rotate: true,
                relief: "copy",
                texture: "copy",
                reliefScale: 2,
            });
            expect(plan.buildings.stamps).toBeGreaterThan(0);
            expect(plan.relief.invalid).toBe(0);
            // Sol cible au niveau 10 ; tours à 10 + 16. Rien entre les deux : ni colline ni rampe autour d'une tour coupée.
            for (const a of plan.terrain) expect([10, 26]).toContain(a.level);
            const tops = plan.terrain.filter((a) => a.level === 26);
            expect(tops.length).toBe(plan.buildings.stamps * 4);
            const top = new Set(tops.map((a) => `${a.x},${a.y}`));
            for (const a of tops) {
                const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => top.has(`${a.x + dx},${a.y + dy}`)).length;
                expect(n).toBe(2);
            }
            expect(plan.textures.some((x) => x.edge === "rct1ll.terrain_edge.skyscraper_b")).toBe(true);
        }
    });

    it("compte ce qu'il ne pose pas (chemins, pistes)", () => {
        const s = style("a", 1, 1, [{ t: "footpath", object: "tarmac" }, { t: "track", object: null }]);
        const plan = planMagicFill(target(1, 1), [{ record: s, weight: 1 }], OPTS);
        expect(plan.notPlaced).toEqual({ footpath: 1, track: 1 });
    });
});

describe("base de styles", () => {
    it("résumé : densité, objets dominants, empilements", () => {
        const s = style("forest", 2, 1, [{ object: "pine" }, { object: "pine", dx: 1 }, { object: "nest", dz: 6, baseHeight: 20 }]);
        s.objects.pine = { type: "small_scenery", name: "Scots Pine Tree" };
        const sum = summarize(s);
        expect(sum.density).toBe(1.5);
        expect(sum.topObjects[0]).toMatchObject({ id: "pine", n: 2 });
        expect(sum.stacked).toBe(1);
        expect(sum.maxDz).toBe(6);
    });
    it("résumé : bordures et bâtiment en terrain (style sans objets), falaise naturelle, petit relief ignoré", () => {
        const sum = summarize(tower("t"));
        expect(sum.density).toBe(0);
        expect(sum.terrain.edges).toEqual(["rct1ll.terrain_edge.skyscraper_b"]);
        expect(sum.structure).toEqual({ kind: "building", tiles: 4, height: 16, edges: ["rct1ll.terrain_edge.skyscraper_b"] });
        expect(summarize(tower("r", "rct2.terrain_edge.rock", "Rock")).structure?.kind).toBe("cliff");
        const low = style("low", 5, 5, [{}]);
        low.surfaces = low.surfaces.map((t) => (t.dx >= 1 && t.dx <= 3 && t.dy >= 1 && t.dy <= 3 ? { ...t, baseHeight: 20 } : t));
        expect(summarize(low).structure).toBeNull();
    });
    it("pertinence : légende et noms d'objets, pluriels tolérés", () => {
        const s = style("x", 1, 1, []);
        s.caption = "Dense pine forest by the lake";
        s.objects.o = { type: "small_scenery", name: "Scots Pine Tree" };
        expect(relevance("pine forests", s)).toBeGreaterThan(relevance("desert cactus", s));
        expect(relevance("desert cactus", s)).toBe(0);
    });
});

describe("masque des captures", () => {
    it("garde la colonne de la région et efface le reste", () => {
        const view = { centerX: 10 * 32 + 16, centerY: 10 * 32 + 16, centerZ: 112, zoom: 0, rotation: 0, width: 400, height: 300 };
        const mask = regionMask(view, [{ x: 10, y: 10, zLow: 112, zHigh: 112 + 64 }]);
        const at = (px: number, py: number) => mask[py * 400 + px];
        expect(at(200, 150)).toBe(1);
        expect(at(200, 150 - 60)).toBe(1);
        expect(at(10, 10)).toBe(0);
        expect(at(390, 290)).toBe(0);
    });
    it("une colonne de terrain garde sa face jusqu'au sol de la voisine (avant : seul le toit restait)", () => {
        const cols = columnsOf(tower("t"));
        const top = cols.find((c) => c.x === 11 && c.y === 11)!;
        expect(top.zLow).toBe(14 * 8);
        expect(top.zHigh).toBe(46 * 8 + 32);
    });
});

describe("Style Picker et Magic Fill de bout en bout (faux plugin)", () => {
    let h: Harness;
    beforeEach(async () => {
        h = await startHarness(new World(64, 64, 7));
        await h.call("session_set_mode", { mode: "sandbox" });
    });
    afterEach(async () => {
        await h.close();
    });

    /** Une petite forêt posée « à la main » puis relevée comme le ferait le bouton Save Style. */
    async function saveForestInGame(): Promise<string> {
        for (const [x, y, q] of [
            [10, 10, 0],
            [11, 11, 2],
            [12, 10, 1],
        ])
            await h.call("scenery_place", { items: [{ object: "rct2.scenery_small.tcf", x, y, quadrant: q }] });
        await h.call("scenery_place", { items: [{ object: "rct2.scenery_small.fbbl", x: 11, y: 10, quadrant: 3, colours: [4, 5, 6] }] });
        const tiles = [];
        for (let y = 10; y <= 11; y++) for (let x = 10; x <= 12; x++) tiles.push({ x, y });
        const record = h.plugin.game.styleRecord({ tiles, caption: "Pine forest with flowers", source: "user" }, true) as StyleRecord;
        h.plugin.pushInbox({ styles: [record] });
        return record.id;
    }

    it("un style sauvé en jeu arrive dans la base, avec légende et captures", async () => {
        const id = await saveForestInGame();
        const list = await h.call("style_list", { query: "pine forest" });
        expect(list.isError).toBe(false);
        expect(list.json.styles).toHaveLength(1);
        const sid = list.json.styles[0].id as string;
        expect(sid.startsWith(id)).toBe(true);
        expect(list.json.styles[0].caption).toBe("Pine forest with flowers");
        const dir = join(h.userDir, "claude-styles", "styles", sid);
        expect(existsSync(join(dir, "style.json"))).toBe(true);
        expect(readFileSync(join(dir, "caption.txt"), "utf8").trim()).toBe("Pine forest with flowers");
        expect(existsSync(join(dir, "screenshot-r0.png"))).toBe(true);
        // Acquitté : le plugin ne le garde plus.
        expect(h.plugin.game.inboxStyles).toHaveLength(0);
        const got = await h.call("style_get", { id: sid });
        expect(got.json.composition.find((c: { id: string }) => c.id === "rct2.scenery_small.fbbl").colours[0]).toBe("4/5/6 ×1");
        expect(got.images).toBe(1);
    });

    it("une demande Magic Fill est remplie depuis les styles, sans dégagement, puis annulée", async () => {
        await saveForestInGame();
        const sid = (await h.call("style_list", {})).json.styles[0].id as string;
        const tiles: [number, number][] = [];
        for (let y = 30; y < 36; y++) for (let x = 30; x < 36; x++) tiles.push([x, y]);
        const req: MagicFillRequest = { id: "fill-test1", prompt: "a pine forest", tiles, brushSize: 3, createdAt: "2026-10-10T10:00:00Z", park: null };
        h.plugin.pushInbox({ fills: [req] });
        const reqs = await h.call("magic_fill_requests", { wait: 2 });
        expect(reqs.json.requests).toHaveLength(1);
        expect(reqs.json.requests[0].candidates[0].id).toBe(sid);
        expect(reqs.json.requests[0].target.tiles).toBe(36);
        expect(typeof reqs.json.requests[0].around).toBe("object");
        expect(h.plugin.game.fillStatus.get("fill-test1")?.status).toBe("working");

        const dry = await h.call("magic_fill_apply", { request: "fill-test1", styles: [{ id: sid }], seed: 3, dryRun: true });
        expect(dry.json.planned.small).toBeGreaterThan(0);
        const applied = await h.call("magic_fill_apply", { request: "fill-test1", styles: [{ id: sid }], seed: 3 });
        expect(applied.isError).toBe(false);
        expect(applied.json.changed.placed).toBe(dry.json.planned.small);
        expect(applied.images).toBe(1);
        const world = h.plugin.world;
        let count = 0;
        for (const [x, y] of tiles) count += world.tile(x, y).small.length;
        expect(count).toBe(applied.json.changed.placed);
        // Le cheat Zero Clearances n'est actif que pendant la pose.
        expect(world.cheats.disableClearanceChecks).toBe(false);
        expect(h.plugin.game.fillStatus.get("fill-test1")?.status).toBe("done");
        const colours = tiles.flatMap(([x, y]) => world.tile(x, y).small).filter((s) => s.object === "rct2.scenery_small.fbbl").map((s) => s.colours);
        expect(colours.length).toBeGreaterThan(0);
        for (const c of colours) expect(c).toEqual([4, 5, 6]);

        const undo = await h.call("undo_last", { count: 1 });
        expect(undo.isError).toBe(false);
        count = 0;
        for (const [x, y] of tiles) count += world.tile(x, y).small.length;
        expect(count).toBe(0);
        expect((await h.call("magic_fill_requests", {})).json.requests).toHaveLength(0);
    });

    it("recopie relief et textures d'un style à falaise (objets de terrain chargés), annulable", async () => {
        const world = h.plugin.world;
        // Style relevé en jeu : plateau de roche (2 niveaux plus haut, falaise) entouré d'herbe.
        world.load("rct2.terrain_surface.rock");
        world.load("rct2.terrain_edge.wood_red");
        const rock = world.loadedIndex("terrain_surface", "rct2.terrain_surface.rock")!;
        const wood = world.loadedIndex("terrain_edge", "rct2.terrain_edge.wood_red")!;
        const styleTiles = [];
        for (let y = 10; y <= 14; y++)
            for (let x = 10; x <= 14; x++) {
                styleTiles.push({ x, y });
                if (x >= 11 && x <= 13 && y >= 11 && y <= 13) Object.assign(world.tile(x, y), { h: world.tile(x, y).h + 2, t: rock, te: wood });
            }
        const record = h.plugin.game.styleRecord({ tiles: styleTiles, caption: "Rocky plateau", source: "user" }, true) as StyleRecord;
        // Autre parc : les objets de terrain du style n'y sont pas chargés.
        world.loaded.set("terrain_surface", world.loaded.get("terrain_surface")!.filter((o) => o.identifier !== "rct2.terrain_surface.rock"));
        world.loaded.set("terrain_edge", world.loaded.get("terrain_edge")!.filter((o) => o.identifier !== "rct2.terrain_edge.wood_red"));
        h.plugin.pushInbox({ styles: [record] });
        const sid = (await h.call("style_list", {})).json.styles[0].id as string;
        const tiles: [number, number][] = [];
        for (let y = 30; y < 42; y++) for (let x = 30; x < 42; x++) tiles.push([x, y]);
        const before = tiles.map(([x, y]) => ({ ...world.tile(x, y) }));
        h.plugin.pushInbox({ fills: [{ id: "fill-rock", prompt: "rocky plateau", tiles, brushSize: 4, createdAt: "2026-10-10T10:00:00Z", park: null }] });
        await h.call("magic_fill_requests", { wait: 2 });
        const r = await h.call("magic_fill_apply", { request: "fill-rock", styles: [{ id: sid }], seed: 4, rotate: false, compare: false });
        expect(r.isError).toBe(false);
        expect(r.json.relief.cliffEdges).toBeGreaterThan(0);
        expect(r.json.relief.maxRiseLevels).toBe(2);
        expect(r.json.textures).toBeGreaterThan(0);
        expect(r.json.loadedObjects).toEqual(expect.arrayContaining(["rct2.terrain_surface.rock", "rct2.terrain_edge.wood_red"]));
        const rockNow = world.loadedIndex("terrain_surface", "rct2.terrain_surface.rock");
        const raised = tiles.map(([x, y]) => world.tile(x, y)).filter((t, n) => t.h === before[n].h + 2);
        expect(raised.length).toBeGreaterThan(0);
        for (const t of raised) expect(t.t).toBe(rockNow);
        await h.call("undo_last", { count: 1 });
        tiles.forEach(([x, y], n) => {
            const t = world.tile(x, y);
            expect([t.h, t.s, t.t, t.te ?? 0]).toEqual([before[n].h, before[n].s, before[n].t, before[n].te ?? 0]);
        });
    });

    it("une consigne « rivière » trace une vraie rivière en jeu, comptée dans le résultat, annulable", async () => {
        const world = h.plugin.world;
        await saveForestInGame();
        const sid = (await h.call("style_list", {})).json.styles[0].id as string;
        const tiles: [number, number][] = [];
        for (let y = 30; y < 40; y++) for (let x = 20; x < 44; x++) tiles.push([x, y]);
        const before = tiles.map(([x, y]) => ({ ...world.tile(x, y) }));
        h.plugin.pushInbox({ fills: [{ id: "fill-river", prompt: "A long river zigzaging through hills with trees", tiles, brushSize: 5, createdAt: "2026-10-10T10:00:00Z", park: null }] });
        const reqs = await h.call("magic_fill_requests", { wait: 2 });
        expect(reqs.json.next_hints.join(" ")).toContain("river");
        const r = await h.call("magic_fill_apply", { request: "fill-river", styles: [{ id: sid }], seed: 5, compare: false });
        expect(r.isError).toBe(false);
        expect(r.json.water.river.tiles).toBeGreaterThan(30);
        expect(r.json.changed.water).toBe(r.json.water.tiles);
        expect(r.json.summary).toContain("Eau posée");
        const wet = tiles.filter(([x, y]) => world.tile(x, y).w > world.tile(x, y).h);
        expect(wet.length).toBe(r.json.water.tiles);
        expect(new Set(wet.map(([x]) => x)).size).toBe(24);
        for (const [x, y] of wet) expect(world.tile(x, y).small).toEqual([]);
        await h.call("undo_last", { count: 1 });
        tiles.forEach(([x, y], n) => {
            const t = world.tile(x, y);
            expect([t.h, t.s, t.w > t.h]).toEqual([before[n].h, before[n].s, before[n].w > before[n].h]);
        });
    });

    it("river: 'none' sur une consigne d'eau : avertit qu'aucune eau n'est posée", async () => {
        await saveForestInGame();
        const sid = (await h.call("style_list", {})).json.styles[0].id as string;
        const tiles: [number, number][] = [];
        for (let y = 30; y < 36; y++) for (let x = 30; x < 36; x++) tiles.push([x, y]);
        h.plugin.pushInbox({ fills: [{ id: "fill-dry", prompt: "a forest by a river", tiles, brushSize: 3, createdAt: "2026-10-10T10:00:00Z", park: null }] });
        await h.call("magic_fill_requests", { wait: 2 });
        const r = await h.call("magic_fill_apply", { request: "fill-dry", styles: [{ id: sid }], seed: 1, river: "none", compare: false });
        expect(r.json.water.tiles).toBe(0);
        expect(r.json.summary).toContain("Aucune eau posée");
        expect(r.json.warnings.join(" ")).toContain("AUCUNE EAU POSÉE");
    });

    it("refaire une demande revient au checkpoint d'avant remplissage (redo, magic_fill_revert), sans vider ni aplanir", async () => {
        let world = h.plugin.world;
        // Style : plateau 3×3 (2 niveaux plus haut) avec un arbre dessus.
        const styleTiles = [];
        for (let y = 10; y <= 14; y++)
            for (let x = 10; x <= 14; x++) {
                styleTiles.push({ x, y });
                if (x >= 11 && x <= 13 && y >= 11 && y <= 13) world.tile(x, y).h += 2;
            }
        await h.call("scenery_place", { items: [{ object: "rct2.scenery_small.tcf", x: 12, y: 12, quadrant: 0 }] });
        const record = h.plugin.game.styleRecord({ tiles: styleTiles, caption: "Hill with a tree", source: "user" }, true) as StyleRecord;
        h.plugin.pushInbox({ styles: [record] });
        const sid = (await h.call("style_list", {})).json.styles[0].id as string;
        const tiles: [number, number][] = [];
        for (let y = 30; y < 42; y++) for (let x = 30; x < 42; x++) tiles.push([x, y]);
        const before = tiles.map(([x, y]) => world.tile(x, y).h);
        h.plugin.pushInbox({ fills: [{ id: "fill-hill", prompt: "hills", tiles, brushSize: 4, createdAt: "2026-10-10T10:00:00Z", park: null }] });
        await h.call("magic_fill_requests", { wait: 2 });
        const first = await h.call("magic_fill_apply", { request: "fill-hill", styles: [{ id: sid }], seed: 4, rotate: false, compare: false });
        expect(first.isError).toBe(false);
        expect(first.json.relief.maxRiseLevels).toBe(2);
        expect(existsSync(join(h.userDir, "save", "claude-mf-fill-hill.park"))).toBe(true);

        // Remplir de nouveau sans redo : refusé (on empilerait sur l'ancien remplissage).
        const again = await h.call("magic_fill_apply", { request: "fill-hill", styles: [{ id: sid }], seed: 4, rotate: false, compare: false });
        expect(again.isError).toBe(true);
        expect(JSON.stringify(again.json)).toContain("redo");

        // « Même chose, collines plus hautes » : retour au checkpoint puis nouveau remplissage.
        const redo = await h.call("magic_fill_apply", { request: "fill-hill", styles: [{ id: sid }], seed: 4, rotate: false, compare: false, redo: true, reliefScale: 2 });
        expect(redo.isError).toBe(false);
        expect(redo.json.relief.maxRiseLevels).toBe(4);
        world = h.plugin.world;
        const trees = tiles.flatMap(([x, y]) => world.tile(x, y).small).length;
        expect(trees).toBe(redo.json.changed.placed);
        // 4 niveaux au-dessus du terrain d'origine, et non 2 + 4 : le premier remplissage a été défait.
        expect(Math.max(...tiles.map(([x, y], n) => world.tile(x, y).h - before[n]))).toBe(4);
        expect(h.plugin.game.fillStatus.get("fill-hill")?.status).toBe("done");

        // Une opération faite depuis : magic_fill_revert refuse de la perdre sans accord.
        await h.call("scenery_place", { items: [{ object: "rct2.scenery_small.bush", x: 50, y: 50 }] });
        const refused = await h.call("magic_fill_revert", { request: "fill-hill" });
        expect(refused.isError).toBe(true);
        const reverted = await h.call("magic_fill_revert", { request: "fill-hill", discardLaterWork: true });
        expect(reverted.isError).toBe(false);
        expect(reverted.json.lost).toHaveLength(1);
        world = h.plugin.world;
        expect(tiles.map(([x, y]) => world.tile(x, y).h)).toEqual(before);
        expect(tiles.flatMap(([x, y]) => world.tile(x, y).small)).toHaveLength(0);
        expect(world.tile(50, 50).small).toHaveLength(0);
        // Rouverte : relief permis dans son emprise, prête pour un nouveau magic_fill_apply.
        expect(h.plugin.game.fillStatus.get("fill-hill")?.status).toBe("working");
        expect((await h.call("magic_fill_requests", {})).json.requests[0].id).toBe("fill-hill");
    });

    it("limite d'objets du parc : boîte d'avertissement, éléments de l'objet écartés, le reste posé", async () => {
        await saveForestInGame();
        const sid = (await h.call("style_list", {})).json.styles[0].id as string;
        // Autre parc : fbbl n'y est pas chargé et les emplacements de petite scénerie sont pleins.
        const world = h.plugin.world;
        const small = world.loaded.get("small_scenery")!;
        small.splice(
            small.findIndex((o) => o.identifier === "rct2.scenery_small.fbbl"),
            1,
        );
        world.objectLimits.small_scenery = small.length;
        const tiles: [number, number][] = [];
        for (let y = 30; y < 36; y++) for (let x = 30; x < 36; x++) tiles.push([x, y]);
        const r = await h.call("magic_fill_apply", { tiles: tiles.map(([x, y]) => ({ x, y })), styles: [{ id: sid }], seed: 3, compare: false });
        expect(r.isError).toBe(false);
        expect(r.json.objectLimit.objects).toEqual(["rct2.scenery_small.fbbl"]);
        expect(r.json.objectLimit.discarded).toBeGreaterThan(0);
        expect(r.json.changed.placed).toBeGreaterThan(0);
        expect(h.plugin.game.alerts).toHaveLength(1);
        expect(h.plugin.game.alerts[0].message).toContain("rct2.scenery_small.fbbl");
        const placed = tiles.flatMap(([x, y]) => world.tile(x, y).small);
        expect(placed.some((o) => o.object === "rct2.scenery_small.fbbl")).toBe(false);
        expect(placed.some((o) => o.object === "rct2.scenery_small.tcf")).toBe(true);
    });

    it("« Clear all stored styles » vide la base, mais garde un style sauvé après le clic", async () => {
        await saveForestInGame();
        expect((await h.call("style_list", {})).json.styles).toHaveLength(1);
        h.plugin.pushClearStyles();
        await h.call("scenery_place", { items: [{ object: "rct2.scenery_small.bush", x: 20, y: 20 }] });
        const after = h.plugin.game.styleRecord({ tiles: [{ x: 20, y: 20 }], caption: "Lone bush", source: "user" }, true) as StyleRecord;
        h.plugin.pushInbox({ styles: [after] });
        const list = await h.call("style_list", {});
        expect(list.json.styles.map((x: { caption: string }) => x.caption)).toEqual(["Lone bush"]);
        expect(h.plugin.game.inboxClear).toBe(false);
        expect(h.plugin.game.lastCleared).toBe(1);
        const all = await h.call("style_delete", { all: true });
        expect(all.isError).toBe(false);
        expect((await h.call("style_list", {})).json.styles).toHaveLength(0);
    });

    it("style_save relève une région désignée par Claude", async () => {
        await h.call("scenery_place", { items: [{ object: "rct2.scenery_small.bush", x: 20, y: 20 }] });
        const r = await h.call("style_save", { rect: { x1: 19, y1: 19, x2: 21, y2: 21 }, caption: "Hedge corner" });
        expect(r.isError).toBe(false);
        expect(r.json.tiles).toBe(9);
        const list = await h.call("style_list", { query: "hedge" });
        expect(list.json.styles[0].caption).toBe("Hedge corner");
    });

    it("une demande Magic Fill ouverte permet de modifier le relief dans son emprise, pas ailleurs", async () => {
        const tiles: [number, number][] = [];
        for (let y = 20; y < 24; y++) for (let x = 20; x < 24; x++) tiles.push([x, y]);
        const outside = await h.call("terrain_flatten", { x1: 20, y1: 20, x2: 23, y2: 23, level: 9 });
        expect(outside.isError).toBe(true);
        h.plugin.pushInbox({ fills: [{ id: "fill-lvl", prompt: "flat garden", tiles, brushSize: 4, createdAt: "2026-10-10T10:00:00Z", park: null }] });
        await h.call("magic_fill_requests", { wait: 2 });
        expect((await h.call("terrain_flatten", { x1: 20, y1: 20, x2: 23, y2: 23, level: 9 })).isError).toBe(false);
        expect((await h.call("terrain_flatten", { x1: 19, y1: 20, x2: 23, y2: 23, level: 9 })).isError).toBe(true);
        expect((await h.call("session_info")).json.landscapeAllowed).toBe(false);
        await h.call("magic_fill_dismiss", { request: "fill-lvl", reason: "test" });
        expect((await h.call("terrain_flatten", { x1: 20, y1: 20, x2: 23, y2: 23, level: 10 })).isError).toBe(true);
    });

    it("magic_fill_dismiss ferme une demande et prévient la fenêtre du jeu", async () => {
        h.plugin.pushInbox({ fills: [{ id: "fill-x", prompt: "volcano", tiles: [[5, 5]], brushSize: 1, createdAt: "2026-10-10T10:00:00Z", park: null }] });
        await h.call("magic_fill_requests", { wait: 2 });
        const d = await h.call("magic_fill_dismiss", { request: "fill-x", reason: "No volcano style saved yet." });
        expect(d.isError).toBe(false);
        expect(h.plugin.game.fillStatus.get("fill-x")).toEqual({ status: "dismissed", message: "No volcano style saved yet." });
    });
});
