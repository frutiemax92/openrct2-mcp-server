// Timber Loop (Haiku, 9 octobre 2026) : station au niveau 22 en (12,110), 15 niveaux au-dessus du sol, lift de 20 et
// chute jusqu'en (24,143) au niveau 13, au ras d'un relief vallonné (niveaux 10 à 20). Trois recherches de Haiku : « 0
// fermetures tentées » en 0 s, depuis le bout actuel comme après repli. Causes : le relief contrôlé au coin le plus haut
// (toute montée qui longe une pente refusée, le faisceau mourait au 2e élément), la fermeture A* qui ignorait le
// demi-tour (heuristique), et le faisceau qui gardait des branches sous la station sans l'élan pour y remonter.
// Site relevé en jeu (test/fixtures/timber-loop-site.json : tuiles (0,80)-(63,153), 39 pièces du circuit ouvert).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RegionTile, TrackPieceInfo } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { arrivalFor, defaultVocabulary, fastBlockBrakes, searchSection } from "../src/planners/search.js";
import { DEFAULT_MODEL, designTrain, simulate, trainLength } from "../src/planners/speed.js";
import * as T from "../src/planners/track.js";

const { Occupancy, SegmentTable, beginPose, endPose, cutsSurface, layoutStats, pieceElements, planClosure, rideClearance, rideTrackInfo, searchCatalog } = T;
const table = SegmentTable.fromFile() as InstanceType<typeof SegmentTable>;
let WOODEN = 0;
for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") WOODEN = t;
const wooden = rideTrackInfo(WOODEN)!;

const site = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "timber-loop-site.json"), "utf8")) as {
    mapSize: { x: number; y: number };
    ride: number;
    pieces: TrackPieceInfo[];
    tiles: Record<string, RegionTile>;
};
const env: T.TrackEnv = { get: (x, y) => site.tiles[`${x},${y}`], rideId: site.ride, sandbox: true, mapSize: site.mapSize, clearance: rideClearance(WOODEN) };
const occupancy = () => {
    const occ = new Occupancy(rideClearance(WOODEN));
    for (const p of site.pieces) occ.add(pieceElements(p, table.require(p.type)));
    return occ;
};
const last = site.pieces[site.pieces.length - 1];
const cursor = endPose(last, table.require(last.type));
const station = beginPose(site.pieces[0], table.require(site.pieces[0].type));
const train = designTrain({ vehicleObject: "rct2.ride.mft", rideType: WOODEN })!;
const model = { ...DEFAULT_MODEL, rideType: WOODEN };

describe("relief : quarts de tuile (MapCanConstructWithClearAt)", () => {
    const flat = table.byName("flat")!;
    const up25 = table.byName("up25")!;
    // Tuile au niveau 12, coins N et E relevés : le côté haut d'une up25 vers +x (zQuarter 0b1100 tourné de 2 = N, E).
    const tile: RegionTile = { h: 12, s: 1 | 2, w: 0, t: 0, o: 3 };
    it("une pièce à plat sous un coin relevé coupe le relief ; une montée dont le côté haut couvre ce coin passe", () => {
        const at = { x: 0, y: 0, z: 12 * 16, direction: 2 as const };
        const [f] = pieceElements({ ...at, type: flat.type }, flat);
        const [u] = pieceElements({ ...at, type: up25.type }, up25);
        expect(cutsSurface(tile, f)).toBe(true);
        expect(cutsSurface(tile, u)).toBe(false);
        // Plus de 2 niveaux sous le coin relevé : refusé même sur un quart relevé.
        expect(cutsSurface({ ...tile, h: 15 }, u)).toBe(true);
    });

    it("depuis le bout de Timber Loop, une montée qui longe la pente vers +x est posable", () => {
        const r = T.compileMacros(table, wooden, cursor, [{ op: "climb", height: 4 }]);
        expect(r.errors).toEqual([]);
        const why = r.pieces.flatMap((p) => pieceElements(p, table.require(p.type))).map((e) => T.blockProblem(env, e));
        expect(why.filter(Boolean)).toEqual([]);
    });
});

