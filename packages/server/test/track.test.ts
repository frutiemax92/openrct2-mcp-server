import { TRACK_ELEM_TYPES, type RegionTile } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import {
    Occupancy,
    blockProblem,
    blockSpan,
    blocksClash,
    PITCH,
    SegmentTable,
    availableInversions,
    compileMacros,
    describeSequence,
    endPose,
    findTransition,
    originAt,
    pieceAllowed,
    pieceElements,
    pieceEndingAt,
    planClosure,
    planWarnings,
    layoutStats,
    poseKey,
    rideTrackInfo,
    searchCatalog,
    slopeRun,
    type TrackEnv,
    type TrackPose,
} from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const lrc = rideTrackInfo(rideTypeByName("looping_roller_coaster"))!;

const flatTile: RegionTile = { h: 4, s: 0, w: 0, t: 0, o: 1 };
const env: TrackEnv = { get: () => flatTile, rideId: 0, sandbox: false, mapSize: { x: 200, y: 200 } };

describe("table des segments", () => {
    it("est chargée depuis data/track_segments.json", () => {
        expect(table).not.toBeNull();
        expect(table.all().length).toBe(350);
        expect(lrc.name).toBe("looping_roller_coaster");
    });
});

describe("marcheur de piste", () => {
    it("pieceEndingAt inverse endPose pour toutes les pièces et directions", () => {
        for (const seg of table.all()) {
            if (!seg.elements.length) continue;
            for (let d = 0; d < 4; d++) {
                const piece = { type: seg.type, x: 100, y: 100, z: 160, direction: d as 0 | 1 | 2 | 3 };
                const back = pieceEndingAt(endPose(piece, seg), seg);
                expect(back).toEqual(piece);
            }
        }
    });

    it("quatre quarts de virage reviennent à la pose de départ", () => {
        const seg = table.byName("leftQuarterTurn3Tiles")!;
        const start: TrackPose = { x: 50, y: 50, z: 112, rot: 0, slope: 0, bank: 0 };
        let pose = start;
        for (let i = 0; i < 4; i++) pose = endPose(originAt(pose, seg), seg);
        expect(poseKey(pose)).toBe(poseKey(start));
    });

    it("une montée 25° monte de 16 et la pièce suivante démarre une tuile plus loin", () => {
        const seg = table.byName("up25")!;
        const pose: TrackPose = { x: 10, y: 10, z: 64, rot: 2, slope: PITCH.up25, bank: 0 };
        const piece = originAt(pose, seg);
        expect(piece).toMatchObject({ x: 10, y: 10, z: 64, direction: 2 });
        expect(endPose(piece, seg)).toMatchObject({ x: 11, y: 10, z: 80, rot: 2 });
        const down = table.byName("down25")!;
        // Une descente commence 16 plus haut que son origine (beginZ = 16).
        expect(originAt({ ...pose, slope: PITCH.down25 }, down).z).toBe(48);
    });

    it("les blocs d'un virage 5 tuiles occupent 7 tuiles distinctes", () => {
        const seg = table.byName("leftQuarterTurn5Tiles")!;
        const el = pieceElements({ type: seg.type, x: 20, y: 20, z: 64, direction: 0 }, seg);
        expect(new Set(el.map((e) => `${e.x},${e.y}`)).size).toBe(7);
    });
});

