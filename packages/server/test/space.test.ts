import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { freeVolume, largestEmptyRect, spaceElements, spaceLevers, spaceProfile, spaceView, suggestedBounds } from "../src/planners/space.js";
import { designLayout, parseTrackDesign } from "../src/planners/td6.js";
import { Occupancy, SegmentTable, boundsProblem, compileMacros, planClosure, rideClearance, rideTrackInfo, searchCatalog, type TrackEnv, type TrackPose } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const twister = rideTrackInfo(51)!;
const FRIGHTMARE = "/home/lucas/snap/steam/common/.local/share/Steam/steamapps/common/Rollercoaster Tycoon 2/Tracks/Frightmare.TD6";
const start: TrackPose = { x: 40, y: 40, z: 14 * 16, rot: 2, slope: 0, bank: 0 };
const typeOf = (name: string): number => table.byName(name)!.type;

describe("espace : découpage en éléments", () => {
    it("chaîne = lift, une droite ou une transition ferme l'élément, même genre = un seul élément", () => {
        const names = ["endStation", "flatToUp25", "up25", "up25", "up25ToFlat", "leftQuarterTurn3Tiles", "leftQuarterTurn3Tiles", "flat", "leftQuarterTurn3Tiles", "brakes"];
        const pieces = names.map((name, i) => ({ type: typeOf(name), x: i, y: 0, z: 0, direction: 0 as const, chain: name === "up25" || undefined }));
        expect(spaceElements(pieces)).toEqual([
            { kind: "station", from: 0, to: 0 },
            { kind: "lift", from: 2, to: 3 },
            { kind: "quarterTurn3Tiles", from: 5, to: 6 },
            { kind: "quarterTurn3Tiles", from: 8, to: 8 },
            { kind: "brakes", from: 9, to: 9 },
        ]);
    });

    it("le préfixe banked/halfBanked et le côté sont retirés", () => {
        const pieces = ["bankedLeftQuarterTurn5Tiles", "rightQuarterTurn5Tiles", "leftHalfBankedHelixDownSmall"].map((name) => ({ type: typeOf(name), x: 0, y: 0, z: 0, direction: 0 as const }));
        expect(spaceElements(pieces).map((e) => e.kind)).toEqual(["quarterTurn5Tiles", "helixDownSmall"]);
    });
});

describe("espace : plus grand rectangle vide", () => {
    it("trouve le rectangle maximal, pas le plus haut ni le plus large", () => {
        // 6×4, piste en x = 2 sur les lignes 0 et 1, et en (5, 3).
        const filled = new Set(["2,0", "2,1", "5,3"]);
        expect(largestEmptyRect(6, 4, (x, y) => filled.has(`${x},${y}`))).toEqual({ x: 0, y: 2, w: 5, h: 2 });
        expect(largestEmptyRect(3, 3, () => true)).toBeNull();
        expect(largestEmptyRect(3, 2, () => false)).toEqual({ x: 0, y: 0, w: 3, h: 2 });
    });
});

