import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateRatings, excitementShortfall, proximityFromPlan } from "../src/planners/estimate.js";
import { defaultVocabulary, searchSection, type SearchInput } from "../src/planners/search.js";
import { DEFAULT_MODEL, designTrain, simulate, trainLength } from "../src/planners/speed.js";
import { designDirs, designLayout, loadLibrary } from "../src/planners/td6.js";
import * as T from "../src/planners/track.js";
import { bwdEnv } from "./black-widow-diagonal.js";

const { Occupancy, SegmentTable, beginPose, compileMacros, layoutStats, pieceElements, rideClearance, rideTrackInfo, searchCatalog } = T;
const table = SegmentTable.fromFile() as InstanceType<typeof SegmentTable>;
let WOODEN = 0;
for (let t = 0; t < 120; t++) if (rideTrackInfo(t)?.name === "wooden_roller_coaster") WOODEN = t;
const wooden = rideTrackInfo(WOODEN)!;

describe("notes estimées avant essai", () => {
    const dirs = designDirs(process.env.OPENRCT2_USER_DIR ?? join(homedir(), ".config", "OpenRCT2"));
    const hasLibrary = dirs.some((d) => existsSync(d));

    it.skipIf(!hasLibrary)("designs RCT2 : longueur et vitesse exactes, intensité à 0,1 près, excitation prudente (scénerie non comptée)", () => {
        const err: number[] = [];
        const ierr: number[] = [];
        const lenErr: number[] = [];
        for (const e of loadLibrary(dirs)) {
            const td = e.design;
            if (!td || ![1, 34].includes(td.rideMode)) continue;
            const l = designLayout(td, table, { x: 40, y: 40, z: 160 }, 0);
            if (!l.closed || l.unknownPieces.length) continue;
            const env: T.TrackEnv = { get: () => ({ h: 10, s: 0, w: 0, t: 0, o: 3 }), rideId: -1, sandbox: true, mapSize: { x: 300, y: 300 } };
            const est = estimateRatings({ table, rideType: td.rideType, pieces: l.pieces, train: designTrain(td), vehicleObject: td.vehicleObject, liftHillSpeed: td.liftHillSpeed, env, carsPerTrain: td.carsPerTrain });
            if (!est) continue;
            lenErr.push(Math.abs(est.lengthM - td.stats.rideLengthM) / td.stats.rideLengthM);
            err.push(est.excitement - td.stats.excitement);
            ierr.push(Math.abs(est.intensity - td.stats.intensity));
        }
        expect(err.length).toBeGreaterThan(100);
        const med = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
        expect(med(ierr)).toBeLessThan(0.1);
        // Longueur : à 5 % près pour 90 % des designs (Splashtastic : 404 m contre 424 ; la médiane est à moins de 1 %).
        expect(lenErr.filter((x) => x > 0.05).length / lenErr.length, "longueur").toBeLessThan(0.1);
        // Prudente : en moyenne sous le jeu (scénerie des designs absente), rarement au-dessus.
        expect(err.reduce((a, b) => a + b, 0) / err.length).toBeLessThan(0);
        expect(err.filter((x) => x > 0.3).length / err.length, "surestimées").toBeLessThan(0.05);
        expect(med(err.map(Math.abs)), "écart médian").toBeLessThan(0.7);
    });

    it("proximité : piste empilée sur elle-même et au ras du sol comptées comme le jeu", () => {
        const start: T.TrackPose = { x: 40, y: 40, z: 7 * 16, rot: 2, slope: 0, bank: 0 };
        const r = compileMacros(table, wooden, start, [
            { op: "straight", length: 2 },
            { op: "climb", height: 4 },
            { op: "helix", dir: "left", quarters: 4, down: true, size: "small" },
        ]);
        expect(r.errors).toEqual([]);
        const env: T.TrackEnv = { get: () => ({ h: 7, s: 0, w: 0, t: 0, o: 1 }), rideId: 1, sandbox: true, mapSize: { x: 154, y: 154 } };
        const p = proximityFromPlan(table, r.pieces, env, rideClearance(WOODEN));
        expect(p.surfaceTouch).toBeGreaterThan(0);
        expect(p.ownTrackCloseAbove + p.ownTrackTouchAbove).toBeGreaterThan(0);
    });

    it("excitementShortfall : écart, pénalités et leviers ; rien si l'objectif est atteint", () => {
        const e = { excitement: 6.2, intensity: 7, nausea: 4, lengthM: 300, maxKmh: 80, avgKmh: 20, seconds: 60, terms: [{ term: "requirementLength", E: -2.5, I: -2, input: "longueur < 370 m" }], levers: [{ lever: "+100 m de piste", E: 0.4, I: 0 }] };
        expect(excitementShortfall(e, 7.5)).toMatch(/6\.20 < 7\.5.*requirementLength.*\+100 m de piste/);
        expect(excitementShortfall(e, 6)).toBeNull();
    });
});