describe("transitions et macros", () => {
    it("trouve flatToUp25 puis up25ToLeftBank… pour changer d'état", () => {
        expect(findTransition(table, lrc, { slope: 0, bank: 0 }, { slope: PITCH.up25, bank: 0 })?.map((s) => SegmentTable.nameOf(s.type))).toEqual(["flatToUp25"]);
        expect(findTransition(table, lrc, { slope: 0, bank: 0 }, { slope: 0, bank: 2 })?.length).toBe(1);
    });

    it("compose une montée exacte de 6 niveaux (chaîne) et une chute raide de 6 niveaux", () => {
        const up = slopeRun(table, lrc, 0, 96, { steep: false, chain: true })!;
        expect(up.reduce((z, s) => z + s.endZ - s.beginZ, 0)).toBe(96);
        const down = slopeRun(table, lrc, 0, -96, { steep: true, chain: false })!;
        expect(down.reduce((z, s) => z + s.endZ - s.beginZ, 0)).toBe(-96);
        expect(down.some((s) => s.endSlope === PITCH.down60)).toBe(true);
        expect(down.length).toBeLessThan(up.length);
    });

    it("fait une chute franche de 21 niveaux en bois, sans palier en escalier (LongBase)", () => {
        const wooden = rideTrackInfo(rideTypeByName("wooden_roller_coaster"))!;
        const down = slopeRun(table, wooden, 0, -21 * 16, { steep: true, chain: false })!;
        expect(down.reduce((z, s) => z + s.endZ - s.beginZ, 0)).toBe(-21 * 16);
        expect(down.slice(0, -1).every((s) => s.endSlope !== PITCH.flat)).toBe(true);
        expect(down.reduce((n, s) => n + s.elements.length, 0)).toBeLessThanOrEqual(9);
        expect(down.filter((s) => s.endSlope === PITCH.down60 && s.beginSlope === PITCH.down60).length).toBeGreaterThanOrEqual(3);
    });

    it("compile un plan de macros avec transitions automatiques", () => {
        const start: TrackPose = { x: 40, y: 40, z: 64, rot: 2, slope: 0, bank: 0 };
        const r = compileMacros(table, lrc, start, [
            { op: "straight", length: 2 },
            { op: "lift", height: 8 },
            { op: "turn", dir: "right", banked: true },
            { op: "drop", height: 6, steep: true },
            { op: "loop", dir: "left" },
            { op: "helix", dir: "left", quarters: 2 },
            { op: "level" },
        ]);
        expect(r.errors).toEqual([]);
        expect(r.end.slope).toBe(0);
        expect(r.end.bank).toBe(0);
        expect(r.pieces.filter((p) => p.chain).length).toBeGreaterThan(5);
        expect(r.pieces.some((p) => p.name === "flatToRightBank")).toBe(true);
    });

    it("signale une pièce indisponible pour le type d'attraction", () => {
        const junior = rideTrackInfo(rideTypeByName("junior_roller_coaster"))!;
        const r = compileMacros(table, junior, { x: 10, y: 10, z: 64, rot: 0, slope: 0, bank: 0 }, [{ op: "loop", dir: "left" }]);
        expect(r.errors.length).toBe(1);
    });

    it("refuse les pièces que le style de piste ne dessine pas (Iron Canyon : diagUp60ToFlat invisible en bois)", () => {
        const wooden = rideTrackInfo(rideTypeByName("wooden_roller_coaster"))!;
        const bySegName = (n: string) => table.all().find((s) => s.type === TRACK_ELEM_TYPES[n as keyof typeof TRACK_ELEM_TYPES])!;
        for (const n of ["diagUp60ToFlat", "diagFlatToDown60", "diagDown60ToFlatLongBase", "diagFlatToUp60LongBase"]) {
            expect(pieceAllowed(wooden, bySegName(n)), n).toBe(false);
        }
        for (const n of ["diagUp60ToUp25", "diagDown25ToDown60", "down60ToFlatLongBase", "diagFlatToUp25"]) {
            expect(pieceAllowed(wooden, bySegName(n)), n).toBe(true);
        }
        const catalog = new Set(searchCatalog(table, wooden, { diagonals: true, steep: true }).map((s) => s.type));
        expect(catalog.has(TRACK_ELEM_TYPES.diagDown60ToFlat)).toBe(false);
        expect(catalog.has(TRACK_ELEM_TYPES.diagDown60ToDown25)).toBe(true);
        // Virage incliné en pente : rangé dans slopeCurve, que la mine active, mais MineTrainCoaster.cpp ne le dessine pas.
        const mine = rideTrackInfo(rideTypeByName("mine_train_coaster"))!;
        expect(pieceAllowed(mine, bySegName("leftBankedQuarterTurn3TileUp25"))).toBe(false);
        expect(pieceAllowed(mine, bySegName("leftQuarterTurn3TilesUp25"))).toBe(true);
    });
});

