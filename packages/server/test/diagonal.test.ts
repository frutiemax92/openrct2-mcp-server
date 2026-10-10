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
    planClosure,
    rideClearance,
    rideTrackInfo,
    searchCatalog,
    type Macro,
    type TrackEnv,
} from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const typeOf = (name: string) => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === name) return t;
    throw new Error(name);
};
const WOODEN = typeOf("wooden_roller_coaster");
const wooden = rideTrackInfo(WOODEN)!;
const flatTile: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
const env: TrackEnv = { get: () => flatTile, rideId: 0, sandbox: false, mapSize: { x: 200, y: 200 } };
const start = { x: 70, y: 51, z: 160, rot: 0, slope: 0, bank: 0 };
const eighth = (dir: "left" | "right"): Macro => ({ op: "turn", dir, size: "large", eighths: 1, banked: true });
const diagPieces = (names: string[]) => names.filter((n) => n.startsWith("diag"));

describe("diagonales", () => {
    it("colline en diagonale : huitième, colline diag*, huitième ; même sortie qu'un virage large", () => {
        const r = compileMacros(table, wooden, start, [eighth("right"), { op: "hill", height: 4 }, eighth("right")]);
        expect(r.errors).toEqual([]);
        const names = r.pieces.map((p) => p.name);
        if (process.env.DIAG_DEBUG) console.log(names, r.end);
        expect(diagPieces(names).length).toBeGreaterThanOrEqual(4);
        expect(names.some((n) => /^diag.*Up25/.test(n))).toBe(true);
        expect(names.some((n) => /^diag.*Down25/.test(n))).toBe(true);
        expect(r.end.rot & 4).toBe(0);
        expect(r.end.z).toBe(start.z);
        // Sans colline, la même paire de huitièmes est le virage large d'un quart de tour.
        const turn = compileMacros(table, wooden, start, [{ op: "turn", dir: "right", size: "large", banked: true }]);
        const eighths = (list: string[]) => list.filter((n) => n.includes("Eighth"));
        expect(eighths(turn.pieces.map((p) => p.name))).toEqual(eighths(names));
        expect(r.end.rot).toBe(turn.end.rot);
    });

    it("chute raide, freins et frein de bloc en diagonale", () => {
        // 10 niveaux : en bois, la diagonale raide passe par 25° aux deux bouts (diagDown60ToFlat n'est pas dessiné, SPEC F37).
        const r = compileMacros(table, wooden, { ...start, z: 400 }, [eighth("left"), { op: "drop", height: 10, steep: true }, { op: "brakes", length: 1 }, { op: "block_brakes" }, eighth("left")]);
        expect(r.errors).toEqual([]);
        const names = r.pieces.map((p) => p.name);
        expect(names).toContain("diagDown60");
        expect(names).toContain("diagBrakes");
        expect(names).toContain("diagBlockBrakes");
        expect(names).not.toContain("diagDown60ToFlat");
        expect(r.end.z).toBe(400 - 10 * 16);
    });

    it("refuse une hélice ou un virage medium en diagonale, avec la marche à suivre", () => {
        const helix = compileMacros(table, wooden, start, [eighth("left"), { op: "helix", dir: "left", quarters: 2 }]);
        expect(helix.errors[0]?.message).toMatch(/diagonale/);
        const turn = compileMacros(table, wooden, start, [eighth("left"), { op: "turn", dir: "left" }]);
        expect(turn.errors[0]?.message).toMatch(/eighths: 1/);
    });

    it("la fermeture A* passe par la diagonale pour rejoindre une pose diagonale", () => {
        const goalRun = compileMacros(table, wooden, start, [eighth("right"), { op: "straight", length: 3 }]);
        const occ = new Occupancy(rideClearance(WOODEN));
        const goal = goalRun.end;
        const res = planClosure(searchCatalog(table, wooden, { steep: true, diagonals: true }), { ...start, x: 60 }, goal, occ, env);
        expect(res).not.toBeNull();
        expect(diagPieces(res!.pieces.map((p) => p.name)).length).toBeGreaterThan(0);
    });

    it("le vocabulaire de recherche propose des collines en diagonale, et la recherche les pose", () => {
        const vocab = defaultVocabulary();
        expect(vocab.some((m) => m.length === 3 && m[1].op === "hill" && m[0].op === "turn" && m[0].eighths === 1)).toBe(true);
        // Un début simple : station, lift, première chute ; la recherche ne garde que des éléments diagonaux.
        const station: Macro[] = ["beginStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
        const first = compileMacros(table, wooden, start, [...station, { op: "straight", length: 2 }, { op: "lift", height: 14, steep: false }, { op: "drop", height: 12, steep: true }]);
        expect(first.errors).toEqual([]);
        const occ = new Occupancy(rideClearance(WOODEN));
        for (const p of first.pieces) occ.add(pieceElements(p, table.require(p.type)));
        const model = { ...DEFAULT_MODEL };
        const onlyDiag = vocab.filter((m) => m.length === 3 && m[0].op === "turn" && m[0].eighths === 1);
        const res = searchSection({
            table,
            ride: wooden,
            prefix: first.pieces,
            start: first.end,
            goal: beginPose(first.pieces[0], table.require(first.pieces[0].type)),
            occupancy: occ,
            env,
            closureCatalog: searchCatalog(table, wooden, { steep: true, diagonals: true }),
            speedOf: (pieces, v) => simulate(model, table, pieces, v),
            simulateCircuit: (pieces) => simulate(model, table, pieces, model.stationSpeed),
            judge: () => [],
            vStart: simulate(model, table, first.pieces, model.stationSpeed).at(-1)!.vOut,
            minTiles: 90,
            maxTiles: 160,
            minTrains: 1,
            vocabulary: [...onlyDiag, [{ op: "straight", length: 1 }]],
            beamWidth: 10,
            maxDepth: 8,
            timeMs: 20_000,
            results: 1,
        });
        if (process.env.DIAG_DEBUG) console.log(res.rejected, res.candidates[0]?.macros);
        expect(res.candidates.length).toBeGreaterThan(0);
        expect(diagPieces([...res.candidates[0].pieces, ...res.candidates[0].closure].map((p) => p.name)).length).toBeGreaterThan(0);
    }, 60_000);
});
