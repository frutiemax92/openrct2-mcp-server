import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { circuitFingerprint, elementSequence, gSections, ratingGaps, speedProfile, topLevers, type CoasterMeasure, type StoredTerm } from "../src/planners/compare.js";
import { MeasureStore } from "../src/state/measures.js";
import { SegmentTable, compileMacros, rideTrackInfo, type TrackPose } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const twister = rideTrackInfo(51)!;
const start: TrackPose = { x: 40, y: 40, z: 14 * 16, rot: 2, slope: 0, bank: 0 };
const plan = compileMacros(table, twister, start, [
    { op: "lift", height: 10, steep: false },
    { op: "drop", height: 10, steep: false },
    { op: "inversion", kind: "loop", dir: "left" },
    { op: "straight", length: 3 },
]);
const pieces = plan.pieces;

describe("comparaison : empreinte et profils", () => {
    it("l'empreinte change dès qu'une pièce bouge", () => {
        const a = circuitFingerprint(pieces);
        expect(a).toBe(circuitFingerprint(pieces.map((p) => ({ ...p }))));
        expect(circuitFingerprint([...pieces.slice(0, -1), { ...pieces[pieces.length - 1], z: pieces[pieces.length - 1].z + 16 }])).not.toBe(a);
        expect(a.startsWith(`${pieces.length}:`)).toBe(true);
    });

    it("profil de vitesse : 11 points, pièces sans relevé remplacées par la mesure voisine", () => {
        const speeds = pieces.map((_, i) => (i % 3 === 1 ? -1 : 10 + i));
        const prof = speedProfile(table, pieces, speeds);
        expect(prof).toHaveLength(11);
        expect(prof.every((v) => v !== null && v >= 10)).toBe(true);
        expect(speedProfile(table, pieces, pieces.map(() => -1)).every((v) => v === null)).toBe(true);
    });

    it("G par tranche : extrêmes de chaque cinquième", () => {
        const g = pieces.map((_, i) => ({ vertMax: i / 10, vertMin: -i / 10, latMax: 0.5 }));
        const secs = gSections(table, pieces, g);
        expect(secs).toHaveLength(5);
        expect(secs[4].vertMax!).toBeGreaterThan(secs[0].vertMax!);
        expect(secs[0].latMax).toBe(0.5);
    });

    it("suite des éléments : lift regroupé, puis boucle", () => {
        const seq = elementSequence(pieces);
        expect(seq.startsWith("lift×")).toBe(true);
        expect(seq).toContain("HalfLoopUp");
    });
});

describe("comparaison : écarts et leviers", () => {
    const ride: StoredTerm[] = [
        { key: "base", excitement: 350, intensity: 40, nausea: 30 },
        { key: "averageSpeed", excitement: 46, intensity: 0, nausea: 0, input: "23 mph" },
        { key: "turns", excitement: 60, intensity: 0, nausea: 0, parts: [{ key: "inversions", excitement: 40, input: "4" }, { key: "helices", excitement: 21, input: "4" }] },
    ];
    const ref: StoredTerm[] = [
        { key: "base", excitement: 350, intensity: 40, nausea: 30 },
        { key: "averageSpeed", excitement: 83, intensity: 0, nausea: 0, input: "32 mph" },
        { key: "turns", excitement: 71, intensity: 0, nausea: 0, parts: [{ key: "inversions", excitement: 51, input: "5" }, { key: "helices", excitement: 21, input: "4" }] },
        { key: "scenery", excitement: 5, intensity: 0, nausea: 0, input: "15" },
    ];

    it("écarts au grain des sous-parts, du plus grand manque au plus petit", () => {
        const gaps = ratingGaps(ride, ref);
        expect(gaps.map((g) => g.key)).toEqual(["averageSpeed", "inversions", "scenery"]);
        expect(gaps[0].gap).toBe(37);
    });

    it("leviers rédigés avec les valeurs des deux circuits", () => {
        const l = topLevers(ratingGaps(ride, ref));
        expect(l[0]).toBe("+0.37 : vitesse moyenne 23 mph → 32 mph");
        expect(l[1]).toBe("+0.11 : inversions 4 → 5");
        expect(l).toHaveLength(3);
    });
});

describe("comparaison : mesures gardées", () => {
    it("une mesure ne vaut que pour son circuit, et survit à un redémarrage", () => {
        const dir = mkdtempSync(join(tmpdir(), "measures-"));
        const m = { rideId: 5, name: "X", fingerprint: "3:abc" } as CoasterMeasure;
        new MeasureStore(join(dir, "m.json")).set(m);
        const again = new MeasureStore(join(dir, "m.json"));
        expect(again.get(5, "3:abc")?.name).toBe("X");
        expect(again.get(5, "3:abd")).toBeUndefined();
    });
});