describe("éléments de style (inversions, virages larges et raides)", () => {
    const twister = rideTrackInfo(rideTypeByName("twister_roller_coaster"))!;
    const start: TrackPose = { x: 40, y: 40, z: 64, rot: 2, slope: 0, bank: 0 };
    const names = (r: ReturnType<typeof compileMacros>) => r.pieces.map((p) => p.name);

    it("compile les inversions complètes, la plus grande taille par défaut", () => {
        const r = compileMacros(table, twister, start, [
            { op: "inversion", kind: "loop", dir: "right" },
            { op: "inversion", kind: "immelmann", dir: "left" },
            { op: "inversion", kind: "dive_loop", dir: "right" },
            { op: "inversion", kind: "corkscrew", dir: "left" },
            { op: "inversion", kind: "zero_g_roll", dir: "right" },
            { op: "inversion", kind: "barrel_roll", dir: "left" },
            { op: "level" },
        ]);
        expect(r.errors).toEqual([]);
        expect(names(r)).toContain("rightLargeHalfLoopUp");
        expect(names(r)).toContain("leftLargeHalfLoopDown");
        expect(names(r)).toContain("leftBarrelRollDownToUp");
        expect(names(r)).toContain("leftLargeCorkscrewUp");
        expect(names(r)).toContain("rightLargeCorkscrewDown");
        expect(names(r)).toContain("rightLargeZeroGRollUp");
        expect(r.end).toMatchObject({ slope: 0, bank: 0 });
        expect(layoutStats(table, r.pieces).inversions).toBe(6);
    });

    it("respecte une taille demandée et signale les inversions disponibles", () => {
        const small = compileMacros(table, twister, start, [{ op: "inversion", kind: "loop", dir: "left", size: "small" }]);
        expect(names(small)).toContain("leftVerticalLoop");
        const junior = rideTrackInfo(rideTypeByName("junior_roller_coaster"))!;
        const r = compileMacros(table, junior, start, [{ op: "inversion", kind: "corkscrew", dir: "left" }]);
        expect(r.errors[0].message).toMatch(/indisponible/);
        expect(availableInversions(table, twister).join(" ")).toMatch(/immelmann\(.*large/);
        expect(availableInversions(table, twister)).toContain("corkscrew(small/large)");
    });

    it("tourne large par la diagonale et en chute raide sur 1 tuile", () => {
        const large = compileMacros(table, twister, start, [{ op: "turn", dir: "left", banked: true, size: "large", quarters: 2 }, { op: "level" }]);
        expect(large.errors).toEqual([]);
        expect(names(large).filter((n) => /Eighth/.test(n)).length).toBe(4);
        expect(large.end.rot).toBe((start.rot + 2) & 3);
        const dive = compileMacros(table, twister, { ...start, z: 640 }, [{ op: "turn", dir: "right", slope: "steep_down", quarters: 2 }, { op: "level" }]);
        expect(dive.errors).toEqual([]);
        expect(names(dive)).toContain("rightQuarterTurn1TileDown60");
    });

    it("signale un lift en courbe et un virage serré à grande vitesse", () => {
        const r = compileMacros(table, twister, start, [
            { op: "piece", name: "flatToUp25", chain: true },
            { op: "piece", name: "leftQuarterTurn5TilesUp25", chain: true },
            { op: "lift", height: 14, steep: false },
            { op: "drop", height: 14, steep: true },
            { op: "turn", dir: "left", size: "small", banked: true, quarters: 2 },
        ]);
        expect(r.errors).toEqual([]);
        const w = planWarnings(table, r.pieces, start.z).join(" | ");
        expect(w).toMatch(/virage/);
        expect(w).toMatch(/serré/);
        // Après un frein de bloc, le même virage serré est pris lentement : pas d'alerte.
        const slow = compileMacros(table, twister, { ...start, z: 640 }, [{ op: "block_brakes" }, { op: "turn", dir: "left", size: "small", banked: true, slope: "down", quarters: 2 }]);
        expect(planWarnings(table, slow.pieces, 640 + 160).join(" ")).not.toMatch(/serré/);
    });

    it("décrit une séquence par groupes avec les hauteurs", () => {
        const r = compileMacros(table, twister, start, [{ op: "lift", height: 4 }]);
        expect(describeSequence(table, r.pieces, start.z)).toBe("flatToUp25⛓ L0→0.5, 3×up25⛓ L0.5→3.5, up25ToFlat⛓ L3.5→4");
    });
});

function rideTypeByName(name: string): number {
    for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === name) return t;
    return -1;
}

