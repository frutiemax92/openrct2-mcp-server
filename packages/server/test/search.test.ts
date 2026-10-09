import type { RegionTile } from "@openrct2-claude/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultVocabulary, searchSection } from "../src/planners/search.js";
import { blackWidowPlus } from "./black-widow-plus.js";
import { blockBrakeRestartWarnings } from "../src/planners/stall.js";
import { DEFAULT_MODEL, simulate } from "../src/planners/speed.js";
import {
    Occupancy,
    SegmentTable,
    beginPose,
    blockBoundaries,
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
    // Les recherches bloquent la boucle d'événements : rendre la main entre deux tests laisse vitest traiter ses réponses
    // RPC, sinon les blocages s'additionnent et onTaskUpdate expire (60 s).
    beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
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
    it("nomme la tuile qui bloque l'arrivée en gare imposée par les trains (Black Widow XXL, 8 octobre 2026)", () => {
        const s = venomStart();
        const model = { ...DEFAULT_MODEL };
        const res = searchSection({
            table,
            ride: wooden,
            prefix: s.pieces,
            start: s.end,
            goal: s.goal,
            occupancy: s.occ,
            env,
            bounds: { x1: 53, y1: 41, x2: 71, y2: 56 },
            closureCatalog: searchCatalog(table, wooden, { steep: true }),
            speedOf: (pieces, v) => simulate(model, table, pieces, v),
            simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
            judge: () => [],
            vStart: 0,
            minTiles: 130,
            maxTiles: 200,
            minTrains: 2,
            vocabulary: defaultVocabulary(),
            beamWidth: 4,
            maxDepth: 2,
            timeMs: 2000,
            results: 1,
        });
        expect(res.expansions).toBe(0);
        expect(res.approachBrakes).toBe(2);
        expect(res.approachBlocked).toMatch(/^\(7[2-9],51\) niveau [\d.]+ : hors de bounds \(53,41\)-\(71,56\)$/);
    });
    it("pose le frein de bloc de mi-parcours qu'exigent 3 trains (Black Widow XL de Haiku, 8 octobre 2026)", () => {
        // Station + lift + frein d'arrivée = 3 sections, 2 trains : sans frein de bloc dans le vocabulaire, toutes les
        // fermetures étaient écartées (« trop peu de sections »), sans que l'outil dise pourquoi.
        const s = venomStart();
        const model = { ...DEFAULT_MODEL };
        const simulateFrom = (pieces: Parameters<typeof simulate>[2], v: number, startPiece: number) => simulate(model, table, pieces, v, undefined, { startPiece });
        const res = searchSection({
            table,
            ride: wooden,
            prefix: s.pieces,
            start: s.end,
            goal: s.goal,
            occupancy: s.occ,
            env,
            bounds: { x1: 53, y1: 41, x2: 78, y2: 56 },
            closureCatalog: searchCatalog(table, wooden, { steep: true }),
            speedOf: (pieces, v) => simulate(model, table, pieces, v),
            simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
            simulateFrom,
            judge: () => [],
            vStart: simulate(model, table, s.pieces, model.stationSpeed).at(-1)!.vOut,
            minTiles: 130,
            maxTiles: 200,
            minTrains: 3,
            vocabulary: defaultVocabulary(),
            beamWidth: 40,
            maxDepth: 16,
            timeMs: 30_000,
            results: 3,
        });
        expect(res.midBlocks).toBe(1);
        expect(res.candidates.length).toBeGreaterThan(0);
        const best = res.candidates[0];
        const all = [...s.pieces, ...best.pieces, ...best.closure];
        expect(best.layout.blocks.maxTrains).toBe(3);
        // Frein de bloc de mi-parcours : dans la section cherchée, suivi d'une descente, et le train en repart.
        const mid = blockBoundaries(all).filter((m) => m.kind === "block" && m.index >= s.pieces.length && m.index < s.pieces.length + best.pieces.length);
        expect(mid).toHaveLength(1);
        expect(table.require(all[mid[0].index + 1].type).endZ).toBeLessThan(table.require(all[mid[0].index + 1].type).beginZ);
        expect(blockBrakeRestartWarnings(all, simulateFrom)).toEqual([]);
        expect(res.rejected["trop peu de sections de bloc"]).toBeUndefined();
    }, 60_000);
    it("minSteep : la seconde moitié plonge et remonte à 60° comme Black Widow (Black Widow XXL de Haiku, 8 octobre 2026)", () => {
        // Station + lift + frein d'arrivée = 3 sections, 2 trains : sans frein de bloc dans le vocabulaire, toutes les
        // fermetures étaient écartées (« trop peu de sections »), sans que l'outil dise pourquoi.
        const s = venomStart();
        const model = { ...DEFAULT_MODEL };
        const simulateFrom = (pieces: Parameters<typeof simulate>[2], v: number, startPiece: number) => simulate(model, table, pieces, v, undefined, { startPiece });
        const res = searchSection({
            table,
            ride: wooden,
            prefix: s.pieces,
            start: s.end,
            goal: s.goal,
            occupancy: s.occ,
            env,
            bounds: { x1: 53, y1: 41, x2: 78, y2: 56 },
            closureCatalog: searchCatalog(table, wooden, { steep: true }),
            speedOf: (pieces, v) => simulate(model, table, pieces, v),
            simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
            simulateFrom,
            judge: () => [],
            vStart: simulate(model, table, s.pieces, model.stationSpeed).at(-1)!.vOut,
            minTiles: 130,
            maxTiles: 200,
            minTrains: 3,
            minSteep: 11,
            vocabulary: defaultVocabulary(),
            beamWidth: 40,
            maxDepth: 16,
            timeMs: 30_000,
            results: 3,
        });
        const steep = (pieces: { type: number }[]) => pieces.filter((p) => /60|90/.test(SegmentTable.nameOf(p.type))).length;
        expect(res.candidates.length).toBeGreaterThan(0);
        const best = res.candidates[0];
        expect(steep([...s.pieces, ...best.pieces, ...best.closure])).toBeGreaterThanOrEqual(11);
    }, 60_000);
    it("élargit le faisceau tant qu'il manque des variantes et qu'il reste du temps", () => {
        // Une passe à 8 s'arrête à maxDepth sans variante (une plus large ferme) ; timeMs n'y changeait rien. Depuis le
        // contrôle de repartie des freins de bloc dans le faisceau, 25 ferme dès la première passe.
        const res = blackWidowPlus(8, 1);
        expect(res.passes).toBeGreaterThanOrEqual(2);
        expect(res.candidates.length).toBe(1);
    }, 120_000);
});
