// Timber Ridge (Haiku, 10 octobre 2026) : lift au niveau 31, station au niveau 7, 3 trains, excitation 7,5 au moins.
// Haiku a d'abord posé une chute tordue de 17 niveaux au jugé (24 tenaient jusqu'au sol) : 7,38. Avec la chute de 24
// niveaux, trois recherches sans fin : la note du faisceau (compacité seule) dépensait l'élan en virages plats avant le
// frein de bloc, puis posait les boucles, lentes. Site relevé en jeu (test/fixtures/timber-ridge-site.json : bounds
// (18,44)-(96,78), 40 pièces, chute de 24 niveaux comprise).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RegionTile, TrackPieceInfo } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { estimateRatings, firstDropSpeed, speedForExcitement } from "../src/planners/estimate.js";
import { defaultVocabulary, searchSection } from "../src/planners/search.js";
import { DEFAULT_MODEL, simulate, trainLength, type TrainShape } from "../src/planners/speed.js";
import * as T from "../src/planners/track.js";
import { firstDrop } from "../src/planners/target.js";

const { Occupancy, SegmentTable, beginPose, endPose, layoutStats, pieceElements, rideClearance, rideTrackInfo, searchCatalog } = T;
const table = SegmentTable.fromFile() as InstanceType<typeof SegmentTable>;
let WOODEN = 0;
for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") WOODEN = t;
const wooden = rideTrackInfo(WOODEN)!;

const site = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "timber-ridge-site.json"), "utf8")) as {
    mapSize: { x: number; y: number };
    ride: number;
    vehicleObject: string;
    liftHillSpeed: number;
    train: TrainShape;
    bounds: T.TrackBounds;
    minTiles: number;
    maxTiles: number;
    zMin: number;
    pieces: (TrackPieceInfo & { chain?: boolean })[];
    tiles: Record<string, RegionTile>;
};
const env: T.TrackEnv = { get: (x, y) => site.tiles[`${x},${y}`], rideId: site.ride, sandbox: true, mapSize: site.mapSize, clearance: rideClearance(WOODEN) };
const model = { ...DEFAULT_MODEL, rideType: WOODEN };
const train = site.train;
const station = beginPose(site.pieces[0], table.require(site.pieces[0].type));
const TARGET = 7.55;
const estimate = (open: boolean) => (all: TrackPieceInfo[]) =>
    estimateRatings({ table, rideType: WOODEN, pieces: all, train, vehicleObject: site.vehicleObject, liftHillSpeed: site.liftHillSpeed, env, carsPerTrain: train.cars, open });

/** La recherche de coaster_search_section (minExcitement, 3 trains, 2 inversions), depuis `prefix`. */
function search(prefix: typeof site.pieces, withDrop: boolean) {
    const occ = new Occupancy(rideClearance(WOODEN));
    for (const p of prefix) occ.add(pieceElements(p, table.require(p.type)));
    const last = prefix[prefix.length - 1];
    return searchSection({
        table,
        ride: wooden,
        prefix,
        start: endPose(last, table.require(last.type)),
        goal: station,
        occupancy: occ,
        env,
        bounds: site.bounds,
        closureCatalog: searchCatalog(table, wooden, { steep: true, diagonals: true }),
        speedOf: (p, v) => simulate(model, table, p, v, train),
        simulateCircuit: (p) => simulate(model, table, p, model.stationSpeed, train),
        simulateFrom: (p, v, s) => simulate(model, table, p, v, train, { startPiece: s }),
        judge: () => [],
        vStart: simulate(model, table, prefix, model.stationSpeed, train).at(-1)!.vOut,
        minTiles: site.minTiles,
        maxTiles: site.maxTiles,
        minTrains: 3,
        trainTiles: trainLength(train),
        minInversions: 2,
        vocabulary: defaultVocabulary({ inversions: ["loop"] }),
        beamWidth: 80,
        maxDepth: Math.min(30, Math.max(16, Math.ceil((site.minTiles - layoutStats(table, prefix).lengthTiles) / 5))),
        timeMs: 90_000,
        results: 3,
        zMin: site.zMin,
        energyK: model.K,
        estimate: estimate(false),
        estimatePartial: estimate(true),
        minExcitement: TARGET - 0.4,
        targetExcitement: TARGET,
        firstDrop: withDrop
            ? { minKmh: speedForExcitement(TARGET), speed: (all) => firstDropSpeed(table, wooden, all, (p) => simulate(model, table, p as TrackPieceInfo[], model.stationSpeed, train))?.kmh ?? null }
            : undefined,
    });
}

describe("Timber Ridge : la plus haute première chute, et une fin qui atteint l'excitation", () => {
    it("depuis le bas de la chute de 24 niveaux : une fin estimée à l'objectif", () => {
        const res = search(site.pieces, false);
        expect(Math.max(...res.candidates.map((c) => c.estimate?.excitement ?? 0))).toBeGreaterThanOrEqual(TARGET);
    }, 150_000);

    it("depuis le sommet du lift : la recherche pose une chute à 2 niveaux près de la plus haute, et atteint l'objectif", () => {
        const prefix = site.pieces.slice(0, -7);
        const res = search(prefix, true);
        const best = res.candidates.find((c) => (c.estimate?.excitement ?? 0) >= TARGET);
        expect(best).toBeDefined();
        // Plus haute chute qui tient ici : 25 niveaux (en diagonale), 24 en ligne droite jusqu'au sol.
        expect(firstDrop(table, [...prefix, ...best!.pieces])!.height).toBeGreaterThanOrEqual(23);
    }, 150_000);
});