describe("fermeture du circuit", () => {
    it("referme un circuit après une montée et une chute", () => {
        const station: TrackPose = { x: 60, y: 60, z: 64, rot: 2, slope: 0, bank: 0 };
        const occ = new Occupancy();
        // Station de 4 pièces
        const stationSeg = table.byName("endStation")!;
        let pose = station;
        for (let i = 0; i < 4; i++) {
            const p = originAt(pose, stationSeg);
            occ.add(pieceElements(p, stationSeg));
            pose = endPose(p, stationSeg);
        }
        const plan = compileMacros(table, lrc, pose, [
            { op: "straight", length: 1 },
            { op: "lift", height: 6 },
            { op: "turn", dir: "left", banked: true },
            { op: "drop", height: 5 },
        ]);
        for (const p of plan.pieces) occ.add(pieceElements(p, table.require(p.type)));
        const cat = searchCatalog(table, lrc, { chainedClimbsOnly: true });
        const t0 = performance.now();
        const res = planClosure(cat, plan.end, station, occ, env, { zMin: 64 });
        const ms = performance.now() - t0;
        expect(res).not.toBeNull();
        // La dernière pièce aboutit exactement à l'entrée de la station.
        const last = res!.pieces[res!.pieces.length - 1];
        expect(poseKey(endPose(last, table.require(last.type)))).toBe(poseKey(station));
        expect(ms).toBeLessThan(5000);
    });
});

describe("dégagement réel des blocs (TrackPlaceAction)", () => {
    const at = (name: string, z: number) => {
        const seg = table.byName(name)!;
        return pieceElements({ type: seg.type, x: 10, y: 10, z, direction: 0 }, seg)[0];
    };

    it("une hélice basse passe 2 niveaux sous une droite, pas 1", () => {
        const occ = new Occupancy(24);
        occ.add([at("brakes", 20 * 16)]);
        // Bloc 0 de la demi-hélice : clearanceZ 4 + 24 → sommet 24 au-dessus de sa base.
        expect(at("rightHalfBankedHelixDownSmall", 18 * 16).cz).toBe(4);
        expect(occ.conflict([at("rightHalfBankedHelixDownSmall", 18 * 16)])).toBeNull();
        expect(occ.conflict([at("rightHalfBankedHelixDownSmall", 19 * 16)])).not.toBeNull();
    });

    it("une pente occupe plus de hauteur qu'une droite", () => {
        expect(blockSpan(at("up60", 0), 24)[1]).toBeGreaterThan(blockSpan(at("flat", 0), 24)[1]);
        expect(blockSpan(at("flat", 0), 24)).toEqual([0, 24]);
    });

    it("bloc vertical : dégagement plafonné à 24 au-dessus du bloc pour les véhicules hauts", () => {
        const b = { x: 0, y: 0, z: 0, cz: 32, vertical: true };
        expect(blockSpan(b, 40)).toEqual([0, 56]);
        expect(blockSpan({ ...b, vertical: undefined }, 40)).toEqual([0, 72]);
        expect(blocksClash(b, { ...b, z: 48 }, 40)).toBe(true);
        expect(blocksClash(b, { ...b, z: 64 }, 40)).toBe(false);
    });
});

describe("passage sous ou au-dessus d'une autre attraction", () => {
    // Autre attraction (ride 7) : une droite posée au niveau 10, dégagement réel jusqu'au niveau 11.5.
    const other: RegionTile = { ...flatTile, r: [7], rh: 11.5, ri: [[10, 11.5, 7]] };
    const e = (lvl: number) => ({ x: 10, y: 10, z: lvl * 16, cz: 0 });
    const envO: TrackEnv = { ...env, get: () => other, clearance: 24 };

    it("passe dessous si son dégagement finit sous la base de l'autre", () => {
        expect(blockProblem(envO, e(8.5))).toBeNull(); // [8.5, 10[
        expect(blockProblem(envO, e(9))).toBe("autre attraction");
    });

    it("passe dessus dès sa base au niveau du dégagement de l'autre", () => {
        expect(blockProblem(envO, e(11.5))).toBeNull();
        expect(blockProblem(envO, e(11))).toBe("autre attraction");
    });

    it("ignore ses propres pièces (contrôlées par Occupancy) et garde l'ancien refus sans ri", () => {
        expect(blockProblem({ ...envO, rideId: 7 }, e(10))).toBeNull();
        const old: RegionTile = { ...flatTile, r: [7], rh: 11.5 };
        expect(blockProblem({ ...envO, get: () => old }, e(8))).toBe("autre attraction");
    });
});
