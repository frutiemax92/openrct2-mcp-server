import { describe, expect, it } from "vitest";
import { BANK_MIN_KMH, DEFAULT_MODEL, designTrain, simulate, slowBanks } from "../src/planners/speed.js";
import { SegmentTable, compileMacros, rideTrackInfo, type Macro } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const TWISTER = (() => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "twister_roller_coaster") return t;
    throw new Error("twister_roller_coaster");
})();
const ride = rideTrackInfo(TWISTER)!;
const model = { ...DEFAULT_MODEL, rideType: TWISTER } as typeof DEFAULT_MODEL;
const train = designTrain({ vehicleObject: "rct2.ride.bmsd", carsPerTrain: 7, rideType: TWISTER });
const station: Macro[] = ["beginStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
const judge = (macros: Macro[]) => {
    const r = compileMacros(table, ride, { x: 50, y: 50, z: 112, rot: 2, slope: 0, bank: 0 }, [...station, { op: "straight", length: 1 }, { op: "lift", height: 12, steep: false }, ...macros]);
    expect(r.errors).toEqual([]);
    return slowBanks(table, r.pieces, simulate(model, table, r.pieces, model.stationSpeed, train)).map((b) => b.name);
};

describe("virage incliné trop lent (Haiku, 9 octobre 2026 : virage incliné juste après le lift)", () => {
    it("virage incliné à plat au sommet du lift : refusé", () => {
        const slow = judge([{ op: "straight", length: 1 }, { op: "turn", dir: "left", size: "small", banked: true }]);
        expect(slow.length).toBeGreaterThan(0);
        expect(slow.some((n) => /Bank/.test(n))).toBe(true);
    });
    it("virage non incliné au sommet, ou incliné qui plonge : accepté", () => {
        expect(judge([{ op: "straight", length: 1 }, { op: "turn", dir: "left", size: "small" }])).toEqual([]);
        expect(judge([{ op: "turn", dir: "left", size: "medium", banked: true, slope: "down" }])).toEqual([]);
    });
    it(`virage incliné après la chute (au-delà de ${BANK_MIN_KMH} km/h) : accepté`, () => {
        expect(judge([{ op: "drop", height: 10, steep: true }, { op: "turn", dir: "left", size: "medium", banked: true }])).toEqual([]);
    });
});
