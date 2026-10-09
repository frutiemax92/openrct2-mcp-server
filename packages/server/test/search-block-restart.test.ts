import type { RegionTile } from "@openrct2-claude/protocol";
import { expect, it } from "vitest";
import { defaultVocabulary, searchSection } from "../src/planners/search.js";
import { DEFAULT_MODEL, simulate } from "../src/planners/speed.js";
import * as T from "../src/planners/track.js";
const { Occupancy, SegmentTable, beginPose, compileMacros, pieceElements, rideClearance, rideTrackInfo, searchCatalog } = T;

const table = SegmentTable.fromFile() as InstanceType<typeof SegmentTable>;
let WOODEN = 0;
for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") WOODEN = t;
const wooden = rideTrackInfo(WOODEN)!;
const flatTile: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
const env: T.TrackEnv = { get: () => flatTile, rideId: 0, sandbox: true, mapSize: { x: 200, y: 200 } };
const station: T.Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
const r = compileMacros(table, wooden, { x: 18, y: 66, z: 112, rot: 2, slope: 0, bank: 0 }, [
    ...station,
    { op: "straight", length: 2 },
    { op: "lift", height: 16 },
    { op: "drop", height: 14, steep: true },
]);
const occ = new Occupancy(rideClearance(WOODEN));
for (const p of r.pieces) occ.add(pieceElements(p, table.require(p.type)));
const model = { ...DEFAULT_MODEL };

/**
 * Black Widow Loop (Haiku, 8 octobre 2026) : station de 6 tuiles en (18,66) vers +x, lift de 16, chute raide de 14,
 * 3 trains et une boucle dans x 12–55, y 56–72. Sans contrôle de repartie dans le faisceau, toutes les branches
 * descendaient d'un frein de bloc de mi-parcours suivi d'une montée, et aucune fermeture n'aboutissait.
 */
it("écarte dès la pose un frein de bloc de mi-parcours qui ne repart pas (Black Widow Loop)", () => {
    expect(r.errors).toEqual([]);
    const res = searchSection({
        table,
        ride: wooden,
        prefix: r.pieces,
        start: r.end,
        goal: beginPose(r.pieces[0], table.require(r.pieces[0].type)),
        occupancy: occ,
        env,
        bounds: { x1: 12, y1: 56, x2: 55, y2: 72 },
        closureCatalog: searchCatalog(table, wooden, { steep: true }),
        speedOf: (pieces, v) => simulate(model, table, pieces, v),
        simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
        simulateFrom: (pieces, v, startPiece) => simulate(model, table, pieces, v, undefined, { startPiece }),
        judge: () => [],
        vStart: simulate(model, table, r.pieces, model.stationSpeed).at(-1)!.vOut,
        minTiles: 153,
        maxTiles: 202,
        minTrains: 3,
        minInversions: 1,
        trainTiles: 5,
        vocabulary: defaultVocabulary({ inversions: ["loop"] }),
        beamWidth: 80,
        maxDepth: 30,
        timeMs: 60_000,
        results: 1,
    });
    expect(res.candidates.length).toBe(1);
    expect(res.rejected["frein de bloc qui ne repart pas"] ?? 0).toBe(0);
}, 90_000);
