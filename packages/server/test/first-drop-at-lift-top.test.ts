import type { RegionTile } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { endsAtLiftTop, firstDropSpeed, liftTopSpeed, speedForExcitement } from "../src/planners/estimate.js";
import { defaultVocabulary, firstDropVocabulary, searchSection } from "../src/planners/search.js";
import { DEFAULT_MODEL, designTrain, simulate } from "../src/planners/speed.js";
import { Occupancy, SegmentTable, beginPose, compileMacros, pieceElements, rideClearance, rideTrackInfo, searchCatalog, type Macro, type TrackEnv } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const WOODEN = (() => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") return t;
    throw new Error("wooden_roller_coaster");
})();
const ride = rideTrackInfo(WOODEN)!;
const model = { ...DEFAULT_MODEL, rideType: WOODEN } as typeof DEFAULT_MODEL;
const train = designTrain({ vehicleObject: "rct2.ride.ptct1", carsPerTrain: 7, rideType: WOODEN });
const sim = (pieces: Parameters<typeof simulate>[2]) => simulate(model, table, pieces, model.stationSpeed, train);
const flatTile: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
const env: TrackEnv = { get: () => flatTile, rideId: 0, sandbox: false, mapSize: { x: 200, y: 200 } };
const STATION_Z = 7 * 16;
const need = speedForExcitement(7.5);

/**
 * « Custom Wooden Loop » (Haiku, 9 octobre 2026) : station de 6 tuiles en (30,61) vers +x au niveau 7, 2 droites, lift
 * seul (chute jamais posée), bounds (21,60)-(56,83). Lift de 12 : 11,5 niveaux, accepté sans avertissement.
 */
function start(lift: number, extra: Macro[] = []) {
    const station: Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
    const r = compileMacros(table, ride, { x: 30, y: 61, z: STATION_Z, rot: 2, slope: 0, bank: 0 }, [...station, { op: "straight", length: 2 }, { op: "lift", height: lift }, ...extra]);
    expect(r.errors).toEqual([]);
    return r;
}

describe("début qui finit au sommet du lift (Custom Wooden Loop, Haiku, 9 octobre 2026)", () => {
    it("endsAtLiftTop : lift seul oui, plat au sommet oui, chute finie non", () => {
        expect(endsAtLiftTop(table, start(12).pieces)).toBe(true);
        expect(endsAtLiftTop(table, start(12, [{ op: "straight", length: 1 }]).pieces)).toBe(true);
        expect(endsAtLiftTop(table, start(12, [{ op: "drop", height: 10, steep: true }]).pieces)).toBe(false);
        expect(endsAtLiftTop(table, start(12).pieces.slice(0, 6))).toBe(false);
    });

    it("liftTopSpeed : un lift de 10 est trop bas pour 7,5 ; celui de Haiku (12) passe de justesse avec une chute idéale", () => {
        const low = liftTopSpeed(table, ride, start(10).pieces, sim, STATION_Z)!;
        expect(low.kmh).toBeLessThan(need);
        const high = liftTopSpeed(table, ride, start(12).pieces, sim, STATION_Z)!;
        expect(high.kmh).toBeGreaterThanOrEqual(need);
        // Un sol plus bas (lac, vallée) permet une chute plus profonde, donc plus rapide.
        expect(liftTopSpeed(table, ride, start(10).pieces, sim, STATION_Z - 4 * 16)!.kmh).toBeGreaterThan(low.kmh);
        // Chute déjà posée : rien à juger ici (firstDropSpeed s'en charge).
        expect(liftTopSpeed(table, ride, start(12, [{ op: "drop", height: 10, steep: true }]).pieces, sim, STATION_Z)).toBeNull();
    });

    it("firstDropVocabulary : chutes de la plus haute à 2 niveaux, droites et en diagonale", () => {
        const v = firstDropVocabulary(12);
        expect(v[0]).toEqual([{ op: "drop", height: 12, steep: true }]);
        expect(v.every((m) => m.some((x) => x.op === "drop"))).toBe(true);
        expect(v.some((m) => m[0].op === "turn")).toBe(true);
    });

    function search(lift: number, x2: number, timeMs = 30_000, y2 = 83) {
        const r = start(lift);
        const occ = new Occupancy(rideClearance(WOODEN));
        for (const p of r.pieces) occ.add(pieceElements(p, table.require(p.type)));
        return searchSection({
            table,
            ride,
            prefix: r.pieces,
            start: r.end,
            goal: beginPose(r.pieces[0], table.require(r.pieces[0].type)),
            occupancy: occ,
            env,
            bounds: { x1: 21, y1: 60, x2, y2 },
            closureCatalog: searchCatalog(table, ride, { steep: true, diagonals: true }),
            speedOf: (pieces, v) => simulate(model, table, pieces, v, train),
            simulateCircuit: sim,
            judge: () => [],
            vStart: sim(r.pieces).at(-1)!.vOut,
            minTiles: 90,
            maxTiles: 200,
            zMin: 48,
            vocabulary: defaultVocabulary(),
            beamWidth: 60,
            maxDepth: 20,
            timeMs,
            results: 2,
            firstDrop: { minKmh: need, speed: (all) => firstDropSpeed(table, ride, all, sim)?.kmh ?? null },
        });
    }

    it("lift de 12 de Haiku, sommet à 6 tuiles du bord : la chute raide qui tourne de 90° vers l'intérieur passe", () => {
        // Avant drop { turn }, la recherche concluait PREMIÈRE CHUTE IMPOSSIBLE : seule une chute droite ou en diagonale
        // était essayée. Le virage d'1 tuile à 60° tourne vers +y, où bounds laisse la place.
        const r = start(12);
        const res = search(12, 56);
        expect(res.candidates.length).toBeGreaterThan(0);
        for (const c of res.candidates) {
            expect(c.macros[0]).toMatchObject({ op: "drop", turn: "left" });
            expect(firstDropSpeed(table, ride, [...r.pieces, ...c.pieces, ...c.closure], sim)!.kmh).toBeGreaterThanOrEqual(need);
        }
    }, 60_000);

    it("lift de 15 collé au bord de bounds, sans place pour tourner : aucune chute assez rapide ne tient, la recherche le dit tout de suite", () => {
        const res = search(15, 56, 30_000, 63);
        expect(res.candidates).toEqual([]);
        expect(res.firstDropKmh).toBeLessThan(need);
        expect(res.rejected["première chute trop lente"]).toBeGreaterThan(0);
        expect(res.elapsedMs).toBeLessThan(5_000);
    });

    it("avec la place : chaque variante commence par une première chute assez rapide", () => {
        const r = start(15);
        const res = search(15, 76, 60_000);
        expect(res.candidates.length).toBeGreaterThan(0);
        for (const c of res.candidates) {
            expect(c.macros.slice(0, 3).some((m) => m.op === "drop")).toBe(true);
            expect(firstDropSpeed(table, ride, [...r.pieces, ...c.pieces, ...c.closure], sim)!.kmh).toBeGreaterThanOrEqual(need);
        }
    }, 90_000);
});
