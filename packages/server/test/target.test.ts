import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { spaceProfile } from "../src/planners/space.js";
import { LENGTH_MIN, checkTarget, referenceTarget, targetLevers } from "../src/planners/target.js";
import { designLayout, parseTrackDesign } from "../src/planners/td6.js";
import { SegmentTable, compileMacros, layoutStats, rideTrackInfo, type TrackPose } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const twister = rideTrackInfo(51)!;
const FRIGHTMARE = "/home/lucas/snap/steam/common/.local/share/Steam/steamapps/common/Rollercoaster Tycoon 2/Tracks/Frightmare.TD6";
const start: TrackPose = { x: 40, y: 40, z: 14 * 16, rot: 2, slope: 0, bank: 0 };

describe.skipIf(!existsSync(FRIGHTMARE))("cibles de référence", () => {
    const l = designLayout(parseTrackDesign(readFileSync(FRIGHTMARE), "Frightmare.TD6"), table, { x: 0, y: 0, z: 0 }, 0);
    const ref = referenceTarget("Frightmare", table, l.pieces);

    it("Frightmare : longueur, densité, empilement, lift et trains", () => {
        expect(ref).toMatchObject({ pieces: 112, lengthTiles: 205, density: 0.5, stackedTiles: 80, liftShared: 11, maxTrains: 3 });
        expect(targetLevers(ref, ref)).toEqual([]);
        const closed = checkTarget(ref, layoutStats(table, l.pieces), spaceProfile(table, l.pieces, { closed: true }), true);
        expect(closed.blocking).toEqual([]);
    });

    it("un circuit court : reste à poser tant qu'il est ouvert, fermeture refusée ensuite", () => {
        const plan = compileMacros(table, twister, start, [
            { op: "straight", length: 10 },
            { op: "turn", dir: "right", size: "medium", quarters: 2 },
            { op: "straight", length: 10 },
        ]);
        const layout = layoutStats(table, plan.pieces);
        const space = spaceProfile(table, plan.pieces);
        const open = checkTarget(ref, layout, space, false);
        expect(open.blocking).toEqual([]);
        expect(open.view.remainingTiles).toBe(Math.ceil(205 * LENGTH_MIN) - layout.lengthTiles);
        expect(open.warnings[0]).toMatch(/LONGUEUR/);
        const closed = checkTarget(ref, layout, space, true);
        expect(closed.blocking.some((b) => /trop court/.test(b))).toBe(true);
        expect(closed.blocking.some((b) => /train/.test(b))).toBe(true);
        expect(closed.warnings.some((w) => /densité|empilées/.test(w))).toBe(true);
        // Compacité bloquante : un circuit étalé ne ferme plus, même assez long.
        expect(closed.blocking.some((b) => /densité/.test(b))).toBe(true);
        expect(closed.blocking.some((b) => /empilées/.test(b))).toBe(true);
        expect(closed.blocking.some((b) => /dessous du lift/.test(b))).toBe(true);
    });
});
