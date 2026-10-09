import type { RegionTile } from "@openrct2-claude/protocol";
import { expect } from "vitest";
import { defaultVocabulary, searchSection } from "../src/planners/search.js";
import { DEFAULT_MODEL, simulate } from "../src/planners/speed.js";
import { Occupancy, SegmentTable, beginPose, compileMacros, pieceElements, rideClearance, rideTrackInfo, searchCatalog, type Macro, type TrackEnv } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const WOODEN = (() => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") return t;
    throw new Error("wooden_roller_coaster");
})();
const wooden = rideTrackInfo(WOODEN)!;
const flatTile: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
const env: TrackEnv = { get: () => flatTile, rideId: 0, sandbox: false, mapSize: { x: 200, y: 200 } };

/**
 * Black Widow Plus (Haiku, 8 octobre 2026) : station de 6 tuiles en (56,110) vers +x au niveau 7, 2 tuiles plates, lift
 * de 20 niveaux en ligne droite ; référence Black Widow +20 % (183 tuiles au moins), 3 trains, 11 pièces raides.
 */
export function blackWidowPlus(beamWidth: number, results: number) {
    const station: Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
    const r = compileMacros(table, wooden, { x: 56, y: 110, z: 112, rot: 2, slope: 0, bank: 0 }, [...station, { op: "straight", length: 2 }, { op: "lift", height: 20, steep: false }]);
    expect(r.errors).toEqual([]);
    const occ = new Occupancy(rideClearance(WOODEN));
    for (const p of r.pieces) occ.add(pieceElements(p, table.require(p.type)));
    const model = { ...DEFAULT_MODEL };
    return searchSection({
        table,
        ride: wooden,
        prefix: r.pieces,
        start: r.end,
        goal: beginPose(r.pieces[0], table.require(r.pieces[0].type)),
        occupancy: occ,
        env,
        bounds: { x1: 41, y1: 101, x2: 100, y2: 119 },
        closureCatalog: searchCatalog(table, wooden, { steep: true }),
        speedOf: (pieces, v) => simulate(model, table, pieces, v),
        simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
        simulateFrom: (pieces, v, startPiece) => simulate(model, table, pieces, v, undefined, { startPiece }),
        judge: () => [],
        vStart: simulate(model, table, r.pieces, model.stationSpeed).at(-1)!.vOut,
        minTiles: 183,
        maxTiles: 240,
        minTrains: 3,
        minSteep: 11,
        trainTiles: 5,
        vocabulary: defaultVocabulary(),
        beamWidth,
        maxDepth: 30,
        timeMs: 100_000,
        results,
    });
}
