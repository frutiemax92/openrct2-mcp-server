import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    DEFAULT_MODEL,
    SPACING_PER_TILE,
    brakeRuns,
    dragK2,
    fitModel,
    simulate,
    trainLength,
    trainShape,
    type MeasuredPiece,
    type SpeedModel,
    type TrainShape,
} from "../src/planners/speed.js";
import { designLayout, parseTrackDesign } from "../src/planners/td6.js";
import { SegmentTable, compileMacros, rideTrackInfo, type TrackPose } from "../src/planners/track.js";

const table = SegmentTable.fromFile() as SegmentTable;
const twister = rideTrackInfo(51)!;
const FRIGHTMARE = "/home/lucas/snap/steam/common/.local/share/Steam/steamapps/common/Rollercoaster Tycoon 2/Tracks/Frightmare.TD6";
const start: TrackPose = { x: 40, y: 40, z: 14 * 16, rot: 2, slope: 0, bank: 0 };
const frightmare = () => designLayout(parseTrackDesign(readFileSync(FRIGHTMARE), "Frightmare.TD6"), table, { x: 0, y: 0, z: 0 }, 0).pieces;

// Train fictif : 8 voitures de 0,55 tuile, 1000 unités de masse chacune.
const car = { mass: 1000, spacing: Math.round(0.55 * SPACING_PER_TILE), carMass: 1000 };
const eight = trainShape(Array.from({ length: 8 }, () => car))!;
const model: SpeedModel = { ...DEFAULT_MODEL, massRef: eight.mass };

describe("train : forme", () => {
    it("longueur = somme des espacements / longueur d'une tuile de station, masse = somme des masses", () => {
        expect(eight.cars).toBe(8);
        expect(trainLength(eight)).toBeCloseTo(4.4, 3);
        expect(eight.mass).toBe(8000);
        expect(trainShape([])).toBeUndefined();
    });

    it("k2 effectif : divisé par la masse, rapporté à la masse de calage", () => {
        const four: TrainShape = { cars: 4, carLength: 0.55, mass: 4000 };
        expect(dragK2(model, eight)).toBeCloseTo(model.k2, 9);
        expect(dragK2(model, four)).toBeCloseTo(model.k2 * 2, 9);
        // Sans masse de calage, k2 n'est pas rapporté (anciens fichiers de calage).
        expect(dragK2(DEFAULT_MODEL, four)).toBe(DEFAULT_MODEL.k2);
    });
});

describe("train : simulation", () => {
    it.skipIf(!existsSync(FRIGHTMARE))("une voiture de longueur nulle à la masse de calage redonne le modèle ponctuel", () => {
        const pieces = frightmare();
        const point = simulate(model, table, pieces, model.stationSpeed);
        const one = simulate(model, table, pieces, model.stationSpeed, { cars: 1, carLength: 0, mass: model.massRef! });
        one.forEach((s, i) => {
            expect(s.vIn).toBeCloseTo(point[i].vIn, 6);
            expect(s.stall).toBe(point[i].stall);
        });
    });

    it.skipIf(!existsSync(FRIGHTMARE))("à voitures égales, un train plus court perd sa vitesse plus vite", () => {
        const pieces = frightmare();
        const v = (t: TrainShape) => simulate(model, table, pieces, model.stationSpeed, t);
        const long = v(eight);
        const short = v({ cars: 4, carLength: 0.55, mass: 4000 });
        expect(long.some((s) => s.stall)).toBe(false);
        // Après la première chute (vitesse max), puis sur toute la seconde moitié, le train court est plus lent.
        const bottom = long.findIndex((s) => s.vOut === Math.max(...long.map((x) => x.vOut)));
        const late = (sim: typeof long) => sim.slice(bottom + 10, pieces.length - 6).reduce((a, s) => a + s.vIn, 0);
        expect(late(short)).toBeLessThan(late(long));
    });

    it("un train long passe le sommet d'une colline plus vite que sa tête seule (il s'y étale)", () => {
        const plan = compileMacros(table, twister, start, [{ op: "straight", length: 6 }, { op: "hill", height: 4, steep: false }, { op: "straight", length: 4 }]);
        const vMin = (t?: TrainShape) => Math.min(...simulate(model, table, plan.pieces, 30, t).map((s) => s.vMin));
        const point = vMin({ cars: 1, carLength: 0, mass: eight.mass });
        expect(vMin(eight)).toBeGreaterThan(point);
    });

    it("la chaîne tire le train tant qu'une voiture y est : pas de calage en haut du lift", () => {
        const plan = compileMacros(table, twister, start, [{ op: "lift", height: 12, steep: false }, { op: "straight", length: 2 }, { op: "drop", height: 12, steep: false }]);
        const sim = simulate(model, table, plan.pieces, model.stationSpeed, eight);
        expect(sim.some((s) => s.stall)).toBe(false);
    });

    describe("calage avec le train de l'essai", () => {
        const plan = compileMacros(table, twister, start, [
            { op: "lift", height: 14, steep: false },
            { op: "drop", height: 14, steep: false },
            { op: "turn", dir: "left", size: "medium", banked: true },
            { op: "hill", height: 3 },
            { op: "turn", dir: "left", size: "medium", banked: true },
            { op: "straight", length: 8 },
        ]);
        const four: TrainShape = { cars: 4, carLength: 0.55, mass: 4000 };
        // Vérité : K et k2 sur la grille de fitModel ; « mesures » = simulation du train de 4 voitures avec ce modèle.
        const truthModel: SpeedModel = { ...model, K: 170, k1: 0.15, k2: 0.0015, invExtra: 0 };
        const truth = simulate(truthModel, table, plan.pieces, truthModel.stationSpeed, four);
        const measured: MeasuredPiece[] = plan.pieces.map((piece, i) => ({
            piece,
            sample: { x: 0, y: 0, z: 0, direction: 0, trackType: piece.type, n: 1, vFirst: truth[i].vIn, vMin: truth[i].vMin, vMax: truth[i].vOut, gVertMax: 0, gVertMin: 0, gLatMax: 0 },
        }));

        it("un modèle précédent qui reproduit déjà les mesures (rapporté à ce train) est gardé, avec sa masse de calage", () => {
            const prior = { ...truthModel, samples: 3 };
            expect(fitModel(table, measured, prior, four)).toBe(prior);
        });

        it("sinon le k2 calé se rapporte à la masse du train de l'essai (massRef)", () => {
            const fitted = fitModel(table, measured, { ...truthModel, k2: 0, samples: 0 }, four);
            expect(fitted.massRef).toBe(4000);
            // Le train de 4 voitures subit une traînée quadratique double de celle du train de calage (8000).
            expect(fitted.k2).toBeCloseTo(0.003, 4);
            expect(dragK2(fitted, eight)).toBeCloseTo(0.0015, 4);
        });
    });
});

describe("sections de freins", () => {
    it.skipIf(!existsSync(FRIGHTMARE))("Frightmare : 4 tuiles au frein de bloc de mi-parcours, 2 avant la station", () => {
        const runs = brakeRuns(table, frightmare());
        expect(runs.map((r) => ({ tiles: r.tiles, beforeStation: r.beforeStation }))).toEqual([
            { tiles: 4, beforeStation: false },
            { tiles: 2, beforeStation: true },
        ]);
    });
});
