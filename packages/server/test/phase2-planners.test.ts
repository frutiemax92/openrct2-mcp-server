import { describe, expect, it } from "vitest";
import type { RegionTile } from "@openrct2-claude/protocol";
import { planFurniture } from "../src/planners/furniture.js";
import { cornerLevels, diffTiles, enforceSlopeLimit, tileFromCorners, vertexGridFromTerrain } from "../src/planners/heightmap.js";
import { loadRecipes } from "../src/planners/recipes.js";
import { distanceField, scatter, type ZoneTile } from "../src/planners/scatter.js";
import { groupByRole } from "../src/roles.js";
import { pointInPolygon, ZoneMap } from "../src/state/zones.js";

const flat = (h = 7, extra: Partial<RegionTile> = {}): RegionTile => ({ h, s: 0, w: 0, t: 0, o: 1, ...extra });

function grid(w: number, h: number, f: (x: number, y: number) => RegionTile | undefined) {
    const tiles = new Map<string, RegionTile>();
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const t = f(x, y);
            if (t) tiles.set(`${x},${y}`, t);
        }
    return (x: number, y: number) => tiles.get(`${x},${y}`);
}

describe("heightmap : coins ↔ pente", () => {
    it("aller-retour pour toutes les pentes valides", () => {
        // 0, coins simples, côtés, trois coins, vallées, diagonales (Slope.h)
        const valid = [0, 1, 2, 4, 8, 3, 6, 12, 9, 5, 10, 7, 11, 13, 14, 16 | 7, 16 | 11, 16 | 13, 16 | 14];
        for (const s of valid) {
            const c = cornerLevels({ h: 10, s });
            expect(tileFromCorners(c)).toEqual({ level: 10, slope: s });
        }
    });
    it("diagonale : le coin opposé au coin bas est à +2", () => {
        // 16 | 7 = kTileSlopeWCornerDown | diagonale : W en bas, E (opposé) à +2 (MapGetCornerHeight). Ordre S, E, N, W.
        expect(cornerLevels({ h: 4, s: 16 | 7 })).toEqual([5, 6, 5, 4]);
    });
    it("refuse un écart de 3 ou une diagonale mal formée", () => {
        expect(tileFromCorners([0, 3, 0, 0])).toBeNull();
        expect(tileFromCorners([0, 2, 0, 1])).toBeNull();
    });
});

describe("heightmap : enveloppe de pente", () => {
    it("une colline produit des tuiles toutes valides, bord intact", () => {
        const get = grid(20, 20, () => flat(5));
        const rect = { x1: 2, y1: 2, x2: 17, y2: 17 };
        const g = vertexGridFromTerrain(rect, get);
        g.forEach((vx, vy, i) => g.set(vx, vy, g.v[i] + Math.max(0, 6 - Math.hypot(vx - 10, vy - 10))));
        const violations = enforceSlopeLimit(g, "up");
        expect(violations).toBe(0);
        const { after, invalid } = diffTiles(g, get);
        expect(invalid).toEqual([]);
        expect(after.length).toBeGreaterThan(20);
        expect(Math.max(...after.map((t) => t.level))).toBeGreaterThanOrEqual(9);
        // Bord : sommets fixés au niveau d'origine
        for (let x = 2; x <= 18; x++) expect(g.get(x, 2)).toBe(5);
    });
    it("ne touche pas aux tuiles occupées par un chemin", () => {
        const get = grid(12, 12, (x, y) => flat(5, x === 6 && y === 6 ? { p: [{ l: 5, q: 0, e: 0, sd: -1, r: -1, a: -1 }] } : {}));
        const rect = { x1: 1, y1: 1, x2: 10, y2: 10 };
        const g = vertexGridFromTerrain(rect, get);
        g.forEach((vx, vy) => g.set(vx, vy, 9));
        enforceSlopeLimit(g, "up");
        const { after } = diffTiles(g, get);
        expect(after.find((t) => t.x === 6 && t.y === 6)).toBeUndefined();
        expect(g.corners(6, 6)).toEqual([5, 5, 5, 5]);
    });
});

