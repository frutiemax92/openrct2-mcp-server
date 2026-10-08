import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    computeRatings,
    countTrackFeatures,
    emptyProximity,
    proximityScore,
    ratingLevers,
    ratingsDataFor,
    resolveSpeeds,
    shelterFromBlocks,
    shelterPoints,
    shelteredEighths,
    speedCandidates,
    type RatingInputs,
} from "../src/planners/ratings.js";
import { designLayout, parseTrackDesign } from "../src/planners/td6.js";
import { SegmentTable, compileMacros, rideTrackInfo, type TrackPose } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const twister = rideTrackInfo(51)!;
const data = ratingsDataFor(51)!;
const FRIGHTMARE = "/home/lucas/snap/steam/common/.local/share/Steam/steamapps/common/Rollercoaster Tycoon 2/Tracks/Frightmare.TD6";
const start: TrackPose = { x: 40, y: 40, z: 14 * 16, rot: 2, slope: 0, bank: 0 };

const inputs = (over: Partial<RatingInputs> = {}): RatingInputs => ({
    lengthM: 1000,
    totalTime: 80,
    maxSpeed16: 27,
    avgSpeed16: 12,
    carsPerTrain: 7,
    maxPosG: 400,
    maxNegG: -100,
    maxLatG: 150,
    features: { turns: { flat: [0, 0, 0], banked: [2, 1, 1], sloped: [1, 0, 1, 0] }, inversions: 5, helices: 4, drops: 6, highestDrop: 40 },
    drops: 6,
    highestDrop: 40,
    shelter: { lengthM: 20, sections: 2, banking: false, rotating: true, trackEighths: 0 },
    proximity: { ...emptyProximity(), surfaceTouch: 20, ownTrackTouchAbove: 4 },
    scenery: { items: 0, underground: false },
    reversedTrains: false,
    synchronised: false,
    airTime: 100,
    entry: { excitement: 0, intensity: 0, nausea: 0, limitAirTimeBonus: false, coveredRide: false },
    numStations: 1,
    ...over,
});

describe("notes : données générées", () => {
    it("RatingsData du twister repris du C++", () => {
        expect(data.base).toEqual({ excitement: 350, intensity: 40, nausea: 30 });
        expect(data.relaxRequirementsIfInversions).toBe(true);
        expect(data.modifiers.find((m) => m.type === "bonusAverageSpeed")).toMatchObject({ excitement: 291271, intensity: 436906 });
        expect(data.hasAirTime).toBe(true);
        expect(data.heights).toMatchObject({ clearanceHeight: 24, vehicleZOffset: 8 });
    });
});

describe("notes : comptages sur les pièces", () => {
    it("un virage suivi d'un virage opposé ne compte qu'une fois (comme le jeu)", () => {
        // Le comptage ne dépend que de l'ordre des types de pièces.
        const seq = (names: string[]) => names.map((n) => ({ type: table.byName(n)!.type, x: 0, y: 0, z: 0, direction: 0 as const }));
        const f = countTrackFeatures(table, seq(["leftBankedQuarterTurn3Tiles", "rightBankedQuarterTurn3Tiles", "flat", "flat"]));
        expect(f.turns.banked).toEqual([1, 0, 0]);
        const g = countTrackFeatures(table, seq(["leftBankedQuarterTurn3Tiles", "flat", "rightBankedQuarterTurn3Tiles", "flat"]));
        expect(g.turns.banked).toEqual([2, 0, 0]);
    });

    it("des quarts de virage enchaînés du même côté forment un seul virage plus long", () => {
        const r = compileMacros(table, twister, start, [
            { op: "turn", dir: "left", size: "medium", banked: true, quarters: 2 },
            { op: "straight", length: 1 },
        ]);
        const f = countTrackFeatures(table, r.pieces);
        expect(f.turns.banked).toEqual([0, 1, 0]);
    });

    it("compte les chutes et la plus haute (unités de 8)", () => {
        const r = compileMacros(table, twister, start, [
            { op: "lift", height: 10, steep: false },
            { op: "drop", height: 8, steep: false },
            { op: "straight", length: 1 },
        ]);
        const f = countTrackFeatures(table, r.pieces);
        expect(f.drops).toBe(1);
        expect(f.highestDrop).toBe(16);
    });

    it.skipIf(!existsSync(FRIGHTMARE))("Frightmare : 5 inversions, comme mesuré en jeu", () => {
        const l = designLayout(parseTrackDesign(readFileSync(FRIGHTMARE), "Frightmare.TD6"), table, { x: 0, y: 0, z: 0 }, 0);
        expect(countTrackFeatures(table, l.pieces).inversions).toBe(5);
    });
});

