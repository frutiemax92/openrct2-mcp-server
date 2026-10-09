import type { RegionTile } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { defaultVocabulary, searchSection } from "../src/planners/search.js";
import { DEFAULT_MODEL, simulate } from "../src/planners/speed.js";
import { Occupancy, SegmentTable, availableInversions, beginPose, compileMacros, exitProblem, pieceElements, rideClearance, rideTrackInfo, searchCatalog, type Macro, type TrackEnv } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const typeOf = (name: string) => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === name) return t;
    throw new Error(name);
};
const LOOPING = typeOf("looping_roller_coaster");
const looping = rideTrackInfo(LOOPING)!;
/** Tuile de sortie de la chute de « Black Widow Loop » (pose de fin de compileMacros). */
const QUEUE_X = 96;
const flatTile: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
// File d'attente nord-sud juste devant la sortie de la chute, y 126-134, au niveau du sol (carte de la session de Haiku :
// x = 102 avec l'ancienne chute en escalier, plus près maintenant que la chute est franche).
const queueTile: RegionTile = { ...flatTile, p: [{ l: 7, q: 1, e: 0b0101, sd: -1 }] } as RegionTile;
const envWith = (queue: boolean, qx = QUEUE_X): TrackEnv => ({
    get: (x, y) => (queue && x === qx && y >= 126 && y <= 134 ? queueTile : flatTile),
    rideId: 0,
    sandbox: false,
    mapSize: { x: 200, y: 200 },
});

/** « Black Widow Loop » (Haiku, 8 octobre 2026) : station de 6 tuiles en (57,134) vers +x au niveau 7, lift de 21, chute raide de 20. */
function blackWidowLoop() {
    const station: Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
    const r = compileMacros(table, looping, { x: 57, y: 134, z: 112, rot: 2, slope: 0, bank: 0 }, [
        ...station,
        { op: "straight", length: 2 },
        { op: "lift", height: 21 },
        { op: "drop", height: 20, steep: true },
    ]);
    expect(r.errors).toEqual([]);
    const occ = new Occupancy(rideClearance(LOOPING));
    for (const p of r.pieces) occ.add(pieceElements(p, table.require(p.type)));
    return { r, occ };
}

describe("impasse au bout du circuit", () => {
    it("nomme la file d'attente devant la première chute", () => {
        const { r, occ } = blackWidowLoop();
        expect(r.end).toMatchObject({ x: QUEUE_X, y: 134 });
        expect(exitProblem(table, looping, r.end, occ, envWith(true))).toMatch(new RegExp(`\\(${QUEUE_X},134\\).*file d'attente`));
        expect(exitProblem(table, looping, r.end, occ, envWith(false))).toBeNull();
    });

    it("searchSection s'arrête sur exitBlocked au lieu d'essayer 228 éléments", () => {
        const { r, occ } = blackWidowLoop();
        const model = { ...DEFAULT_MODEL };
        const res = searchSection({
            table,
            ride: looping,
            prefix: r.pieces,
            start: r.end,
            goal: beginPose(r.pieces[0], table.require(r.pieces[0].type)),
            occupancy: occ,
            env: envWith(true),
            bounds: { x1: 50, y1: 123, x2: 118, y2: 138 },
            closureCatalog: searchCatalog(table, looping, { steep: true }),
            speedOf: (pieces, v) => simulate(model, table, pieces, v),
            simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
            judge: () => [],
            vStart: simulate(model, table, r.pieces, model.stationSpeed).at(-1)!.vOut,
            minTiles: 190,
            maxTiles: 240,
            minTrains: 3,
            vocabulary: defaultVocabulary(),
            beamWidth: 40,
            maxDepth: 4,
            timeMs: 5_000,
            results: 1,
        });
        expect(res.exitBlocked).toMatch(/file d'attente/);
        expect(res.expansions).toBe(0);
    });
});

describe("inversions par type de piste", () => {
    it("le bois a la boucle verticale (Haiku avait changé de type en croyant le contraire)", () => {
        for (const name of ["wooden_roller_coaster", "classic_wooden_roller_coaster"])
            expect(availableInversions(table, rideTrackInfo(typeOf(name))!)).toContain("loop(small/medium/large)");
    });
});