/**
 * Black Widow Diagonal (Haiku, 9 octobre 2026), relevé du site dans black-widow-diagonal.ts : station en (60,98) vers +x,
 * lift de 22, petit virage, chute raide de 22, virage medium incliné vers −x au-dessus du lac. Haiku y posait ensuite
 * 6 freins et un frein de bloc au sol, puis 3 recherches sans fin avec la référence Trinity (3 inversions imposées).
 */
describe("recherche avec excitation minimale (Black Widow Diagonal)", () => {
    const station: T.Macro[] = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"].map((name) => ({ op: "piece", name }));
    const opening: T.Macro[] = [...station, { op: "lift", height: 22, steep: false }, { op: "turn", dir: "right", size: "small", quarters: 1 }, { op: "drop", height: 22, steep: true }, { op: "turn", dir: "right", size: "medium", quarters: 1, banked: true }];
    const train = designTrain({ vehicleObject: "rct2.ride.mft", carsPerTrain: 12, rideType: WOODEN })!;
    const model = { ...DEFAULT_MODEL, rideType: WOODEN };
    const search = (plan: T.Macro[], over: Partial<SearchInput>) => {
        const r = compileMacros(table, wooden, { x: 60, y: 98, z: 112, rot: 2, slope: 0, bank: 0 }, plan);
        expect(r.errors).toEqual([]);
        const occ = new Occupancy(rideClearance(WOODEN));
        for (const p of r.pieces) occ.add(pieceElements(p, table.require(p.type)));
        return searchSection({
            table,
            ride: wooden,
            prefix: r.pieces,
            start: r.end,
            goal: beginPose(r.pieces[0], table.require(r.pieces[0].type)),
            occupancy: occ,
            env: bwdEnv,
            bounds: { x1: 53, y1: 80, x2: 90, y2: 101 },
            closureCatalog: searchCatalog(table, wooden, { steep: true, diagonals: true }),
            speedOf: (p, v) => simulate(model, table, p, v, train),
            simulateCircuit: (p) => simulate(model, table, p, model.stationSpeed, train),
            simulateFrom: (p, v, s) => simulate(model, table, p, v, train, { startPiece: s }),
            judge: () => [],
            vStart: simulate(model, table, r.pieces, model.stationSpeed, train).at(-1)!.vOut,
            // 100 et non 130 : sans diagUp60ToFlat ni diagDown60ToFlat (invisibles en bois, SPEC F37), les collines diagonales
            // raides sont plus longues et les fins de 130 tuiles ne se referment plus dans ce site entre le lac et les chemins.
            minTiles: Math.max(layoutStats(table, r.pieces).lengthTiles + 10, 100),
            maxTiles: 330,
            minTrains: 3,
            trainTiles: trainLength(train),
            vocabulary: defaultVocabulary(),
            timeMs: 60_000,
            results: 1,
            estimate: (all) => estimateRatings({ table, rideType: WOODEN, pieces: all, train, vehicleObject: "rct2.ride.mft", env: bwdEnv, carsPerTrain: train.cars }),
            ...over,
        });
    };

    // Suivis d'un frein de bloc, les freins prennent la plus grande des deux consignes (chooseBrakeSpeed) : ~35 km/h, le
    // train roule encore. Seuls, à la consigne 2, ils le laissent au pas.
    it("freins lents au sol après la chute : DÉBUT SANS ÉLAN, sans lancer le faisceau", () => {
        const res = search([...opening, { op: "brakes", length: 6, speed: 2 }], {});
        expect(res.deadStart).toMatch(/élan ne porte le train/);
        expect(res.expansions).toBe(0);
    });

    it("sans les freins, trouve une fin à 3 trains dont l'excitation estimée dépasse le minimum", () => {
        const res = search(opening, { minExcitement: 6.6, targetExcitement: 7 });
        expect(res.candidates.length).toBeGreaterThan(0);
        const c = res.candidates[0];
        expect(c.layout.blocks.maxTrains).toBeGreaterThanOrEqual(3);
        expect(c.estimate!.excitement).toBeGreaterThanOrEqual(6.6);
    }, 90_000);

    it("un minimum hors d'atteinte écarte les fins et donne la meilleure excitation estimée", () => {
        // 20 s : le premier circuit fermé arrive vers 5 s seul, plus tard quand toute la suite tourne en parallèle.
        const res = search(opening, { minExcitement: 9.5, timeMs: 20_000 });
        expect(res.candidates).toEqual([]);
        expect(Object.keys(res.rejected).some((k) => /excitation estimée/.test(k))).toBe(true);
        expect(res.bestRejectedExcitement).toBeGreaterThan(5);
    }, 45_000);
});
