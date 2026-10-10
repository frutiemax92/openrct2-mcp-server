import type { RegionTile } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { mirrorName, retreatOptions } from "../src/planners/backtrack.js";
import { defaultVocabulary, firstDropVocabulary } from "../src/planners/search.js";
import { PITCH, SegmentTable, compileMacros, rideClearance, rideTrackInfo, type Macro, type TrackEnv } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const WOODEN = (() => {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") return t;
    throw new Error("wooden_roller_coaster");
})();
const ride = rideTrackInfo(WOODEN)!;
const flatTile: RegionTile = { h: 7, s: 0, w: 0, t: 0, o: 1 };
const env: TrackEnv = { get: () => flatTile, rideId: 0, sandbox: false, mapSize: { x: 200, y: 200 } };
const START = { x: 30, y: 60, z: 7 * 16, rot: 2, slope: 0, bank: 0 };

const station: Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
const compile = (plan: Macro[]) => compileMacros(table, ride, START, [...station, { op: "straight", length: 2 }, { op: "lift", height: 27 }, ...plan]);
/** Pièces après le sommet du lift. */
const opening = (plan: Macro[]) => {
    const r = compile(plan);
    expect(r.errors).toEqual([]);
    const top = r.pieces.findLastIndex((p) => p.chain);
    return r.pieces.slice(top + 1).map((p) => table.require(p.type));
};
/** Paliers à plat au milieu de la chute (l'escalier de « Timber Ridge »). */
const midFlats = (segs: ReturnType<typeof opening>) => segs.slice(0, -1).filter((s) => s.endSlope === PITCH.flat).length;

/**
 * « Timber Ridge » (Haiku, 9 octobre 2026) : turn { slope: 'steep_down' } puis drop { steep } posait
 * flatToDown60LongBase, virage, down60ToFlatLongBase, flatToDown25, down25ToDown60, down60… : la macro drop repassait
 * à plat avant de replonger. Et la recherche ne tournait jamais en plongeant, ni ne retentait l'autre sens.
 */
describe("chute raide qui tourne de 90°", () => {
    it("turn steep_down puis drop : la pente continue à 60°, sans palier", () => {
        const segs = opening([{ op: "turn", dir: "right", slope: "steep_down" }, { op: "drop", height: 12, steep: true }]);
        expect(midFlats(segs)).toBe(0);
        const names = segs.map((s) => SegmentTable.nameOf(s.type));
        expect(names[names.indexOf("rightQuarterTurn1TileDown60") + 1]).toBe("down60");
    });

    it("drop { turn } : une seule chute à 60°, virage au milieu des pièces raides", () => {
        const segs = opening([{ op: "drop", height: 20, turn: "left" }]);
        const names = segs.map((s) => SegmentTable.nameOf(s.type));
        expect(midFlats(segs)).toBe(0);
        const at = names.indexOf("leftQuarterTurn1TileDown60");
        expect(at).toBeGreaterThan(0);
        expect(segs[at - 1].endSlope).toBe(PITCH.down60);
        expect(segs[at + 1].beginSlope).toBe(PITCH.down60);
        expect(segs.reduce((z, s) => z + s.beginZ - s.endZ, 0)).toBe(20 * 16);
    });

    it("drop { turn } trop court : l'erreur donne les hauteurs possibles", () => {
        const r = compile([{ op: "drop", height: 3, turn: "left" }]);
        expect(r.errors[0]?.message).toMatch(/hauteurs possibles : \d+/);
    });

    it("la recherche connaît la chute qui tourne, au début et en cours de route", () => {
        expect(firstDropVocabulary(12).some((m) => m[0].op === "drop" && m[0].turn === "left")).toBe(true);
        expect(firstDropVocabulary(12).some((m) => m[0].op === "drop" && m[0].turn === "right")).toBe(true);
        expect(defaultVocabulary().some((m) => m[0].op === "drop" && m[0].turn)).toBe(true);
    });

    it("mirrorName : gauche ↔ droite", () => {
        expect(mirrorName("leftQuarterTurn1TileDown60")).toBe("rightQuarterTurn1TileDown60");
        expect(mirrorName("flatToRightBank")).toBe("flatToLeftBank");
        expect(mirrorName("down60")).toBe("down60");
    });

    it("repli : la chute qui tournait à droite est d'abord refaite à gauche, même hauteur", () => {
        const r = compile([{ op: "drop", height: 20, turn: "right" }, { op: "straight", length: 1 }]);
        expect(r.errors).toEqual([]);
        const options = retreatOptions(table, ride, r.pieces, env, rideClearance(WOODEN));
        expect(options.length).toBeGreaterThan(0);
        expect(options[0].macros).toEqual([{ op: "drop", height: 20, turn: "left" }]);
        expect(options.some((o) => o.macros[0]?.op === "drop" && o.macros[0].turn === "right" && o.macros[0].height < 20)).toBe(true);
    });
});
