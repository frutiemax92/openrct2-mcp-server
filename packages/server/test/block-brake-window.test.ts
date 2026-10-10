import { describe, expect, it } from "vitest";
import { BLOCK_MIN_KMH, blockBrakeWindow, blockBrakeWindowLine } from "../src/planners/estimate.js";
import { BLOCK_MAX_KMH } from "../src/planners/search.js";
import { DEFAULT_MODEL, designTrain, simulate } from "../src/planners/speed.js";
import { SegmentTable, beginPose, compileMacros, rideTrackInfo, type Macro } from "../src/planners/track.js";
import { fastBlockBrakes } from "../src/planners/search.js";

const table = SegmentTable.fromFile() as SegmentTable;
const WOODEN = (() => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") return t;
    throw new Error("wooden_roller_coaster");
})();
const ride = rideTrackInfo(WOODEN)!;
const model = { ...DEFAULT_MODEL, rideType: WOODEN } as typeof DEFAULT_MODEL;
// Custom Wooden (Haiku, 9 octobre 2026) : MFT, 12 voitures, station de 6 tuiles au niveau 7.
const train = designTrain({ vehicleObject: "rct2.ride.mft", carsPerTrain: 12, rideType: WOODEN });
const station: Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
const sim = (pieces: Parameters<typeof simulate>[2]) => simulate(model, table, pieces, model.stationSpeed, train);
const start = (macros: Macro[]) => {
    const r = compileMacros(table, ride, { x: 30, y: 60, z: 7 * 16, rot: 2, slope: 0, bank: 0 }, [...station, ...macros]);
    expect(r.errors).toEqual([]);
    return r.pieces;
};

describe("hauteur du frein de bloc de mi-parcours (Custom Wooden, Haiku, 9 octobre 2026)", () => {
    // Lift de 25 niveaux, chute raide jusqu'au niveau de la station : ~90 km/h au ras du sol.
    const fast = start([{ op: "straight", length: 2 }, { op: "lift", height: 25 }, { op: "drop", height: 25, steep: true }, { op: "straight", length: 3 }]);

    it("au sol à ~90 km/h : une montée, pas des freins", () => {
        const w = blockBrakeWindow(table, ride, fast, sim, BLOCK_MAX_KMH)!;
        expect(w.fromKmh).toBeGreaterThan(80);
        expect(w.level).toBe(7);
        expect(w.minClimb).toBeGreaterThan(5);
        expect(w.maxClimb).toBeGreaterThan(w.minClimb!);
        // Le sommet le plus haut reste sous le sommet du lift (frottement).
        expect(w.maxClimb).toBeLessThan(25);
        expect(w.minClimbKmh).toBeLessThanOrEqual(BLOCK_MAX_KMH);
        expect(w.maxClimbKmh).toBeGreaterThanOrEqual(BLOCK_MIN_KMH);
        const line = blockBrakeWindowLine(w, BLOCK_MAX_KMH);
        process.stdout.write(`${line}\n`);
        expect(line).toMatch(/monte sur l'élan de \d+ à \d+ niveaux/);
        // Vérification : la montée conseillée donne bien la vitesse annoncée.
        const c = compileMacros(table, ride, { x: 0, y: 0, z: 0, rot: 0, slope: 0, bank: 0 }, []);
        expect(c.errors).toEqual([]);
        const check = (h: number) => {
            const p = start([{ op: "straight", length: 2 }, { op: "lift", height: 25 }, { op: "drop", height: 25, steep: true }, { op: "straight", length: 3 }, { op: "climb", height: h }, { op: "block_brakes" }]);
            const s = sim(p);
            return Math.round(s[s.length - 1].vIn * 1.609);
        };
        expect(check(w.minClimb!)).toBeLessThanOrEqual(BLOCK_MAX_KMH);
        expect(check(w.minClimb! - 1)).toBeGreaterThan(BLOCK_MAX_KMH);
    });

    it("déjà lent (sommet d'une montée sur l'élan) : dès ici", () => {
        const w0 = blockBrakeWindow(table, ride, fast, sim, BLOCK_MAX_KMH)!;
        const top = start([{ op: "straight", length: 2 }, { op: "lift", height: 25 }, { op: "drop", height: 25, steep: true }, { op: "straight", length: 3 }, { op: "climb", height: w0.minClimb! + 1 }]);
        const w = blockBrakeWindow(table, ride, top, sim, BLOCK_MAX_KMH)!;
        expect(w.fromKmh).toBeLessThanOrEqual(BLOCK_MAX_KMH);
        expect(w.minClimb).toBe(0);
    });

    it("sommet du lift (vitesse de la chaîne) : trop lent, aucune fenêtre", () => {
        const w = blockBrakeWindow(table, ride, start([{ op: "straight", length: 2 }, { op: "lift", height: 10 }]), sim, BLOCK_MAX_KMH)!;
        expect(w.minClimb).toBeNull();
    });
});

describe("freins au sol avant le frein de bloc (Custom Wooden, Haiku, 9 octobre 2026)", () => {
    const head: Macro[] = [{ op: "straight", length: 2 }, { op: "lift", height: 25 }, { op: "drop", height: 25, steep: true }, { op: "straight", length: 3 }];
    const judge = (macros: Macro[]) => {
        const p = start([...head, ...macros]);
        return fastBlockBrakes(p, sim(p), 6, table, beginPose(p[0], table.require(p[0].type)));
    };

    it("3 brakes puis block_brakes au niveau de la station, loin d'elle : refusé, avec la hauteur conseillée", () => {
        const r = judge([{ op: "brakes", length: 3 }, { op: "block_brakes" }]);
        expect(r.length).toBe(1);
        expect(r[0].message).toMatch(/FREINS AVANT LE FREIN DE BLOC|FREIN DE BLOC LANCÉ/);
        expect(r[0].approach).toBeGreaterThan(6);
    });

    it("montée sur l'élan puis block_brakes et chute : accepté", () => {
        const p0 = start(head);
        const w = blockBrakeWindow(table, ride, p0, sim, BLOCK_MAX_KMH)!;
        expect(judge([{ op: "climb", height: w.minClimb! + 1 }, { op: "brakes", length: 2 }, { op: "block_brakes" }, { op: "drop", height: 4 }])).toEqual([]);
    });
});
