import type { RegionTile } from "@openrct2-claude/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { arrivalFor, defaultVocabulary, searchSection } from "../src/planners/search.js";
import { DEFAULT_MODEL, simulate } from "../src/planners/speed.js";
import { Occupancy, SegmentTable, availableInversions, beginPose, compileMacros, pieceElements, rideClearance, rideTrackInfo, searchCatalog, type Macro, type TrackEnv } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const WOODEN = (() => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") return t;
    throw new Error("wooden_roller_coaster");
})();
const wooden = rideTrackInfo(WOODEN)!;
const flatTile: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
const env: TrackEnv = { get: () => flatTile, rideId: 0, sandbox: false, mapSize: { x: 200, y: 200 } };
const catalog = searchCatalog(table, wooden, { steep: true });

/**
 * « Black Widow Vortex XL » (Haiku, 9 octobre 2026) : station de 6 tuiles en (80,98) vers −y au niveau 7, lift de 21,
 * virage small à gauche, chute raide de 21 ; Black Widow +25 %, 3 trains, une boucle. bounds (71,62)-(94,102) : les
 * freins d'arrivée finissent en (80,101), au bord, et aucune pièce ne peut y entrer.
 */
function vortex(y2: number) {
    const station: Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
    const r = compileMacros(table, wooden, { x: 80, y: 98, z: 112, rot: 3, slope: 0, bank: 0 }, [
        ...station,
        { op: "straight", length: 1 },
        { op: "lift", height: 21, steep: false },
        { op: "turn", dir: "left", size: "small", banked: true },
        { op: "drop", height: 21, steep: true },
    ]);
    expect(r.errors).toEqual([]);
    const occ = new Occupancy(rideClearance(WOODEN));
    for (const p of r.pieces) occ.add(pieceElements(p, table.require(p.type)));
    return { r, occ, goal: beginPose(r.pieces[0], table.require(r.pieces[0].type)), bounds: { x1: 71, y1: 62, x2: 94, y2 } };
}

function search(y2: number) {
    const { r, occ, goal, bounds } = vortex(y2);
    const model = { ...DEFAULT_MODEL };
    return searchSection({
        table,
        ride: wooden,
        prefix: r.pieces,
        start: r.end,
        goal,
        occupancy: occ,
        env,
        bounds,
        closureCatalog: catalog,
        speedOf: (pieces, v) => simulate(model, table, pieces, v),
        simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
        simulateFrom: (pieces, v, startPiece) => simulate(model, table, pieces, v, undefined, { startPiece }),
        judge: () => [],
        vStart: simulate(model, table, r.pieces, model.stationSpeed).at(-1)!.vOut,
        minTiles: 190,
        maxTiles: 253,
        minTrains: 3,
        minSteep: 8,
        minInversions: 1,
        trainTiles: 5,
        zMin: 48,
        vocabulary: defaultVocabulary({ inversions: availableInversions(table, wooden).map((s) => s.split("(")[0]) }),
        beamWidth: 120,
        maxDepth: 30,
        timeMs: 100_000,
        results: 1,
    });
}

describe("place d'entrée dans l'arrivée en gare", () => {
    beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

    it("arrivalFor nomme la tuile hors de bounds derrière les freins d'arrivée", () => {
        const { r, occ, goal, bounds } = vortex(102);
        const a = arrivalFor({ table, ride: wooden, goal, prefix: r.pieces, minTrains: 3, closureCatalog: catalog, occupancy: occ, env, bounds, zMin: 48 });
        expect(a.brakes).toBe(2);
        expect(a.blocked).toMatch(/\(80,101\).*\(80,10[34]\).*hors de bounds/);
        const roomy = vortex(104);
        expect(arrivalFor({ table, ride: wooden, goal, prefix: r.pieces, minTrains: 3, closureCatalog: catalog, occupancy: roomy.occ, env, bounds: roomy.bounds, zMin: 48 }).blocked).toBeUndefined();
    });

    it("searchSection s'arrête tout de suite au lieu de 120 s d'« A* introuvable »", () => {
        const res = search(102);
        expect(res.approachBlocked).toMatch(/aucune pièce n'y mène/);
        expect(res.expansions).toBe(0);
    });

    it("deux rangées de plus derrière la station suffisent sur le même site", () => {
        const res = search(104);
        expect(res.candidates.length).toBe(1);
        expect(res.candidates[0].layout.inversions).toBeGreaterThanOrEqual(1);
        expect(res.candidates[0].layout.blocks.maxTrains).toBeGreaterThanOrEqual(3);
    }, 150_000);
});
