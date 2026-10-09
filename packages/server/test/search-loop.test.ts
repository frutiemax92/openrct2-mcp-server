import type { RegionTile } from "@openrct2-claude/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultVocabulary, searchSection } from "../src/planners/search.js";
import { DEFAULT_MODEL, designTrain, simulate } from "../src/planners/speed.js";
import { Occupancy, SegmentTable, beginPose, compileMacros, pieceElements, rideClearance, rideTrackInfo, searchCatalog, type Macro, type TrackEnv } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const WOODEN = (() => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") return t;
    throw new Error("wooden_roller_coaster");
})();
const wooden = rideTrackInfo(WOODEN)!;
const flatTile: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
const env: TrackEnv = { get: () => flatTile, rideId: 0, sandbox: false, mapSize: { x: 200, y: 200 } };
// Simulateur exact (rideType) et train de bois réel, comme coaster_search_section.
const model = { ...DEFAULT_MODEL, rideType: WOODEN } as typeof DEFAULT_MODEL;
const train = designTrain({ vehicleObject: "rct2.ride.ptct1", carsPerTrain: 6, rideType: WOODEN });
const run = (macros: Macro[], kmh: number) => {
    const r = compileMacros(table, wooden, { x: 50, y: 50, z: 400, rot: 2, slope: 0, bank: 0 }, macros);
    expect(r.errors).toEqual([]);
    return simulate(model, table, r.pieces, kmh / 1.609, train);
};
const stalls = (sim: ReturnType<typeof simulate>) => sim.some((s) => s.stall || s.reached === false);

describe("boucle verticale de bois (Black Widow Loop / Apex de Haiku, 8 octobre 2026)", () => {
    beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    it("la boucle small passe après un frein de bloc et une descente raide ; medium et large calent", () => {
        // Haiku : inversion loop medium après brakes { speed: 6 } (≈ 22 km/h, pas 68) → calage ; sans size, la large.
        const afterBlock = (size: "small" | "medium" | "large") =>
            run([{ op: "brakes", length: 3 }, { op: "block_brakes" }, { op: "drop", height: 8, steep: true }, { op: "inversion", kind: "loop", dir: "left", size }], 7);
        expect(stalls(afterBlock("small"))).toBe(false);
        expect(stalls(afterBlock("medium"))).toBe(true);
        expect(stalls(afterBlock("large"))).toBe(true);
        expect(stalls(run([{ op: "straight", length: 1 }, { op: "inversion", kind: "loop", dir: "left", size: "medium" }], 70))).toBe(true);
    });
    it("toutes les tailles d'inversion dans le vocabulaire", () => {
        const loops = defaultVocabulary({ inversions: ["loop"] }).filter((m) => m[0].op === "inversion");
        expect(loops.map((m) => (m[0] as { size?: string }).size).sort()).toEqual(["large", "large", "medium", "medium", "small", "small"]);
    });
    it("minInversions : la recherche referme avec une boucle et 3 trains", () => {
        const station: Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
        const r = compileMacros(table, wooden, { x: 56, y: 110, z: 112, rot: 2, slope: 0, bank: 0 }, [
            ...station,
            { op: "straight", length: 2 },
            { op: "lift", height: 20, steep: false },
            { op: "drop", height: 20, steep: true },
        ]);
        expect(r.errors).toEqual([]);
        const occ = new Occupancy(rideClearance(WOODEN));
        for (const p of r.pieces) occ.add(pieceElements(p, table.require(p.type)));
        const res = searchSection({
            table,
            ride: wooden,
            prefix: r.pieces,
            start: r.end,
            goal: beginPose(r.pieces[0], table.require(r.pieces[0].type)),
            occupancy: occ,
            env,
            bounds: { x1: 41, y1: 92, x2: 116, y2: 119 },
            closureCatalog: searchCatalog(table, wooden, { steep: true }),
            speedOf: (pieces, v) => simulate(model, table, pieces, v, train),
            simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed, train),
            simulateFrom: (pieces, v, startPiece) => simulate(model, table, pieces, v, train, { startPiece }),
            judge: () => [],
            vStart: simulate(model, table, r.pieces, model.stationSpeed, train).at(-1)!.vOut,
            minTiles: 170,
            maxTiles: 240,
            minTrains: 3,
            minInversions: 1,
            trainTiles: 5,
            vocabulary: defaultVocabulary({ inversions: ["loop"] }),
            beamWidth: 60,
            maxDepth: 30,
            timeMs: 100_000,
            results: 1,
        });
        if (process.env.SEARCH_DEBUG) console.log(res.rejected, res.passes, res.elapsedMs, res.candidates.map((c) => JSON.stringify(c.macros)));
        expect(res.candidates.length).toBe(1);
        const best = res.candidates[0];
        expect(best.layout.inversions).toBeGreaterThanOrEqual(1);
        expect(best.layout.blocks.maxTrains).toBeGreaterThanOrEqual(3);
    }, 120_000);
});
