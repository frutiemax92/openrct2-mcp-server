import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firstDropSpeed, liftForSpeed, speedForExcitement } from "../src/planners/estimate.js";
import { DEFAULT_MODEL, designTrain, simulate } from "../src/planners/speed.js";
import { designDirs, loadLibrary } from "../src/planners/td6.js";
import { SegmentTable, compileMacros, rideTrackInfo, type Macro } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const WOODEN = (() => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") return t;
    throw new Error("wooden_roller_coaster");
})();
const ride = rideTrackInfo(WOODEN)!;
const model = { ...DEFAULT_MODEL, rideType: WOODEN } as typeof DEFAULT_MODEL;
// Black Widow Trinity Wood (Haiku, 9 octobre 2026) : MFT, 12 voitures, station de 6 tuiles au niveau 7.
const train = designTrain({ vehicleObject: "rct2.ride.mft", carsPerTrain: 12, rideType: WOODEN });
const station: Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
const sim = (pieces: Parameters<typeof simulate>[2]) => simulate(model, table, pieces, model.stationSpeed, train);
const start = (macros: Macro[]) => {
    const r = compileMacros(table, ride, { x: 30, y: 60, z: 7 * 16, rot: 2, slope: 0, bank: 0 }, [...station, ...macros]);
    expect(r.errors).toEqual([]);
    return r.pieces;
};

describe("vitesse qu'exige l'excitation (Black Widow Trinity Wood, Haiku, 9 octobre 2026)", () => {
    const need = speedForExcitement(7.5);

    it("7,5 demande ~70 km/h au bas de la première chute", () => {
        expect(need).toBe(70);
        expect(speedForExcitement(7)).toBe(60);
    });

    it("début de Haiku (lift 13, virage, chute de 10) : trop lent ; premier essai (lift 17, chute 18) : assez rapide", () => {
        const low = start([{ op: "straight", length: 2 }, { op: "lift", height: 13 }, { op: "turn", dir: "left", size: "small" }, { op: "drop", height: 10, steep: true }]);
        expect(firstDropSpeed(table, ride, low, sim)!.kmh).toBeLessThan(need);
        const high = start([{ op: "straight", length: 2 }, { op: "lift", height: 17 }, { op: "turn", dir: "left", size: "small" }, { op: "drop", height: 18, steep: true }]);
        expect(firstDropSpeed(table, ride, high, sim)!.kmh).toBeGreaterThanOrEqual(need);
    });

    it("chute pas finie (plan arrêté en pente) : pas encore jugée", () => {
        const open = start([{ op: "straight", length: 2 }, { op: "lift", height: 13 }, { op: "piece", name: "flatToDown25" }, { op: "piece", name: "down25" }]);
        expect(firstDropSpeed(table, ride, open, sim)).toBeNull();
    });

    it("liftForSpeed : la plus petite hauteur qui donne la vitesse", () => {
        const stations = start([]);
        const h = liftForSpeed(table, ride, stations, sim, need)!;
        expect(h).toBeGreaterThan(10);
        expect(h).toBeLessThan(20);
        const peak = (n: number) => {
            const p = start([{ op: "straight", length: 2 }, { op: "lift", height: n }, { op: "drop", height: n, steep: true }]);
            return firstDropSpeed(table, ride, p, sim)!.kmh;
        };
        expect(peak(h)).toBeGreaterThanOrEqual(need);
        expect(peak(h - 1)).toBeLessThan(need);
    });

    const dirs = designDirs(process.env.OPENRCT2_USER_DIR ?? join(homedir(), ".config", "OpenRCT2"));
    it.skipIf(!dirs.some((d) => existsSync(d)))("designs RCT2 : aucune montagne russe sous le seuil de son excitation (scénerie comprise)", () => {
        let n = 0;
        for (const e of loadLibrary(dirs)) {
            const td = e.design;
            const name = td && rideTrackInfo(td.rideType)?.name;
            // Seule exception : Calamity Mine (mine train, 7,4 à 62 km/h), dont l'excitation vient du décor et des tunnels.
            if (!td || !name || !/coaster/.test(name) || td.stats.excitement < 6.5 || e.name === "Calamity Mine") continue;
            n++;
            expect(td.stats.maxSpeedKmh, `${e.name} E ${td.stats.excitement}`).toBeGreaterThanOrEqual(speedForExcitement(td.stats.excitement) - 3);
        }
        expect(n).toBeGreaterThan(40);
    });
});
