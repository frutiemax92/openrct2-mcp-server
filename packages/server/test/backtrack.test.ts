import type { RegionTile } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { retreatOptions, roomAhead } from "../src/planners/backtrack.js";
import { defaultVocabulary, searchSection, type SearchInput } from "../src/planners/search.js";
import { DEFAULT_MODEL, simulate } from "../src/planners/speed.js";
import * as T from "../src/planners/track.js";
const { Occupancy, SegmentTable, beginPose, compileMacros, pieceElements, rideClearance, rideTrackInfo, searchCatalog } = T;

const table = SegmentTable.fromFile() as InstanceType<typeof SegmentTable>;
let WOODEN = 0;
for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") WOODEN = t;
const wooden = rideTrackInfo(WOODEN)!;

/**
 * « Black Widow Sidewinder » refait par Haiku (9 octobre 2026), terrain plat au niveau 7 : station en (100,62) vers +y,
 * lift droit de 23 niveaux, chute raide droite jusqu'au sol en (100,102). Chemin en colonne x 101 (y 96–104), en rangée
 * y 96 (x 94–120) et y 54, file d'attente x 102 (y 55–67) ; bounds (95,55)-(119,104) (Black Widow Max commence en y 105).
 */
const path = (x: number, y: number): boolean => (x === 101 && y >= 96 && y <= 104) || (y === 96 && x >= 94 && x <= 120) || (y === 54 && x >= 85 && x <= 106);
const queue = (x: number, y: number): boolean => x === 102 && y >= 55 && y <= 67;
const env: T.TrackEnv = {
    get: (x, y): RegionTile => ({ h: 7, s: 0, w: 0, t: 0, o: 1, ...(path(x, y) ? { p: [{ l: 7 }] } : queue(x, y) ? { p: [{ l: 7, q: true }] } : {}) }) as RegionTile,
    rideId: 0,
    sandbox: true,
    mapSize: { x: 154, y: 154 },
};
const bounds = { x1: 95, y1: 55, x2: 119, y2: 104 };
const station: T.Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
const r = compileMacros(table, wooden, { x: 100, y: 62, z: 112, rot: 1, slope: 0, bank: 0 }, [...station, { op: "lift", height: 23, steep: false }, { op: "drop", height: 23, steep: true }]);
const occOf = (pieces: T.PlannedPiece[]) => {
    const o = new Occupancy(rideClearance(WOODEN));
    for (const p of pieces) o.add(pieceElements(p, table.require(p.type)));
    return o;
};
const model = { ...DEFAULT_MODEL };
const search = (prefix: T.PlannedPiece[], start: T.TrackPose, timeMs: number) =>
    searchSection({
        table,
        ride: wooden,
        prefix,
        start,
        goal: beginPose(r.pieces[0], table.require(r.pieces[0].type)),
        occupancy: occOf(prefix),
        env,
        bounds,
        closureCatalog: searchCatalog(table, wooden, { steep: true }),
        speedOf: (pieces, v) => simulate(model, table, pieces, v),
        simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
        simulateFrom: (pieces, v, startPiece) => simulate(model, table, pieces, v, undefined, { startPiece }),
        judge: () => [],
        vStart: simulate(model, table, prefix, model.stationSpeed).at(-1)!.vOut,
        // Black Widow Titan modifié (3 trains) : 219 tuiles, fermeture permise de 90 % à 120 %, une boucle.
        minTiles: 198,
        maxTiles: 262,
        minInversions: 1,
        minTrains: 3,
        trainTiles: 5.4,
        vocabulary: defaultVocabulary({ inversions: ["loop"] }),
        timeMs,
        results: 1,
    } satisfies SearchInput);

describe("repli quand le bout du circuit est une poche (Black Widow Sidewinder)", () => {
    it("le site reproduit l'échec : pas de fin depuis la chute au sol", () => {
        expect(r.errors).toEqual([]);
        expect(r.end).toMatchObject({ x: 100, y: 102, z: 112, rot: 1 });
        expect(search(r.pieces, r.end, 15_000).candidates.length).toBe(0);
    }, 60_000);

    it("roomAhead signale la poche au sol, pas la même pose 7 niveaux plus haut", () => {
        const occ = occOf(r.pieces);
        expect(roomAhead(env, occ, r.end, bounds, 80)).toBeLessThan(60);
        expect(roomAhead(env, occ, { ...r.end, x: 104, y: 104, z: 14 * 16, rot: 2 }, bounds, 80)).toBe(80);
    });

    it("retreatOptions recule au sommet du lift et refait la chute moins haute, sans descendre sous dropMin", () => {
        const opts = retreatOptions(table, wooden, r.pieces, env, rideClearance(WOODEN), { bounds, dropMin: 16 });
        const drops = opts.filter((o) => o.macros.length);
        expect(drops.length).toBeGreaterThan(0);
        const lift = r.pieces.filter((p) => p.chain).length;
        for (const o of drops) {
            expect(o.prefix.filter((p) => p.chain).length).toBe(lift);
            const h = (o.macros[0] as { height: number }).height;
            expect(h).toBeGreaterThanOrEqual(16);
            expect(h).toBeLessThan(23);
        }
    });

    it("une relance trouve une fin avec 3 trains", () => {
        const opts = retreatOptions(table, wooden, r.pieces, env, rideClearance(WOODEN), { bounds, dropMin: 16 });
        let found: { undo: number; height: number } | null = null;
        for (const o of opts) {
            const res = search(o.prefix, o.start, 30_000);
            if (res.candidates.length) {
                expect(res.candidates[0].layout.blocks.maxTrains).toBeGreaterThanOrEqual(3);
                found = { undo: o.undo, height: (o.macros[0] as { height?: number } | undefined)?.height ?? 0 };
                break;
            }
        }
        expect(found).not.toBeNull();
    }, 240_000);
});