describe("scatter", () => {
    const { recipes } = loadRecipes();
    const objects = groupByRole([
        { identifier: "t.fir", name: "Fir Tree", type: "small_scenery", loaded: true, index: 0, extra: { flags: 1 | (1 << 28) } },
        { identifier: "t.oak", name: "Oak Tree", type: "small_scenery", loaded: true, index: 1, extra: { flags: 1 | (1 << 28) } },
        { identifier: "s.bush", name: "Bush", type: "small_scenery", loaded: true, index: 2, extra: { flags: 0 } },
        { identifier: "s.flw", name: "Flowers", type: "small_scenery", loaded: true, index: 3, extra: { flags: 0 } },
    ]);

    it("charge les cinq recettes de départ", () => {
        for (const t of ["temperate", "tropical", "desert", "western", "formal"]) expect(recipes.has(t)).toBe(true);
    });

    it("forêt : déterministe, dégagements respectés, un arbre par tuile", () => {
        // Chemin horizontal en y = 10, entrée d'attraction en (15, 9).
        const get = grid(40, 30, (x, y) => {
            if (y === 10) return flat(5, { p: [{ l: 5, q: 0, e: 0b0101, sd: -1, r: -1, a: -1 }] });
            if (x === 15 && y === 9) return flat(5, { e: [{ k: 0, d: 1, r: 0, st: 0, l: 5, seq: 0 }] });
            return flat(5);
        });
        const tiles: ZoneTile[] = [];
        for (let y = 2; y <= 20; y++) for (let x = 2; x <= 30; x++) tiles.push({ x, y, zone: "forest_dense" });
        const a = scatter({ tiles, get, recipe: recipes.get("temperate")!, objects, seed: 4 });
        const b = scatter({ tiles, get, recipe: recipes.get("temperate")!, objects, seed: 4 });
        expect(a.items).toEqual(b.items);
        expect(a.items.length).toBeGreaterThan(80);
        const c = scatter({ tiles, get, recipe: recipes.get("temperate")!, objects, seed: 5 });
        expect(c.items).not.toEqual(a.items);
        const fullTiles = new Map<string, number>();
        for (const it of a.items) {
            // forest_dense : 2 tuiles de dégagement le long du chemin, 3 autour de l'entrée
            expect(Math.abs(it.y - 10)).toBeGreaterThanOrEqual(2);
            expect(Math.abs(it.x - 15) + Math.abs(it.y - 9)).toBeGreaterThanOrEqual(3);
            if (String(it.object).startsWith("t.")) fullTiles.set(`${it.x},${it.y}`, (fullTiles.get(`${it.x},${it.y}`) ?? 0) + 1);
        }
        for (const n of fullTiles.values()) expect(n).toBe(1);
        // Aucun objet d'un autre type sur une tuile d'arbre
        for (const it of a.items) if (!String(it.object).startsWith("t.")) expect(fullTiles.has(`${it.x},${it.y}`)).toBe(false);
    });

    it("signale un rôle sans objet et applique les replis", () => {
        const get = grid(20, 20, () => flat(5));
        const tiles: ZoneTile[] = [];
        for (let y = 2; y <= 10; y++) for (let x = 2; x <= 10; x++) tiles.push({ x, y, zone: "forest_dense" });
        const r = scatter({ tiles, get, recipe: recipes.get("temperate")!, objects, seed: 1 });
        expect(r.substitutions.rock).toBeNull();
        const desert = scatter({ tiles, get, recipe: recipes.get("desert")!, objects, seed: 1 });
        expect(desert.substitutions.cactus).toBe("tree_deciduous");
    });

    it("lakeshore reste près de l'eau", () => {
        const get = grid(30, 30, (x, y) => (x >= 10 && x <= 18 && y >= 10 && y <= 18 ? flat(4, { w: 5 }) : flat(5)));
        const tiles: ZoneTile[] = [];
        for (let y = 2; y <= 27; y++) for (let x = 2; x <= 27; x++) tiles.push({ x, y, zone: "lakeshore" });
        const r = scatter({ tiles, get, recipe: recipes.get("temperate")!, objects, seed: 2, densityScale: 2 });
        expect(r.items.length).toBeGreaterThan(5);
        for (const it of r.items) {
            const dx = Math.max(10 - it.x, 0, it.x - 18);
            const dy = Math.max(10 - it.y, 0, it.y - 18);
            expect(dx + dy).toBeLessThanOrEqual(2);
            expect(dx + dy).toBeGreaterThanOrEqual(1);
        }
    });

    it("distanceField : distance de Manhattan", () => {
        const d = distanceField({ x1: 0, y1: 0, x2: 9, y2: 9 }, (x, y) => x === 0 && y === 0);
        expect(d(3, 4)).toBe(7);
        expect(d(20, 20)).toBe(255);
    });
});