describe("espace : profil d'un tracé", () => {
    it("un aller simple ne croise rien : aucune tuile empilée, les éléments éloignés sont isolés", () => {
        const plan = compileMacros(table, twister, start, [
            { op: "lift", height: 10, steep: false },
            { op: "drop", height: 10, steep: false },
            { op: "straight", length: 6 },
            { op: "turn", dir: "left", size: "medium", banked: true },
            { op: "straight", length: 6 },
            { op: "turn", dir: "left", size: "medium", banked: true },
        ]);
        expect(plan.error).toBeUndefined();
        const s = spaceProfile(table, plan.pieces);
        expect(s.stackedTiles).toBe(0);
        expect(s.elements.every((e) => e.shared === 0 && e.crossings.length === 0)).toBe(true);
        expect(s.trackTiles).toBeLessThanOrEqual(s.footprint.area);
        expect(s.coverage).toBeCloseTo(s.trackTiles / s.footprint.area, 6);
        // Le lift ne partage rien et n'a pour voisin que la suite de la chute, 3 tuiles plus loin sur la même ligne.
        expect(s.elements[0]).toMatchObject({ kind: "lift", shared: 0, isolated: true });
        expect(s.elements[0].nearestGap).toBeGreaterThanOrEqual(2);
        expect(s.isolated).toContain(0);
    });

    it("tracé ouvert : les indices ne bouclent pas, une hélice de deux tours s'empile sur elle-même", () => {
        const plan = compileMacros(table, twister, start, [{ op: "helix", dir: "left", quarters: 8, down: true, size: "small" }]);
        expect(plan.error).toBeUndefined();
        // Transition d'inclinaison puis 4 demi-tours : les pièces 1 et 4 sont à 3 indices, donc non voisines, et la 4e passe sous la 1re.
        expect(plan.pieces).toHaveLength(5);
        const s = spaceProfile(table, plan.pieces);
        expect(s.closed).toBe(false);
        expect(s.stackedTiles).toBeGreaterThan(0);
        // Fermé de force, les pièces 1 et 4 deviendraient voisines (5 − 3 = 2) et rien ne serait empilé.
        expect(spaceProfile(table, plan.pieces, { closed: true }).stackedTiles).toBe(0);
    });

    it.skipIf(!existsSync(FRIGHTMARE))("Frightmare.TD6 : mêmes chiffres que COASTER_SPACE.md section 1", () => {
        const l = designLayout(parseTrackDesign(readFileSync(FRIGHTMARE), "Frightmare.TD6"), table, { x: 0, y: 0, z: 0 }, 0);
        const s = spaceProfile(table, l.pieces);
        expect(s.closed).toBe(true);
        expect(s.footprint).toMatchObject({ w: 24, h: 17, area: 408 });
        expect(s.coverage).toBeGreaterThan(0.43);
        expect(s.coverage).toBeLessThan(0.47);
        expect(Math.abs(s.stackedTiles - 80)).toBeLessThanOrEqual(4);
        expect(s.largestVoid).toMatchObject({ w: 8, h: 8 });
        expect(s.largestVoid!.share).toBeCloseTo(0.16, 2);
        expect(s.elements).toHaveLength(27);
        expect(s.elements.filter((e) => e.nearestGap === 0)).toHaveLength(21);

        const lift = s.elements.find((e) => e.kind === "lift")!;
        expect(lift).toMatchObject({ tiles: 19, nearestGap: 0, shared: 11, minLevelGap: 2.5 });
        // Le lift passe au-dessus de l'hélice montante finale et de la grande hélice descendante.
        expect(lift.crossings.find((c) => c.kind === "helixUpSmall")).toMatchObject({ side: "dessus", tiles: 4 });
        expect(lift.crossings.find((c) => c.kind === "helixDownLarge")).toMatchObject({ side: "dessus", minLevelGap: 2.5 });

        const loop = s.elements.find((e) => e.kind === "largeHalfLoopUp")!;
        expect(loop).toMatchObject({ nearestGap: 0, shared: 5, minLevelGap: 1.5 });
        expect(loop.crossings).toEqual([expect.objectContaining({ kind: "helixUpSmall", tiles: 5, minLevelGap: 1.5, side: "dessus" })]);

        const cork = s.elements.find((e) => e.kind === "corkscrewUp")!;
        expect(cork).toMatchObject({ nearestGap: 0, minLevelGap: 10.5 });
        expect(cork.crossings[0]).toMatchObject({ kind: "quarterTurn5TileUp25", side: "dessus" });

        // Un seul élément isolé : le virage vertical d'1 tuile en haut du lift.
        expect(s.isolated.map((i) => s.elements[i].kind)).toEqual(["quarterTurn1TileDown60"]);
    });
});

describe("espace : volume libre", () => {
    const flat = { h: 7, s: 0, w: 0, t: 0, o: 1 };

    it("sans carte : tout est libre sauf le dégagement des blocs posés", () => {
        const pieces = [{ type: typeOf("flat"), x: 10, y: 10, z: 20 * 16, direction: 0 as const }];
        const v = freeVolume(table, pieces, { x1: 10, y1: 10, x2: 11, y2: 10 }, { clearance: rideClearance(51), maxLevel: 40 });
        const [a, b] = v.get("10,10")!;
        expect(a).toEqual([0, 20]);
        expect(b[0]).toBeGreaterThan(20);
        expect(b[1]).toBe(40);
        expect(v.get("11,10")).toEqual([[0, 40]]);
    });

    it("avec la carte : le sol, les chemins et les pièces d'attraction déjà posées réduisent le volume", () => {
        const tiles: Record<string, object> = {
            "5,5": { ...flat, p: [{ l: 12 }] },
            "6,5": { ...flat, ri: [[15, 18]] },
        };
        const v = freeVolume(table, [], { x1: 5, y1: 5, x2: 7, y2: 5 }, { clearance: 24, maxLevel: 30, get: (x, y) => (tiles[`${x},${y}`] ?? flat) as never });
        expect(v.get("5,5")).toEqual([
            [7, 12],
            [15, 30],
        ]);
        expect(v.get("6,5")).toEqual([
            [7, 15],
            [18, 30],
        ]);
        expect(v.get("7,5")).toEqual([[7, 30]]);
    });
});

