import { describe, expect, it } from "vitest";
import { ACTION_ARGS, checkActionArgs, gameErrorToBridgeError, rotateOffset, CHEAT_TYPES, RIDE_TYPES } from "../src/index.js";

describe("table des arguments générée depuis le C++", () => {
    it("corrige les 4 écarts du .d.ts (SPEC F6)", () => {
        expect(ACTION_ARGS.footpathlayoutplace).toContain("slopeType");
        expect(ACTION_ARGS.footpathlayoutplace).not.toContain("slope");
        expect(ACTION_ARGS.parkentranceplace).toEqual(expect.arrayContaining(["entranceObject", "footpathTypeIsLegacy:bool"]));
        expect(ACTION_ARGS.clearscenery).toEqual(["x1", "y1", "x2", "y2", "itemsToClear"]);
        expect(ACTION_ARGS.surfacesetstyle).toEqual(expect.arrayContaining(["surfaceColour1", "edgeColour1"]));
    });
    it("détecte les clés manquantes et les mauvais types", () => {
        const c = checkActionArgs("rideentranceexitplace", { x: 0, y: 0, direction: 0, ride: 1, station: 0, isExit: 1 });
        expect(c.missing).toEqual([]);
        expect(c.wrongType).toEqual(["isExit (bool)"]);
        expect(checkActionArgs("footpathremove", { x: 0 }).missing).toEqual(["y", "z"]);
    });
});

describe("tables générées", () => {
    it("CheatType conforme à SPEC F20", () => {
        expect(CHEAT_TYPES.sandboxMode).toBe(0);
        expect(CHEAT_TYPES.buildInPauseMode).toBe(11);
        expect(CHEAT_TYPES.setMoney).toBe(17);
        expect(CHEAT_TYPES.ownAllLand).toBe(42);
        expect(CHEAT_TYPES.ignoreResearchStatus).toBe(44);
    });
    it("pièces de départ des attractions plates", () => {
        expect(RIDE_TYPES.find((r) => r.name === "merry_go_round")?.startTrackPiece).toBe(266);
        expect(RIDE_TYPES.find((r) => r.name === "food_stall")?.startTrackPiece).toBe(262);
    });
});

describe("coordonnées", () => {
    it("rotation identique à CoordsXY::rotate", () => {
        expect(rotateOffset({ x: -32, y: 0 }, 1)).toEqual({ x: 0, y: 32 });
        expect(rotateOffset({ x: 32, y: 64 }, 3)).toEqual({ x: -64, y: 32 });
    });
});

describe("erreurs du jeu", () => {
    it("traduit les statuts en codes avec hint", () => {
        expect(gameErrorToBridgeError("footpathplace", { error: 6 }).code).toBe("NOT_OWNED");
        expect(gameErrorToBridgeError("footpathplace", { error: 9 }).code).toBe("OBSTRUCTED");
        expect(gameErrorToBridgeError("x", { error: 2, errorMessage: "Land not owned by park!" }).code).toBe("NOT_OWNED");
        expect(gameErrorToBridgeError("x", { error: 3 }).hint).toContain("pause");
    });
});