describe("zones", () => {
    it("peint un rectangle et un polygone, efface, sérialise", () => {
        const z = new ZoneMap();
        expect(z.paint({ rect: { x1: 0, y1: 0, x2: 3, y2: 1 } }, "meadow")).toBe(8);
        z.paint({ polygon: [{ x: 10, y: 10 }, { x: 14, y: 10 }, { x: 10, y: 14 }] }, "forest_dense");
        expect(z.get(10, 10)).toBe("forest_dense");
        expect(z.get(13, 13)).toBeUndefined();
        z.paint({ rect: { x1: 0, y1: 0, x2: 0, y2: 0 } }, null);
        const copy = new ZoneMap();
        copy.load(z.toJSON());
        expect(copy.summary()).toEqual(z.summary());
        expect(copy.get(0, 0)).toBeUndefined();
        expect(pointInPolygon(1, 1, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }])).toBe(true);
    });
});

describe("mobilier", () => {
    it("espacement, pas de carrefour à 4 branches, pas de banc sur une rampe", () => {
        // Allée horizontale y = 5 de x = 0 à 29, croisement à 4 branches en x = 10, rampe en x = 20.
        const get = grid(30, 12, (x, y) => {
            if (y === 5) {
                const e = x === 10 ? 0xf : 0b0101;
                return flat(5, { p: [{ l: 5, q: 0, e, sd: x === 20 ? 2 : -1, r: -1, a: -1 }] });
            }
            if (x === 10 && (y === 4 || y === 6)) return flat(5, { p: [{ l: 5, q: 0, e: 0b1010, sd: -1, r: -1, a: -1 }] });
            return flat(5);
        });
        const plan = planFurniture({
            rect: { x1: 0, y1: 0, x2: 29, y2: 11 },
            get,
            kinds: ["bench", "bin", "lamp"],
            spacing: { bench: 6, bin: 6, lamp: 4 },
            existingRole: () => null,
            hotspots: [],
        });
        expect(plan.slots.find((s) => s.x === 10 && s.y === 5)).toBeUndefined();
        expect(plan.slots.find((s) => s.x === 20 && s.kind !== "lamp")).toBeUndefined();
        const benches = plan.slots.filter((s) => s.kind === "bench");
        for (const a of benches) for (const b of benches) if (a !== b) expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(6);
        expect(plan.slots.filter((s) => s.kind === "lamp").length).toBeGreaterThanOrEqual(4);
        // Poubelles collées aux bancs quand c'est possible
        const bins = plan.slots.filter((s) => s.kind === "bin");
        expect(bins.some((b) => benches.some((s) => Math.abs(s.x - b.x) + Math.abs(s.y - b.y) === 1))).toBe(true);
        // Une tuile, une addition
        expect(new Set(plan.slots.map((s) => `${s.x},${s.y}`)).size).toBe(plan.slots.length);
    });
});
