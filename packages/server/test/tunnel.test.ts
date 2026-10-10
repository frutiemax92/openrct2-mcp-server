// Tunnels (SPEC 12.5) : un bloc entièrement sous la surface passe, comme dans MapCanConstructWithClearAt ; un bloc qui
// coupe le relief et une pièce à moitié dehors restent refusés (TrackPlaceAction).

import type { RegionTile } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import {
    Occupancy,
    SegmentTable,
    blockProblem,
    blockUnderground,
    groundMix,
    pieceElements,
    planClosure,
    rideClearance,
    rideTrackInfo,
    searchCatalog,
    type TrackEnv,
    type TrackPose,
} from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const TWISTER = 51;
const twister = rideTrackInfo(TWISTER)!;
const ground = (h: number): RegionTile => ({ h, s: 0, w: 0, t: 0, o: 1 });

/** Terrain au niveau 7, avec un plateau au niveau `hill` sur x 15-25 (toute la largeur). */
const plateauEnv = (hill: number): TrackEnv => ({
    get: (x) => ground(x >= 15 && x <= 25 ? hill : 7),
    rideId: 0,
    sandbox: false,
    mapSize: { x: 200, y: 200 },
    clearance: rideClearance(TWISTER),
});

describe("tunnels", () => {
    it("un bloc entièrement sous la surface passe, un bloc qui coupe le relief non", () => {
        const env = plateauEnv(40);
        const deep = { x: 20, y: 20, z: 160, cz: 16 };
        expect(blockUnderground(env, deep)).toBe(true);
        expect(blockProblem(env, deep)).toBeNull();
        // Sommet du dégagement au-dessus de la surface : la piste sortirait du terrain.
        const shallow = { x: 20, y: 20, z: 40 * 16 - 16, cz: 16 };
        expect(blockUnderground(env, shallow)).toBe(false);
        expect(blockProblem(env, shallow)).toBe("sous le terrain");
        // Au-dessus du sol : inchangé.
        expect(blockProblem(env, { x: 10, y: 20, z: 7 * 16, cz: 16 })).toBeNull();
    });

    it("une pièce à moitié sous le terrain est refusée", () => {
        const env = plateauEnv(40);
        const outside = { x: 14, y: 20, z: 160, cz: 16 };
        const inside = { x: 15, y: 20, z: 160, cz: 16 };
        expect(groundMix(env, [outside, { ...outside, y: 21 }])).toBeNull();
        expect(groundMix(env, [inside, { ...inside, x: 16 }])).toBeNull();
        expect(groundMix(env, [outside, inside])).toEqual(inside);
    });

    it("la fermeture A* traverse une colline qu'elle ne peut pas survoler", () => {
        // Plateau au niveau 40, bande de 3 tuiles : ni contournement (bounds) ni survol (zMax = départ + 10 niveaux).
        const catalog = searchCatalog(table, twister, { steep: false, chainedClimbsOnly: true });
        const from: TrackPose = { x: 10, y: 20, z: 160, rot: 2, slope: 0, bank: 0 };
        const goal: TrackPose = { x: 30, y: 20, z: 160, rot: 2, slope: 0, bank: 0 };
        const bounds = { x1: 5, y1: 19, x2: 35, y2: 21 };
        const res = planClosure(catalog, from, goal, new Occupancy(rideClearance(TWISTER)), plateauEnv(40), { bounds, zMin: 64 });
        expect(res).not.toBeNull();
        expect(res!.pieces.some((p) => p.x >= 15 && p.x <= 25)).toBe(true);
        const env = plateauEnv(40);
        for (const p of res!.pieces)
            for (const e of pieceElements(p, table.require(p.type))) if (e.x >= 15 && e.x <= 25) expect(blockUnderground(env, e), `(${e.x},${e.y}) niveau ${e.z / 16}`).toBe(true);
    });
});