describe("espace : bounds, vue et leviers", () => {
    it("boundsProblem refuse les blocs hors du rectangle et des niveaux", () => {
        const b = { x1: 10, y1: 10, x2: 20, y2: 15, minLevel: 7, maxLevel: 30 };
        expect(boundsProblem(b, { x: 10, y: 15, z: 7 * 16 })).toBeNull();
        expect(boundsProblem(b, { x: 21, y: 12, z: 160 })).toMatch(/hors de bounds/);
        expect(boundsProblem(b, { x: 12, y: 12, z: 6 * 16 })).toMatch(/minLevel/);
        expect(boundsProblem(b, { x: 12, y: 12, z: 31 * 16 })).toMatch(/maxLevel/);
    });

    it("la fermeture A* reste dans bounds", () => {
        const env: TrackEnv = { get: () => ({ h: 4, s: 0, w: 0, t: 0, o: 1 }), rideId: 0, sandbox: false, mapSize: { x: 200, y: 200 } };
        const catalog = searchCatalog(table, twister, { steep: false, chainedClimbsOnly: true });
        const from: TrackPose = { x: 40, y: 40, z: 160, rot: 2, slope: 0, bank: 0 };
        const goal: TrackPose = { x: 40, y: 44, z: 160, rot: 0, slope: 0, bank: 0 };
        const free = planClosure(catalog, from, goal, new Occupancy(rideClearance(51)), env, { zMin: 64 });
        expect(free).not.toBeNull();
        const bounds = { x1: 38, y1: 38, x2: 46, y2: 46 };
        const boxed = planClosure(catalog, from, goal, new Occupancy(rideClearance(51)), env, { bounds, zMin: 64 });
        expect(boxed).not.toBeNull();
        for (const p of boxed!.pieces) expect(p.x >= 38 && p.x <= 46 && p.y >= 38 && p.y <= 46).toBe(true);
        expect(planClosure(catalog, from, goal, new Occupancy(rideClearance(51)), env, { bounds: { x1: 40, y1: 40, x2: 41, y2: 44 }, maxExpansions: 5000, zMin: 64 })).toBeNull();
    });

    it.skipIf(!existsSync(FRIGHTMARE))("Frightmare : bounds conseillé, aucun levier contre elle-même, leviers contre un anneau étalé", () => {
        const l = designLayout(parseTrackDesign(readFileSync(FRIGHTMARE), "Frightmare.TD6"), table, { x: 0, y: 0, z: 0 }, 0);
        const ref = spaceProfile(table, l.pieces, { closed: true });
        const sb = suggestedBounds(ref);
        expect([sb.w, sb.h].sort((a, b) => a - b)).toEqual([19, 27]);
        expect(spaceLevers(ref, ref)).toEqual([]);
        expect(spaceView(ref).liftShared).toBe(11);
        // Anneau : 4 longues droites et 4 virages, rien d'empilé.
        const ring = compileMacros(table, twister, start, [
            { op: "straight", length: 20 },
            { op: "turn", dir: "right", size: "medium" },
            { op: "straight", length: 14 },
            { op: "turn", dir: "right", size: "medium" },
            { op: "straight", length: 20 },
            { op: "turn", dir: "right", size: "medium" },
            { op: "straight", length: 14 },
            { op: "turn", dir: "right", size: "medium" },
        ]);
        const levers = spaceLevers(spaceProfile(table, ring.pieces, { closed: true }), ref);
        expect(levers.some((x) => /emprise/.test(x))).toBe(true);
        expect(levers.some((x) => /empilées/.test(x))).toBe(true);
        expect(levers.some((x) => /vide/.test(x))).toBe(true);
    });
});
