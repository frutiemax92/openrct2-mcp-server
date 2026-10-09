import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { spaceProfile } from "../src/planners/space.js";
import { FOOTPRINT_MAX, LENGTH_MIN, allowedSpace, applyMods, checkTarget, firstDrop, firstDropProblems, referenceTarget, steepCount, targetLevers } from "../src/planners/target.js";
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
    it("« Frightmare, mais plus haut, plus rapide, plus long, à 4 trains » : Frightmare lui-même ne ferme plus", () => {
        const base = { ...ref, topSpeedKmh: 90 };
        const mod = applyMods(base, { trains: 4, taller: 5, faster: 8, longer: 10 });
        expect(mod).toMatchObject({ maxTrains: 4, heightLevels: ref.heightLevels + 5, topSpeedKmh: 98, lengthTiles: Math.round(205 * 1.1) });
        // Plus long seul : emprise × k, densité inchangée ; plus haut, plus rapide, plus de trains : davantage, densité plus basse.
        expect(applyMods(base, { longer: 10 })).toMatchObject({ footprintArea: Math.round(ref.footprintArea * 1.1), density: ref.density });
        expect(mod.footprintArea).toBeGreaterThan(ref.footprintArea * 1.1);
        expect(mod.density).toBeLessThan(ref.density);
        expect(mod.name).toMatch(/4 trains, \+5 niveaux, \+8 km\/h, \+10 %/);
        expect(applyMods(base, {})).toBe(base);
        const layout = layoutStats(table, l.pieces);
        const space = spaceProfile(table, l.pieces, { closed: true });
        const closed = checkTarget(mod, layout, space, true, { topSpeedKmh: 90 });
        expect(closed.blocking.some((b) => /niveaux d'écart de hauteur/.test(b))).toBe(true);
        expect(closed.blocking.some((b) => /vitesse de pointe 90 km\/h contre 98/.test(b))).toBe(true);
        expect(closed.blocking.some((b) => /3 train\(s\) permis contre 4/.test(b))).toBe(true);
        // Sans modification, ni la hauteur ni la vitesse ne bloquent.
        expect(checkTarget(base, layout, space, true, { topSpeedKmh: 80 }).blocking).toEqual([]);
        // Circuit ouvert, lift posé : HAUTEUR et VITESSE avant la fermeture.
        const open = checkTarget(mod, layout, space, false, { topSpeedKmh: 90 });
        expect(open.warnings.some((w) => /^HAUTEUR/.test(w))).toBe(true);
        expect(open.warnings.some((w) => /^VITESSE : 90 km\/h/.test(w))).toBe(true);
    });
});

const BLACK_WIDOW = "/home/lucas/snap/steam/common/.local/share/Steam/steamapps/common/Rollercoaster Tycoon 2/Tracks/Black Widow.TD6";

