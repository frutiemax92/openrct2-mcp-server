import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, fitModel, mphToKmh, simulate, speedWindows, windowFor, type MeasuredPiece } from "../src/planners/speed.js";
import { designLayout, parseTrackDesign } from "../src/planners/td6.js";
import { SegmentTable, compileMacros, rideTrackInfo, type TrackPose } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const twister = rideTrackInfo(51)!;
const FRIGHTMARE = "/home/lucas/snap/steam/common/.local/share/Steam/steamapps/common/Rollercoaster Tycoon 2/Tracks/Frightmare.TD6";
const start: TrackPose = { x: 40, y: 40, z: 14 * 16, rot: 2, slope: 0, bank: 0 };

describe("modèle de vitesse", () => {
    it.skipIf(!existsSync(FRIGHTMARE))("reproduit Frightmare : ~101 km/h au bas de la chute, aucun calage", () => {
        const l = designLayout(parseTrackDesign(readFileSync(FRIGHTMARE), "Frightmare.TD6"), table, { x: 0, y: 0, z: 0 }, 0);
        const sim = simulate(DEFAULT_MODEL, table, l.pieces, DEFAULT_MODEL.stationSpeed);
        expect(sim.some((s) => s.stall)).toBe(false);
        const max = Math.max(...sim.map((s) => mphToKmh(s.vOut)));
        expect(max).toBeGreaterThan(90);
        expect(max).toBeLessThan(112);
    });

    it("la chaîne tient la vitesse du lift ; une boucle sans élan cale", () => {
        const lift = compileMacros(table, twister, start, [{ op: "lift", height: 10 }]);
        const sim = simulate(DEFAULT_MODEL, table, lift.pieces, 0);
        expect(sim.every((s) => !s.stall)).toBe(true);
        expect(sim[sim.length - 1].vOut).toBeGreaterThanOrEqual(DEFAULT_MODEL.liftSpeed - 1);
        const loop = compileMacros(table, twister, start, [{ op: "inversion", kind: "loop", dir: "left" }]);
        expect(simulate(DEFAULT_MODEL, table, loop.pieces, 10).some((s) => s.stall)).toBe(true);
    });

    it("signale un zero-g roll pris à pleine vitesse au pied de la chute", () => {
        const r = compileMacros(table, twister, start, [
            { op: "lift", height: 18, steep: false },
            { op: "drop", height: 24, steep: true },
            { op: "inversion", kind: "zero_g_roll", dir: "right", size: "small" },
        ]);
        const sim = simulate(DEFAULT_MODEL, table, r.pieces, DEFAULT_MODEL.stationSpeed);
        const i = r.pieces.findIndex((p) => p.name === "rightZeroGRollUp");
        const w = windowFor(new Map([["barrelRollUpToDown", { kind: "barrelRollUpToDown", p10: 25, p50: 33, p90: 39, n: 13 }]]), "zeroGRollUp");
        expect(w).toBeDefined();
        expect(sim[i].vIn).toBeGreaterThan(w!.p90 * 1.15 + 3);
        expect(r.pieces[i].macro).toBe(2);
    });

    it("retrouve K, k1, k2 à partir de mesures", () => {
        const truth = { ...DEFAULT_MODEL, K: 190, k1: 0.2, k2: 0.002 };
        const r = compileMacros(table, twister, start, [
            { op: "lift", height: 20, steep: false },
            { op: "drop", height: 18, steep: true },
            { op: "climb", height: 8 },
            { op: "turn", dir: "left", banked: true, quarters: 2 },
            { op: "drop", height: 6 },
            { op: "helix", dir: "right", quarters: 4 },
            { op: "straight", length: 6 },
            { op: "climb", height: 4 },
            { op: "drop", height: 6 },
        ]);
        const sim = simulate(truth, table, r.pieces, truth.stationSpeed);
        const measured: MeasuredPiece[] = r.pieces.map((p, i) => ({
            piece: p,
            sample: { x: p.x * 32, y: p.y * 32, z: p.z, direction: p.direction, trackType: p.type, n: 3, vFirst: sim[i].vIn, vMin: sim[i].vMin, vMax: sim[i].vOut, gVertMax: 1, gVertMin: 1, gLatMax: 0 },
        }));
        const fitted = fitModel(table, measured, { ...DEFAULT_MODEL, samples: 0 });
        expect(fitted.samples).toBeGreaterThan(12);
        expect(Math.abs(fitted.K - truth.K) / truth.K).toBeLessThan(0.1);
    });

    it("tire des fenêtres d'entrée des circuits de référence", () => {
        const r = compileMacros(table, twister, start, [{ op: "lift", height: 18 }, { op: "drop", height: 16, steep: true }, { op: "inversion", kind: "loop", dir: "left", size: "small" }]);
        // Moins de 5 occurrences : pas de fenêtre (non significative).
        expect(speedWindows(DEFAULT_MODEL, table, Array(4).fill(r.pieces)).get("verticalLoop")).toBeUndefined();
        expect(speedWindows(DEFAULT_MODEL, table, Array(5).fill(r.pieces)).get("verticalLoop")?.n).toBe(5);
    });
});
