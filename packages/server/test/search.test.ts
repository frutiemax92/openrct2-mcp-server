import type { RegionTile } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { defaultVocabulary, searchSection } from "../src/planners/search.js";
import { DEFAULT_MODEL, simulate } from "../src/planners/speed.js";
import {
    Occupancy,
    SegmentTable,
    beginPose,
    compileMacros,
    pieceElements,
    rideClearance,
    rideTrackInfo,
    searchCatalog,
    type Macro,
    type TrackEnv,
} from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const WOODEN = rideTypeByName("wooden_roller_coaster");
const wooden = rideTrackInfo(WOODEN)!;
const flatTile: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
const env: TrackEnv = { get: () => flatTile, rideId: 0, sandbox: false, mapSize: { x: 200, y: 200 } };

function rideTypeByName(name: string): number {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === name) return t;
    throw new Error(name);
}

/** Début de Venom Weaver (ride 11, 8 octobre 2026) : station, creux, demi-tour, lift 25°, demi-tour au sommet, première chute. */
function venomStart() {
    const station: Macro[] = ["beginStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
    const first: Macro[] = [
        { op: "drop", height: 2 },
        { op: "straight", length: 6 },
        { op: "turn", dir: "left", size: "small", quarters: 2 },
        { op: "lift", height: 17, steep: false },
        { op: "turn", dir: "right", size: "small", quarters: 2, slope: "down" },
        { op: "drop", height: 13, steep: true },
    ];
    const r = compileMacros(table, wooden, { x: 70, y: 51, z: 160, rot: 0, slope: 0, bank: 0 }, [...station, ...first]);
    expect(r.errors).toEqual([]);
    const occ = new Occupancy(rideClearance(WOODEN));
    for (const p of r.pieces) occ.add(pieceElements(p, table.require(p.type)));
    return { pieces: r.pieces, end: r.end, occ, goal: beginPose(r.pieces[0], table.require(r.pieces[0].type)) };
}

describe("searchSection", () => {
    it("referme un circuit dans bounds, sans chaîne ni S-bend, en empilant", () => {
        const s = venomStart();
        const bounds = { x1: 53, y1: 41, x2: 78, y2: 56 };
        const model = { ...DEFAULT_MODEL };
        const vocabulary = defaultVocabulary();
        const res = searchSection({
            table,
            ride: wooden,
            prefix: s.pieces,
            start: s.end,
            goal: s.goal,
            occupancy: s.occ,
            env,
            bounds,
            closureCatalog: searchCatalog(table, wooden, { steep: true }),
            speedOf: (pieces, v) => simulate(model, table, pieces, v),
            simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
            judge: () => [],
            vStart: simulate(model, table, s.pieces, model.stationSpeed).at(-1)!.vOut,
            minTiles: 130,
            maxTiles: 200,
            minTrains: 2,
            vocabulary,
            beamWidth: 12,
            maxDepth: 14,
            timeMs: 20_000,
            results: 3,
        });
        if (process.env.SEARCH_DEBUG) console.log(JSON.stringify(res.candidates.map((c) => ({ score: c.score, len: c.layout.lengthTiles, fp: c.layout.footprint.size, stacked: c.space.stackedTiles, lift: c.liftShared, macros: c.macros, closure: c.closure.map((p) => p.name) })), null, 1), res.elapsedMs, res.approachBlocked);
        expect(res.candidates.length).toBeGreaterThan(0);
        const best = res.candidates[0];
        const added = [...best.pieces, ...best.closure];
        for (const p of added) {
            expect(p.chain).toBeFalsy();
            for (const e of pieceElements(p, table.require(p.type))) {
                expect(e.x).toBeGreaterThanOrEqual(bounds.x1);
                expect(e.x).toBeLessThanOrEqual(bounds.x2);
                expect(e.y).toBeGreaterThanOrEqual(bounds.y1);
                expect(e.y).toBeLessThanOrEqual(bounds.y2);
            }
        }
        expect(best.layout.blocks.maxTrains).toBe(2);
        expect(best.layout.lengthTiles).toBeGreaterThanOrEqual(130);
        expect(best.sBends).toBe(0);
        expect(best.space.stackedTiles).toBeGreaterThan(2);
    }, 60_000);
});
