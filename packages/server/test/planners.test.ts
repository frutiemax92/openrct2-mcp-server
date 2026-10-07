import { describe, expect, it } from "vitest";
import type { RegionTile } from "@openrct2-claude/protocol";
import { analyzeConnectivity } from "../src/planners/connectivity.js";
import { edgeLevel, expandPolyline, onTerrain, planPath } from "../src/planners/path.js";
import { routeToNetwork } from "../src/tools/helpers.js";

const flat = (h = 7, extra: Partial<RegionTile> = {}): RegionTile => ({ h, s: 0, w: 0, t: 0, o: 1, ...extra });

describe("expandPolyline", () => {
    it("remplit les segments en L, sans doublons", () => {
        const r = expandPolyline([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]);
        expect(r).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }]);
    });
    it("gère les diagonales en passant d'abord par x", () => {
        expect(expandPolyline([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    });
});

describe("onTerrain (kDefaultPathSlope)", () => {
    it("plat → plat", () => expect(onTerrain(flat(5))).toEqual({ level: 5, slopeDirection: null }));
    it("N|E relevés → rampe direction 2", () => expect(onTerrain(flat(5, { s: 3 }))).toEqual({ level: 5, slopeDirection: 2 }));
    it("S|W relevés → rampe direction 0", () => expect(onTerrain(flat(5, { s: 12 }))).toEqual({ level: 5, slopeDirection: 0 }));
    it("trois coins → plat un niveau au-dessus", () => expect(onTerrain(flat(5, { s: 7 }))).toEqual({ level: 6, slopeDirection: null }));
    it("un seul coin → irrégulier", () => expect(onTerrain(flat(5, { s: 1 }))).toBeNull());
    it("diagonale → irrégulier", () => expect(onTerrain(flat(5, { s: 16 | 5 }))).toBeNull());
});

describe("edgeLevel", () => {
    it("rampe : haut du côté de la montée, bas à l'opposé, rien sur les côtés", () => {
        const p = { level: 3, slopeDirection: 2 as const };
        expect(edgeLevel(p, 2)).toBe(4);
        expect(edgeLevel(p, 0)).toBe(3);
        expect(edgeLevel(p, 1)).toBeNull();
    });
});

describe("planPath", () => {
    it("signale les ruptures de niveau et les pentes irrégulières", () => {
        const tiles: Record<string, RegionTile> = { "0,0": flat(5), "1,0": flat(7), "2,0": flat(7, { s: 1 }) };
        const plan = planPath(expandPolyline([{ x: 0, y: 0 }, { x: 2, y: 0 }]), (x, y) => tiles[`${x},${y}`]);
        expect(plan.problems.map((p) => p.code).sort()).toEqual(["BAD_SLOPE", "LEVEL_BREAK"]);
    });
    it("accepte une rampe entre deux niveaux", () => {
        const tiles: Record<string, RegionTile> = { "0,0": flat(5), "1,0": flat(5, { s: 3 }), "2,0": flat(6) };
        const plan = planPath(expandPolyline([{ x: 0, y: 0 }, { x: 2, y: 0 }]), (x, y) => tiles[`${x},${y}`]);
        expect(plan.problems).toEqual([]);
        expect(plan.slopes).toHaveLength(1);
    });
});

describe("analyzeConnectivity", () => {
    it("compte les composantes, impasses et raccords d'attraction", () => {
        const tiles: Record<string, RegionTile> = {
            "0,0": flat(7, { e: [{ k: 2, d: 2, r: 0, st: 0, l: 7, seq: 0 }] }),
            "1,0": flat(7, { p: [{ l: 7, q: 0, e: 0b0101, sd: -1, r: -1, a: -1 }] }),
            "2,0": flat(7, { p: [{ l: 7, q: 0, e: 0b0001, sd: -1, r: -1, a: -1 }] }),
            "5,5": flat(7, { p: [{ l: 7, q: 0, e: 0, sd: -1, r: -1, a: -1 }] }),
        };
        const rep = analyzeConnectivity({ x1: 0, y1: 0, x2: 6, y2: 6 }, (x, y) => tiles[`${x},${y}`] ?? flat(), []);
        expect(rep.pathTiles).toBe(3);
        expect(rep.components).toHaveLength(2);
        expect(rep.parkEntrances[0].connected).toBe(true);
        expect(rep.deadEnds).toEqual([{ x: 2, y: 0 }]);
        expect(rep.isolated).toEqual([{ x: 5, y: 5 }]);
    });
});

describe("routeToNetwork", () => {
    const path = (q = 0) => ({ p: [{ l: 7, q, e: 0, sd: -1, r: -1, a: -1 }] });
    it("ne longe pas la file d'attente d'une autre attraction (fusion automatique par le jeu)", () => {
        // Réseau en y = 0. Départ en (0,3). File existante en (1,1) : la colonne x = 0 la touche en (0,1).
        const tiles: Record<string, RegionTile> = {};
        for (let x = -3; x <= 3; x++) tiles[`${x},0`] = flat(7, path());
        tiles["1,1"] = flat(7, path(1));
        const get = (x: number, y: number) => tiles[`${x},${y}`] ?? flat();
        const route = routeToNetwork({ x: 0, y: 3 }, get, { sandbox: false, startLevel: 7 })!;
        expect(route).not.toBeNull();
        expect(route.some((t) => t.x === 0 && t.y === 1)).toBe(false);
        expect(route.some((t) => t.x === 2 && t.y === 1)).toBe(false);
    });
});
