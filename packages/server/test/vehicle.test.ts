import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, mphToKmh, simulate, SpeedModels, type SpeedModel } from "../src/planners/speed.js";
import { SegmentTable, compileMacros, endPose, rideTrackInfo, type PlannedPiece } from "../src/planners/track.js";
import { flattenCircuit, simulateExact, vehicleTable, velocityToMph } from "../src/planners/vehicle.js";

const table = SegmentTable.fromFile() as SegmentTable;
const vt = vehicleTable()!;
const twister = rideTrackInfo(51)!;
const train = { cars: 7, carLength: 0.45089285714285715, mass: 4425 };
const exactModel: SpeedModel = new SpeedModels(null).get(51);

/** Station de 5 tuiles vers +x au niveau 14, puis le plan. */
function circuit(plan: Parameters<typeof compileMacros>[3]): PlannedPiece[] {
    const names = ["beginStation", "middleStation", "middleStation", "middleStation", "endStation"];
    const station = names.map((n, i) => ({ type: table.byName(n)!.type, x: 40 + i, y: 40, z: 14 * 16, direction: 2 as const, name: n }));
    const c = compileMacros(table, twister, endPose(station[4], table.require(station[4].type)), plan);
    expect(c.errors).toEqual([]);
    return [...station, ...c.pieces];
}

const blockZ = (t: number) => table.get(t)?.elements[0]?.z ?? 0;

describe("simulateur exact (Vehicle.TrackMotion.cpp)", () => {
    it("les sous-positions s'enchaînent d'une pièce à l'autre (premier bloc de chaque pièce)", () => {
        const pieces = circuit([
            { op: "launch", height: 8 },
            { op: "loop", dir: "right" },
            { op: "inversion", kind: "dive_loop", dir: "left", size: "medium" },
            { op: "turn", dir: "right", slope: "steep_down" },
            { op: "inversion", kind: "corkscrew", dir: "left", size: "large" },
            { op: "helix", dir: "left", quarters: 2, down: true },
            { op: "drop", height: 6, steep: true },
        ]);
        for (let i = 0; i + 1 < pieces.length; i++) {
            const a = pieces[i];
            const b = pieces[i + 1];
            const la = vt.track(a.type).last[a.direction & 3];
            const fb = vt.track(b.type).first[b.direction & 3];
            const d = [b.x * 32 + fb[0] - (a.x * 32 + la[0]), b.y * 32 + fb[1] - (a.y * 32 + la[1]), b.z + blockZ(b.type) + fb[2] - (a.z + blockZ(a.type) + la[2])];
            expect(Math.max(...d.map(Math.abs)), `${a.name} → ${b.name}`).toBeLessThanOrEqual(4);
        }
        expect(flattenCircuit(vt, pieces, false, blockZ)!.subs.length).toBeGreaterThan(pieces.length * 10);
    });

    it("reproduit Lunar Launcher et Frightmare mesurés en jeu à moins de 2,5 km/h en moyenne, sans calage", () => {
        const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "measured-coasters.json"), "utf8")) as {
            rides: { name: string; rideType: number; train: typeof train; pieces: PlannedPiece[]; speedsKmh: (number | null)[] }[];
        };
        for (const r of fx.rides) {
            const model = new SpeedModels(null).get(r.rideType);
            const sim = simulate(model, table, r.pieces, model.stationSpeed, r.train);
            expect(sim.every((s) => s.exact && !s.stall && s.reached !== false), r.name).toBe(true);
            let e = 0;
            let n = 0;
            r.pieces.forEach((p, i) => {
                const v = r.speedsKmh[i];
                if (v === null || v < 0 || /tation|rake/.test(SegmentTable.nameOf(p.type))) return;
                e += Math.abs(mphToKmh(sim[i].vIn) - v);
                n++;
            });
            expect(n, r.name).toBeGreaterThan(50);
            expect(e / n, r.name).toBeLessThan(2.5);
        }
    });

    it("propulse le train sur le poweredLift (Lunar Launcher : ~63 km/h au sommet)", () => {
        const pieces = circuit([{ op: "launch", height: 8 }, { op: "loop", dir: "right" }]);
        const sim = simulate(exactModel, table, pieces, exactModel.stationSpeed, train);
        const loop = pieces.findIndex((p) => /VerticalLoop/.test(p.name ?? SegmentTable.nameOf(p.type)));
        expect(sim.some((s) => s.stall)).toBe(false);
        expect(mphToKmh(sim[loop].vIn)).toBeGreaterThan(55);
        expect(mphToKmh(sim[loop].vIn)).toBeLessThan(72);
    });

    it("la chaîne tient la vitesse de l'attraction", () => {
        const pieces = circuit([{ op: "lift", height: 10, steep: false }]);
        for (const speed of [5, 8]) {
            const sim = simulate({ ...exactModel, liftHillSpeed: speed }, table, pieces, exactModel.stationSpeed, train);
            const top = sim[sim.length - 2].vIn;
            // liftHillSpeed × 31079 en vitesse interne.
            expect(Math.abs(top - velocityToMph(speed * 31079))).toBeLessThan(0.6);
        }
    });

    it("signale le calage là où le train recule, et les pièces jamais atteintes", () => {
        const pieces = circuit([{ op: "drop", height: 2 }, { op: "climb", height: 8 }, { op: "drop", height: 8 }, { op: "straight", length: 3 }]);
        const sim = simulate(exactModel, table, pieces, exactModel.stationSpeed, train);
        const stall = sim.findIndex((s) => s.stall);
        expect(stall).toBeGreaterThan(5);
        expect(sim.slice(stall + 1).every((s) => s.reached === false)).toBe(true);
        // Le modèle d'énergie seul ne le voit pas toujours ; le simulateur exact est celui qu'on utilise.
        expect(sim[0].exact).toBe(true);
    });

    it("les freins ramènent le train à leur consigne", () => {
        const pieces = circuit([{ op: "launch", height: 8 }, { op: "drop", height: 8 }, { op: "brakes", length: 3, speed: 6 }, { op: "straight", length: 2 }]);
        const sim = simulate(exactModel, table, pieces, exactModel.stationSpeed, train);
        const last = sim[sim.length - 1];
        // Consigne 6 → 6 << 16 en vitesse interne, soit 13,5 mph.
        expect(last.vIn).toBeLessThan(14.5);
        expect(sim.find((s, i) => SegmentTable.nameOf(pieces[i].type) === "brakes")!.vIn).toBeGreaterThan(20);
    });

    it("revient au modèle d'énergie sans type d'attraction ou sans sous-positions", () => {
        const pieces = circuit([{ op: "drop", height: 4 }]);
        expect(simulate(DEFAULT_MODEL, table, pieces, 5, train)[0].exact).toBeUndefined();
        expect(simulate({ ...exactModel, energyOnly: true }, table, pieces, 5, train)[0].exact).toBeUndefined();
        expect(simulateExact([{ type: 9999, x: 0, y: 0, z: 0, direction: 0 }], { rideType: 51, train: { cars: 1, spacing: 0, mass: 1 } })).toBeNull();
    });
});