describe("fermeture A* : coût restant à rebours (costToGoal)", () => {
    it("une pose devant l'arrivée se referme dans le budget de la recherche (4000 expansions), pas sans le coût restant", () => {
        const catalog = searchCatalog(table, wooden, { steep: true, diagonals: true }).filter((s) => !T.isSBend(s));
        const bounds = { x1: 10, y1: 100, x2: 50, y2: 152 };
        // Arrivée imposée par 3 trains : 2 freins + frein de bloc devant la station, entrée en (12,107) niveau 22.
        const arrival = arrivalFor({ table, ride: wooden, goal: station, prefix: site.pieces, minTrains: 3, closureCatalog: catalog, occupancy: occupancy(), env, bounds, zMin: 144 });
        expect(arrival.blocked).toBeUndefined();
        const t0 = Date.now();
        const toGo = T.costToGoal(catalog, arrival.target, arrival.occ, env, { zMin: 144, bounds });
        expect(Date.now() - t0).toBeLessThan(5000);
        // Relevé dans la recherche : 9 pièces, 13 825 expansions avec la seule heuristique géométrique.
        const from = { x: 13, y: 106, z: 336, rot: 1, slope: 0, bank: 0 };
        const opts = { maxPieces: 16, maxExpansions: 4000, zMin: 144, bounds, chainClimbs: false };
        expect(planClosure(catalog, from, arrival.target, arrival.occ, env, opts)).toBeNull();
        const res = planClosure(catalog, from, arrival.target, arrival.occ, env, { ...opts, costToGo: toGo });
        expect(res).not.toBeNull();
        expect(res!.pieces.length).toBeLessThanOrEqual(12);
        // Poche fermée (entre le bord de bounds et l'arrivée) : refusée sans exploration.
        const pocket = planClosure(catalog, { x: 10, y: 107, z: 408, rot: 0, slope: 2, bank: 2 }, arrival.target, arrival.occ, env, { ...opts, costToGo: toGo });
        expect(pocket).toBeNull();
    });
});

describe("recherche depuis le bout de Timber Loop (3 trains)", () => {
    it("trouve une fin, posable (freins de bloc jugés sur le circuit entier) et qui ne cale pas", () => {
        const prefixTiles = layoutStats(table, site.pieces).lengthTiles;
        const res = searchSection({
            table,
            ride: wooden,
            prefix: site.pieces,
            start: cursor,
            goal: station,
            occupancy: occupancy(),
            env,
            bounds: { x1: 10, y1: 100, x2: 50, y2: 152 },
            closureCatalog: searchCatalog(table, wooden, { steep: true, diagonals: true }),
            speedOf: (p, v) => simulate(model, table, p, v, train),
            simulateCircuit: (p) => simulate(model, table, p, model.stationSpeed, train),
            simulateFrom: (p, v, s) => simulate(model, table, p, v, train, { startPiece: s }),
            judge: () => [],
            vStart: simulate(model, table, site.pieces, model.stationSpeed, train).at(-1)!.vOut,
            minTiles: prefixTiles + 10,
            maxTiles: prefixTiles + 400,
            minTrains: 3,
            trainTiles: trainLength(train),
            vocabulary: defaultVocabulary(),
            beamWidth: 40,
            timeMs: 60_000,
            results: 1,
            zMin: 144,
            energyK: model.K,
        });
        expect(res.exitBlocked).toBeUndefined();
        expect(res.candidates.length).toBeGreaterThan(0);
        const c = res.candidates[0];
        const all = [...site.pieces, ...c.pieces, ...c.closure];
        const sim = simulate(model, table, all, model.stationSpeed, train);
        expect(sim.some((s) => s.stall)).toBe(false);
        expect(c.layout.blocks.maxTrains).toBeGreaterThanOrEqual(3);
        expect(fastBlockBrakes(all, sim, site.pieces.length, table, station)).toEqual([]);
    }, 120_000);
});
