import { describe, expect, it } from "vitest";
import type { PieceSample, TrackPieceInfo } from "@openrct2-claude/protocol";
import { DEFAULT_MODEL, mphToKmh, simulate, SpeedModels, type MeasuredPiece } from "../src/planners/speed.js";
import { STALL_STEPS, blockBrakeRestartWarnings, findStall, lapCompleted, reachedCount } from "../src/planners/stall.js";
import { SegmentTable, compileMacros, rideTrackInfo, type TrackPose } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const typeOf = (name: string) => table.byName(name)!.type;

const piece = (name: string, x: number, chain = false): TrackPieceInfo => ({ type: typeOf(name), x, y: 10, z: 7 * 16, direction: 2, chain });
const sample = (p: TrackPieceInfo, n: number, vFirst: number, vMin: number): PieceSample => ({
    x: p.x, y: p.y, z: p.z, direction: p.direction, trackType: p.type, n, vFirst, vMin, vMax: vFirst, gVertMax: 1, gVertMin: 1, gLatMax: 0,
});
const measure = (ps: TrackPieceInfo[], reached: [number, number, number][]): MeasuredPiece[] =>
    ps.map((p, i) => ({ piece: p, sample: reached[i] ? sample(p, reached[i][0], reached[i][1], reached[i][2]) : undefined }));

describe("train bloqué", () => {
    const ps = [piece("flat", 1), piece("up25", 2), piece("up25", 3), piece("flat", 4), piece("down25", 5)];

    it("situe le train sur la dernière pièce atteinte, avec la suivante", () => {
        const m = measure(ps, [[5, 20, 15], [8, 14, 10], [12, 9, 0]]);
        expect(reachedCount(m)).toBe(3);
        const s = findStall(m)!;
        expect(s.index).toBe(2);
        expect(s.piece).toBe("up25");
        expect(s.next).toBe("flat");
        expect(s.tile).toEqual({ x: 3, y: 10 });
        expect(s.minKmh).toBe(mphToKmh(0));
        expect(s.message).toContain("TRAIN BLOQUÉ");
        expect(s.message).toContain("élan insuffisant");
    });

    it("distingue le départ bloqué en station et la chaîne", () => {
        const st = [piece("endStation", 1), piece("flat", 2)];
        expect(findStall(measure(st, [[30, 0, 0]]))!.message).toContain("quitte pas la station");
        const lift = [piece("flat", 1), piece("up25", 2, true), piece("flat", 3)];
        expect(findStall(measure(lift, [[5, 10, 10], [9, 5, 0]]))!.message).toContain("chaîne");
    });

    it("ne dit rien quand rien n'a été relevé", () => {
        expect(findStall(measure(ps, []))).toBeUndefined();
    });

    it("tour fini malgré des pièces courtes sans relevé (Black Widow Max : 116/130, dernière pièce atteinte)", () => {
        const done = measure(ps, [[5, 20, 15], [8, 14, 10], undefined!, [3, 9, 8], [4, 12, 9]]);
        expect(reachedCount(done)).toBe(4);
        expect(lapCompleted(done)).toBe(true);
        expect(lapCompleted(measure(ps, [[5, 20, 15], [8, 14, 10], [12, 9, 0]]))).toBe(false);
        expect(lapCompleted(measure(ps, []))).toBe(false);
    });

    it("attend deux pas sans progrès", () => {
        expect(STALL_STEPS).toBe(2);
    });
});

describe("frein de bloc avant une montée", () => {
    const twister = rideTrackInfo(51)!;
    const start: TrackPose = { x: 40, y: 40, z: 14 * 16, rot: 2, slope: 0, bank: 0 };
    const warn = (plan: Parameters<typeof compileMacros>[3]) => {
        const pieces = compileMacros(table, twister, start, plan).pieces;
        return blockBrakeRestartWarnings(pieces, (slice, v, startPiece) => simulate(DEFAULT_MODEL, table, slice, v, undefined, { startPiece }));
    };

    it("signale une colline juste après le frein de bloc (relâché à ~7 km/h)", () => {
        const w = warn([{ op: "straight", length: 2 }, { op: "block_brakes" }, { op: "straight", length: 1 }, { op: "hill", height: 6 }]);
        expect(w).toHaveLength(1);
        expect(w[0]).toContain("FREIN DE BLOC AVANT UNE MONTÉE");
    });

    it("ne dit rien quand le frein de bloc est suivi d'une descente ou d'un plat", () => {
        expect(warn([{ op: "straight", length: 2 }, { op: "block_brakes" }, { op: "straight", length: 3 }])).toEqual([]);
        expect(warn([{ op: "straight", length: 2 }, { op: "block_brakes" }, { op: "drop", height: 4 }])).toEqual([]);
    });
});

describe("frein de bloc au sommet d'une colline (Triple Widow, 2026-10-08)", () => {
    // Simulateur exact, train de 12 voitures (5,4 tuiles) comme Triple Widow : la queue reste dans la montée.
    const twister = rideTrackInfo(51)!;
    const exactModel = new SpeedModels(null).get(51);
    const train = { cars: 12, carLength: 0.45, mass: 4425 };
    const start: TrackPose = { x: 40, y: 40, z: 7 * 16, rot: 2, slope: 0, bank: 0 };
    const warn = (plan: Parameters<typeof compileMacros>[3]) => {
        const c = compileMacros(table, twister, start, plan);
        expect(c.errors).toEqual([]);
        return blockBrakeRestartWarnings(c.pieces, (slice, v, startPiece) => simulate(exactModel, table, slice, v, train, { startPiece }));
    };

    it("signale climb puis block_brakes puis drop : relâché à 7 km/h, la queue dans la montée le fait reculer", () => {
        for (const steep of [true, false]) {
            const w = warn([{ op: "straight", length: 2 }, { op: "climb", height: 8, steep }, { op: "block_brakes" }, { op: "drop", height: 8, steep }]);
            expect(w, `steep ${steep}`).toHaveLength(1);
            expect(w[0]).toContain("FREIN DE BLOC AU SOMMET D'UNE MONTÉE");
        }
    });

    it("ne dit rien quand le train attend sur un plat aussi long que lui (brakes puis block_brakes)", () => {
        expect(warn([{ op: "straight", length: 2 }, { op: "climb", height: 8, steep: true }, { op: "brakes", length: 5 }, { op: "block_brakes" }, { op: "drop", height: 8, steep: true }])).toEqual([]);
        expect(warn([{ op: "straight", length: 7 }, { op: "block_brakes" }, { op: "drop", height: 6 }])).toEqual([]);
    });

    it("garde l'avertissement d'une colline après le frein", () => {
        const w = warn([{ op: "straight", length: 7 }, { op: "block_brakes" }, { op: "straight", length: 1 }, { op: "hill", height: 6 }]);
        expect(w).toHaveLength(1);
        expect(w[0]).toContain("FREIN DE BLOC AVANT UNE MONTÉE");
    });
});