describe("notes : formule", () => {
    it("chaque terme s'additionne pour donner la note", () => {
        const r = computeRatings(data, inputs());
        const sum = r.terms.reduce((a, t) => a + t.excitement, 0);
        expect(sum).toBe(r.excitement);
        expect(r.terms.find((t) => t.key === "length")!.excitement).toBe(Math.floor((1000 * 764) / 65536));
    });

    it("plafonne les inversions à 6 pour l'excitation, pas pour l'intensité", () => {
        const six = computeRatings(data, inputs({ features: { ...inputs().features, inversions: 6 } }));
        const seven = computeRatings(data, inputs({ features: { ...inputs().features, inversions: 7 } }));
        expect(seven.excitement).toBeLessThanOrEqual(six.excitement);
        expect(seven.intensity).toBeGreaterThan(six.intensity);
    });

    it("sans inversion, une chute trop basse divise les notes par 2", () => {
        const f = { ...inputs().features, inversions: 0 };
        const ok = computeRatings(data, inputs({ features: f }));
        const low = computeRatings(data, inputs({ features: f, highestDrop: 4 }));
        expect(low.terms.some((t) => t.key === "requirementDropHeight")).toBe(true);
        expect(low.excitement).toBeLessThan(ok.excitement / 1.8);
        // Avec des inversions, l'exigence est levée.
        expect(computeRatings(data, inputs({ highestDrop: 4 })).terms.some((t) => t.key === "requirementDropHeight")).toBe(false);
    });

    it("pénalise l'excitation au-delà de 10 d'intensité", () => {
        const r = computeRatings(data, inputs({ maxPosG: 650, maxSpeed16: 40, maxLatG: 320 }));
        expect(r.intensity).toBeGreaterThanOrEqual(1000);
        expect(r.terms.find((t) => t.key === "intensityPenalty")!.excitement).toBeLessThan(0);
    });

    it("score de proximité : file d'attente (+8 d'office) et pièces au sol plafonnées à 70", () => {
        expect(proximityScore(emptyProximity()).total).toBe(50);
        const a = proximityScore({ ...emptyProximity(), surfaceTouch: 70 }).total;
        const b = proximityScore({ ...emptyProximity(), surfaceTouch: 90 }).total;
        expect(a).toBe(50 + Math.floor((70 * 0x01b6db) / 65536));
        expect(b).toBe(a);
    });

    it("leviers : une inversion de plus rapporte, la vitesse moyenne aussi", () => {
        const levers = ratingLevers(data, inputs());
        expect(levers.find((l) => l.lever === "+1 inversion")!.excitement).toBeGreaterThan(5);
        expect(levers.find((l) => l.lever === "+1 cran de vitesse moyenne (+2,25 mph)")!.excitement).toBeGreaterThan(0);
        expect(levers[0].excitement).toBeGreaterThanOrEqual(levers[levers.length - 1].excitement);
    });
});

describe("notes : vitesses de l'API", () => {
    it("un mph entier correspond à une ou deux valeurs brutes", () => {
        expect(speedCandidates(50)).toEqual([22]);
        expect(speedCandidates(51)).toEqual([22, 23]);
    });

    it("lève l'ambiguïté en retombant sur les notes du jeu", () => {
        const truth = inputs({ maxSpeed16: 23, avgSpeed16: 12 });
        const game = computeRatings(data, truth);
        const best = resolveSpeeds(data, truth, 51, 27, game);
        expect(best.inputs.maxSpeed16).toBe(23);
        expect(best.error).toBe(0);
    });
});

describe("notes : abri", () => {
    it("huitièmes abrités comme GetNumOfShelteredEighths", () => {
        expect(shelteredEighths(800, 250)).toBe(2);
        expect(shelteredEighths(800, 0)).toBe(0);
        expect(shelteredEighths(800, 800)).toBe(7);
    });

    it("sections, longueur et pente à l'entrée d'un tunnel", () => {
        const r = compileMacros(table, twister, start, [{ op: "straight", length: 2 }, { op: "drop", height: 2, steep: false }, { op: "straight", length: 2 }]);
        const pts = shelterPoints(table, r.pieces, 8);
        expect(pts.length).toBe(r.pieces.reduce((n, p) => n + table.require(p.type).elements.length, 0));
        // Abrité de la descente à la première droite qui suit : une section, entrée en pente.
        const sheltered = r.pieces.flatMap((p, i) => table.require(p.type).elements.map(() => i >= 3 && i <= r.pieces.length - 2));
        const s = shelterFromBlocks(table, r.pieces, sheltered, 0.2, 100);
        expect(s.sections).toBe(1);
        expect(s.rotating).toBe(true);
        expect(s.lengthM).toBeGreaterThan(0);
    });
});