describe.skipIf(!existsSync(BLACK_WIDOW))("forme de la première chute", () => {
    const l = designLayout(parseTrackDesign(readFileSync(BLACK_WIDOW), "Black Widow.TD6"), table, { x: 0, y: 0, z: 0 }, 0);
    const ref = referenceTarget("Black Widow", table, l.pieces);
    const wooden = rideTrackInfo(52)!;
    const station: TrackPose = { x: 40, y: 40, z: 10 * 16, rot: 2, slope: 0, bank: 0 };

    it("Black Widow plonge à 60° dès le sommet du lift, et passe sa propre chute", () => {
        expect(ref.firstDrop).toMatchObject({ complete: true, topRun: 0, height: 17 });
        expect(ref.firstDrop!.steep).toBeGreaterThan(0);
        expect(ref.steepPieces).toBeGreaterThanOrEqual(20);
        const closed = checkTarget(ref, layoutStats(table, l.pieces), spaceProfile(table, l.pieces, { closed: true }), true, {
            firstDrop: ref.firstDrop,
            steepPieces: ref.steepPieces,
        });
        expect(closed.blocking).toEqual([]);
    });

    it("le début de « Black Widow XXL » (Haiku) : virage à plat au sommet puis chute à 25°, refusé circuit ouvert", () => {
        const plan = compileMacros(table, wooden, station, [
            { op: "lift", height: 20, steep: false },
            { op: "turn", dir: "left", banked: true, size: "large", quarters: 2 },
            { op: "drop", height: 16, steep: false },
            { op: "level" },
            { op: "straight", length: 3 },
        ]);
        expect(plan.errors).toEqual([]);
        const drop = firstDrop(table, plan.pieces);
        expect(drop).toMatchObject({ complete: true, steep: 0 });
        expect(drop!.topRun).toBeGreaterThan(3);
        const open = checkTarget(ref, layoutStats(table, plan.pieces), spaceProfile(table, plan.pieces), false, { firstDrop: drop, steepPieces: steepCount(plan.pieces) });
        expect(open.blocking.some((b) => /^SOMMET/.test(b))).toBe(true);
        expect(open.blocking.some((b) => /^PREMIÈRE CHUTE PAS RAIDE/.test(b))).toBe(true);
        expect(firstDropProblems(ref, drop).length).toBe(2);
    });

    it("lift puis chute raide : accepté ; chute pas finie : pas encore jugée", () => {
        const good = compileMacros(table, wooden, station, [
            { op: "lift", height: 18, steep: false },
            { op: "drop", height: 17, steep: true },
            { op: "level" },
        ]);
        expect(good.errors).toEqual([]);
        expect(firstDropProblems(ref, firstDrop(table, good.pieces))).toEqual([]);
        const lift = compileMacros(table, wooden, station, [{ op: "lift", height: 18, steep: false }, { op: "straight", length: 1 }]);
        expect(firstDropProblems(ref, firstDrop(table, lift.pieces))).toEqual([]);
    });
});

describe.skipIf(!existsSync(BLACK_WIDOW))("emprise d'une référence modifiée", () => {
    const l = designLayout(parseTrackDesign(readFileSync(BLACK_WIDOW), "Black Widow.TD6"), table, { x: 0, y: 0, z: 0 }, 0);
    const ref = { ...referenceTarget("Black Widow", table, l.pieces), topSpeedKmh: 87 };
    const mods = { taller: 3, faster: 8, longer: 25, trains: 3 };

    it("« Black Widow Loop » (Haiku) : lift 23 et 218 tuiles sur 37×23 refusés à 1,3 × 1,25 × l'emprise ; tiennent maintenant", () => {
        expect(ref).toMatchObject({ footprintArea: 322, footprintSides: [23, 14], density: 0.52 });
        const mod = applyMods(ref, mods);
        // Estimation a priori : chute +3,3 niveaux (v² ∝ hauteur), grand côté plus long, virages plus larges.
        expect(mod.footprintSides![0]).toBeGreaterThan(26);
        expect(mod.footprintArea * FOOTPRINT_MAX).toBeGreaterThan(Math.round(322 * 1.25 * FOOTPRINT_MAX));
        // Chute réellement posée : 23 niveaux (17 + 6) pour atteindre 95 km/h.
        const built = { complete: true, liftEnd: 0, end: 0, topRun: 0, height: 23, steep: 10 };
        const a = allowedSpace(mod, built);
        expect(a.area * FOOTPRINT_MAX).toBeGreaterThanOrEqual(37 * 23);
        expect(a.density * 0.75).toBeLessThanOrEqual(218 / (37 * 23));
        // Plafonné : un lift démesuré n'ouvre pas l'emprise sans limite.
        expect(allowedSpace(mod, { ...built, height: 60 }).area).toBe(allowedSpace(mod, { ...built, height: 17 + 2 * 3.3 + 3 }).area);
        // Sans plus haut ni plus rapide, la chute posée ne change rien.
        const longer = applyMods(ref, { longer: 25 });
        expect(allowedSpace(longer, built)).toMatchObject({ area: longer.footprintArea, density: longer.density });
    });
});
