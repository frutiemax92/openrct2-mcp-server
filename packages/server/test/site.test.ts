import type { RegionTile } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { findSites } from "../src/planners/site.js";

// Carte de 154×154 façon « Six Flags » (8 octobre 2026) : attractions éparses au nord et au sud, un lac de
// x 50-96 / y 62-101 que Haiku n'a jamais pris, un chemin à l'est du lac.
const land: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
const lake: RegionTile = { h: 4, s: 0, w: 7, t: 0, o: 1 };
const ride: RegionTile = { ...land, r: [3] };
const path: RegionTile = { ...land, p: [{ l: 7, q: 0, e: 0, sd: -1 }] } as RegionTile;

function get(x: number, y: number): RegionTile | undefined {
    if (x < 0 || y < 0 || x > 153 || y > 153) return undefined;
    if (x >= 50 && x <= 96 && y >= 62 && y <= 101) return lake;
    if (x === 100 && y >= 55 && y <= 110) return path;
    // Une attraction tous les 20 tuiles ailleurs : aucun rectangle de 40×30 sur la terre ferme.
    if ((x % 20 === 5 && y % 20 < 4) || (y % 20 === 5 && x % 20 < 4)) return ride;
    return land;
}

describe("findSites", () => {
    it("prend le lac quand la terre ferme est encombrée, station sur la rive près du chemin", () => {
        const sites = findSites(get, { w: 40, h: 30, stationLength: 6, sandbox: false, mapSize: { x: 154, y: 154 } });
        expect(sites.length).toBeGreaterThan(0);
        const best = sites[0];
        expect(best.obstacles).toBe(0);
        expect(best.water).toBeGreaterThan(0.5);
        const { x1, y1, x2, y2 } = best.bounds;
        expect(x1).toBeGreaterThanOrEqual(46);
        expect(x2).toBeLessThanOrEqual(99);
        expect(y1).toBeGreaterThanOrEqual(58);
        expect(y2).toBeLessThanOrEqual(105);
        // Station dans le rectangle, sens du grand côté, 15 tuiles devant au moins.
        const s = best.station;
        expect(s.x).toBeGreaterThanOrEqual(x1);
        expect(s.x).toBeLessThanOrEqual(x2);
        expect(s.y).toBeGreaterThanOrEqual(y1);
        expect(s.y).toBeLessThanOrEqual(y2);
        expect(s.ahead).toBeGreaterThanOrEqual(15);
        expect(s.level).toBe(7);
    });

    it("ne rend rien quand rien ne tient", () => {
        const sites = findSites(get, { w: 80, h: 70, stationLength: 6, sandbox: false, mapSize: { x: 154, y: 154 } });
        expect(sites).toEqual([]);
    });

    it("refuse le terrain non possédé hors sandbox", () => {
        const unowned = (x: number, y: number) => (x < 0 || y < 0 || x > 63 || y > 63 ? undefined : { ...land, o: 0 });
        expect(findSites(unowned, { w: 30, h: 20, stationLength: 6, sandbox: false, mapSize: { x: 64, y: 64 } })).toEqual([]);
        expect(findSites(unowned, { w: 30, h: 20, stationLength: 6, sandbox: true, mapSize: { x: 64, y: 64 } }).length).toBeGreaterThan(0);
    });
});
