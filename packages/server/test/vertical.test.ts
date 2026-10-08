import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TALL_SPAN, reliefLevers, reliefProfile } from "../src/planners/space.js";
import { designLayout, parseTrackDesign } from "../src/planners/td6.js";
import { QUARTER_LOOP_EXITS, SegmentTable, beginPose, compileMacros, layoutStats, rideTrackInfo, type TrackPose } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const twister = rideTrackInfo(51)!;
const FRIGHTMARE = "/home/lucas/snap/steam/common/.local/share/Steam/steamapps/common/Rollercoaster Tycoon 2/Tracks/Frightmare.TD6";
const start: TrackPose = { x: 40, y: 40, z: 20 * 16, rot: 2, slope: 0, bank: 0 };
const frightmare = () => designLayout(parseTrackDesign(readFileSync(FRIGHTMARE), "Frightmare.TD6"), table, { x: 0, y: 0, z: 0 }, 0).pieces;

describe("macros verticales", () => {
    it.skipIf(!existsSync(FRIGHTMARE))("dive puis quarter_loop redonnent la première inversion de Frightmare, pièce pour pièce", () => {
        const f = frightmare();
        const i = f.findIndex((p) => p.name === "rightLargeHalfLoopUp") - 2;
        const c = compileMacros(table, twister, beginPose(f[i], table.require(f[i].type)), [
            { op: "piece", name: "flatToUp25" },
            { op: "piece", name: "up25" },
            { op: "dive", dir: "right", size: "large", turn: "right" },
            { op: "quarter_loop", exit: "corkscrew", dir: "right" },
        ]);
        expect(c.errors).toEqual([]);
        const strip = (p: { name: string; x: number; y: number; z: number; direction: number }) => `${p.name}@${p.x},${p.y},${p.z},${p.direction}`;
        expect(c.pieces.map(strip)).toEqual(f.slice(i, i + c.pieces.length).map(strip));
        expect(c.pieces.at(-1)!.name).toBe("rightCorkscrewDown");
    });

    it("quarter_loop : chaque sortie se compile et revient à l'endroit, à plat ; une inversion de plus", () => {
        for (const exit of QUARTER_LOOP_EXITS) {
            const c = compileMacros(table, twister, start, [{ op: "quarter_loop", exit, dir: "left" }]);
            expect(c.errors, exit).toEqual([]);
            expect({ slope: c.end.slope, bank: c.end.bank }, exit).toEqual({ slope: 0, bank: 0 });
            expect(c.pieces.some((p) => p.name === "up90ToInvertedFlatQuarterLoop"), exit).toBe(true);
            expect(layoutStats(table, c.pieces).inversions, exit).toBeGreaterThanOrEqual(1);
        }
    });

    it("quarter_loop : height fixe le nombre de pièces up90, turn ajoute le virage d'1 tuile à 90°", () => {
        const c = compileMacros(table, twister, start, [{ op: "quarter_loop", exit: "half_loop", dir: "right", height: 6, turn: "left" }]);
        expect(c.errors).toEqual([]);
        expect(c.pieces.filter((p) => p.name === "up90")).toHaveLength(3);
        expect(c.pieces.some((p) => p.name === "leftQuarterTurn1TileUp90")).toBe(true);
    });

    it("vertical_drop : chute totale à 1 niveau près (pièces down90 de 2), finit à plat ; trop courte = erreur", () => {
        for (const [height, turn] of [[22, undefined], [26, undefined], [28, "right"]] as const) {
            const c = compileMacros(table, twister, start, [{ op: "vertical_drop", height, turn }]);
            expect(c.errors).toEqual([]);
            expect(c.end.slope).toBe(0);
            expect(Math.abs((start.z - c.end.z) / 16 - height)).toBeLessThanOrEqual(1);
            expect(c.pieces.some((p) => p.name === "down60ToDown90")).toBe(true);
            if (turn) expect(c.pieces.some((p) => p.name === "rightQuarterTurn1TileDown90")).toBe(true);
        }
        const short = compileMacros(table, twister, start, [{ op: "vertical_drop", height: 9 }]);
        expect(short.errors[0]?.message).toMatch(/niveaux au moins/);
    });
});

describe("relief", () => {
    it.skipIf(!existsSync(FRIGHTMARE))("Frightmare : 6 pièces à 90°, 7 à 60°, 8 éléments hauts, points hauts 17/16/9/5/0", () => {
        const r = reliefProfile(table, frightmare());
        expect(r).toMatchObject({ verticalPieces: 6, steepPieces: 7, invertedPieces: 10, peakByFifth: [17, 16, 9, 5, 0] });
        expect(r.meanHeight).toBeCloseTo(7.6, 1);
        expect(r.climbAfterLift).toBe(75);
        const tall = r.elements.filter((e) => e.span >= TALL_SPAN).map((e) => e.kind);
        expect(tall).toHaveLength(8);
        expect(tall).toEqual(expect.arrayContaining(["largeHalfLoopUp", "invertedFlatToDown90QuarterLoop", "up90ToInvertedFlatQuarterLoop"]));
    });

    it.skipIf(!existsSync(FRIGHTMARE))("leviers : rien contre soi-même ; un circuit plat se voit proposer la verticale", () => {
        const ref = reliefProfile(table, frightmare());
        expect(reliefLevers(ref, ref)).toEqual([]);
        const flat = compileMacros(table, twister, start, [
            { op: "lift", height: 17, steep: false },
            { op: "drop", height: 17, steep: false },
            { op: "inversion", kind: "loop", dir: "left" },
            { op: "turn", dir: "left", size: "large", banked: true },
        ]).pieces;
        const levers = reliefLevers(reliefProfile(table, flat), ref);
        expect(levers.some((l) => l.includes("pièces verticales (90°) 0 contre 6"))).toBe(true);
        expect(levers.some((l) => l.includes("éléments hauts"))).toBe(true);
    });
});
