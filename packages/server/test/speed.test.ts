import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAUNCH_K, DEFAULT_MODEL, fitModel, mphToKmh, ridePower, simulate, speedWindows, windowFor, type MeasuredPiece } from "../src/planners/speed.js";
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

    describe("pièces motorisées", () => {
        const powered = { ...DEFAULT_MODEL, power: ridePower(51) };
        const train = { cars: 7, carLength: 0.45, mass: 4425 };
        const launch = compileMacros(table, twister, start, [{ op: "launch", height: 8 }, { op: "loop", dir: "right" }]);

        it("launch compile en flatToUp25, poweredLift et up25ToFlat", () => {
            expect(launch.errors).toEqual([]);
            const names = launch.pieces.map((p) => p.name);
            expect(names.slice(0, 9)).toEqual(["flatToUp25", ...Array(7).fill("poweredLift"), "up25ToFlat"]);
            expect(compileMacros(table, rideTrackInfo(52)!, start, [{ op: "launch", height: 8 }]).errors.length).toBeGreaterThan(0);
        });

        it("le poweredLift propulse le train (Lunar Launcher : 21 → ~63 km/h sur 7 pièces), sans calage", () => {
            const sim = simulate(powered, table, launch.pieces, 13, train);
            expect(sim.some((s) => s.stall)).toBe(false);
            const top = mphToKmh(sim[8].vIn);
            expect(top).toBeGreaterThan(55);
            expect(top).toBeLessThan(72);
            // Sans la poussée du type, la même montée cale.
            expect(simulate(DEFAULT_MODEL, table, launch.pieces, 13, train).some((s) => s.stall)).toBe(true);
        });

        it("le booster accélère jusqu'à sa vitesse cible, pas au-delà", () => {
            const b = compileMacros(table, twister, start, [{ op: "booster", length: 8, speed: 10 }]);
            expect(b.errors).toEqual([]);
            const sim = simulate(powered, table, b.pieces, 5);
            const out = sim[sim.length - 1].vOut;
            // Consigne 10 → 22,5 mph (× BoosterSpeedFactor 2 / 2).
            expect(out).toBeGreaterThan(15);
            expect(out).toBeLessThanOrEqual(22.6);
            expect(simulate(powered, table, b.pieces, 40)[0].vOut).toBeLessThan(40);
        });

        it("retrouve launchK sur la propulsion seule", () => {
            const truth = { ...powered, launchK: 520 };
            const r = compileMacros(table, twister, start, [{ op: "launch", height: 8 }, { op: "loop", dir: "right" }, { op: "drop", height: 6 }, { op: "turn", dir: "left", banked: true, quarters: 2 }, { op: "hill", height: 3 }, { op: "straight", length: 4 }]);
            const sim = simulate(truth, table, r.pieces, 13, train);
            const measured: MeasuredPiece[] = r.pieces.map((p, i) => ({
                piece: p,
                sample: { x: p.x * 32, y: p.y * 32, z: p.z, direction: p.direction, trackType: p.type, n: 3, vFirst: sim[i].vIn, vMin: sim[i].vMin, vMax: sim[i].vOut, gVertMax: 1, gVertMin: 1, gLatMax: 0 },
            }));
            // fitModel simule depuis la station (stationSpeed) : on part de 13 mph comme la mesure.
            const fitted = fitModel(table, measured, { ...powered, stationSpeed: 13, launchK: DEFAULT_LAUNCH_K, samples: 0 }, train);
            expect(Math.abs((fitted.launchK ?? 0) - 520)).toBeLessThanOrEqual(30);
        });
    });
});
