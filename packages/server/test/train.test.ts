import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    DEFAULT_MODEL,
    SPACING_PER_TILE,
    blockSpacing,
    brakeRuns,
    dragK2,
    fitModel,
    simulate,
    trainLength,
    trainShape,
    composeTrain,
    designTrain,
    rideVehicleObject,
    DEFAULT_TRAIN,
    SpeedModels,
    type TrainObject,
    type MeasuredPiece,
    type SpeedModel,
    type TrainShape,
} from "../src/planners/speed.js";
import { designLayout, parseTrackDesign } from "../src/planners/td6.js";
import { SegmentTable, compileMacros, endPose, rideTrackInfo, type PlannedPiece, type TrackPose } from "../src/planners/track.js";

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

describe("placement des freins de bloc", () => {
    // Sonnet, « Black Colossus » : deux freins de bloc à mi-parcours, l'un après l'autre, et des freins simples en gare.
    const course = [
        { op: "lift", height: 10 },
        { op: "straight", length: 2 },
        { op: "block_brakes" },
        { op: "drop", height: 4 },
        { op: "straight", length: 3 },
        { op: "block_brakes" },
        { op: "drop", height: 6 },
        { op: "straight", length: 40 },
    ] as const;

    it("signale deux freins de bloc proches et l'absence de frein de bloc sur le plat d'arrivée", () => {
        const c = circuitWith([...course, { op: "brakes", length: 4 }]);
        const sp = blockSpacing(table, c, { closed: true, trainTiles: 4.4 });
        expect(sp.close).toHaveLength(1);
        expect(c[sp.close[0].first].name).toBe("blockBrakes");
        expect(sp.noStationBlock?.brakes).toHaveLength(4);
        expect(sp.noStationBlock?.lastBoundary).toEqual({ kind: "block", index: sp.close[0].second });
    });

    it("se tait avec un frein de bloc à mi-parcours et un au bout des freins d'arrivée", () => {
        const c = circuitWith([...course.slice(0, 3), ...course.slice(6), { op: "brakes", length: 3 }, { op: "block_brakes" }]);
        const sp = blockSpacing(table, c, { closed: true, trainTiles: 4.4 });
        expect(sp.close).toEqual([]);
        expect(sp.noStationBlock).toBeUndefined();
    });

    it.skipIf(!existsSync(FRIGHTMARE))("RCT2 : Frightmare, Black Widow, Medusa (deux freins de bloc en arrivée de gare) ne disent rien", () => {
        for (const f of ["Frightmare.TD6", "Black Widow.TD6", "Medusa.TD6"]) {
            const pieces = designLayout(parseTrackDesign(readFileSync(FRIGHTMARE.replace("Frightmare.TD6", f)), f), table, { x: 0, y: 0, z: 0 }, 0).pieces;
            const sp = blockSpacing(table, pieces, { closed: true, trainTiles: 4 });
            expect([f, sp.close, sp.noStationBlock]).toEqual([f, [], undefined]);
        }
    });

    it("circuit ouvert : seuil relatif seulement avec une longueur visée", () => {
        const c = circuitWith(course.slice(0, 6));
        expect(blockSpacing(table, c, { closed: false, trainTiles: 4.4 }).close).toEqual([]);
        expect(blockSpacing(table, c, { closed: false, trainTiles: 4.4, expectedTiles: 200 }).close).toHaveLength(1);
    });
});

/** Station de 6 tuiles de montagnes russes en bois vers +x, puis le plan. */
function circuitWith(plan: Parameters<typeof compileMacros>[3]): PlannedPiece[] {
    const names = ["beginStation", "middleStation", "middleStation", "middleStation", "middleStation", "endStation"];
    const station = names.map((n, i) => ({ type: table.byName(n)!.type, x: 40 + i, y: 40, z: 14 * 16, direction: 2 as const, name: n }));
    const c = compileMacros(table, rideTrackInfo(52)!, endPose(station[5], table.require(station[5].type)), plan);
    expect(c.errors).toEqual([]);
    return [...station, ...c.pieces];
}

describe("train réel de l'objet (Ride::UpdateMaxVehicles)", () => {
    const mft = rideVehicleObject("rct2.ride.mft")!;
    const wooden = 52;

    it("data/ride_vehicles.json porte les voitures des objets, par identifiant et nom DAT", () => {
        expect(mft).toBeDefined();
        expect(rideVehicleObject("MFT")).toEqual(mft);
        expect(mft.vehicles).toEqual([
            { spacing: 174320, carMass: 350 },
            { spacing: 122024, carMass: 290 },
        ]);
        expect([mft.front, mft.defaultCar, mft.minCars, mft.maxCars]).toEqual([0, 1, 6, 12]);
    });

    it("compose le train : voiture de tête puis voitures par défaut, à vide", () => {
        const t = composeTrain(mft, { stationTiles: 6, rideType: wooden, mode: 1 })!;
        expect(t.cars).toBe(12);
        expect(t.mass).toBe(350 + 11 * 290);
        expect(t.carLength * t.cars * SPACING_PER_TILE).toBeCloseTo(174320 + 11 * 122024, 0);
    });

    it("borne les voitures par la station (marge des sections de bloc) et garde le minimum de l'objet", () => {
        // 5 tuiles − 0x16B2A = 1 300 566 : tête + 9 voitures (1 272 536) passent, pas une 11e.
        expect(composeTrain(mft, { stationTiles: 5, rideType: wooden, mode: 34 })!.cars).toBe(10);
        expect(composeTrain(mft, { stationTiles: 1, rideType: wooden, mode: 1 })!.cars).toBe(6);
        expect(composeTrain(mft, { stationTiles: 6, rideType: wooden, mode: 1, wantedCars: 8 })!.cars).toBe(8);
    });

    it("borne les voitures par la masse maximale du type (MaxMass << 8)", () => {
        const heavy: TrainObject = { ...mft, vehicles: [{ spacing: 100000, carMass: 1000 }], front: 255, defaultCar: 0, minCars: 1, maxCars: 10 };
        // Montagnes russes en bois : MaxMass 19 → 4864, donc 4 voitures de 1000.
        expect(composeTrain(heavy, { stationTiles: 10, rideType: wooden })!.cars).toBe(4);
    });

    it("un design .td6 prend son véhicule : Black Widow (MFT, 7 voitures) pèse 2090, pas 7 × 632", () => {
        const t = designTrain({ vehicleObject: "MFT     ", carsPerTrain: 7, rideType: wooden })!;
        expect(t.mass).toBe(350 + 6 * 290);
        expect(designTrain({ vehicleObject: "INCONNU", carsPerTrain: 7, rideType: wooden })!.mass).toBe(DEFAULT_TRAIN.mass);
    });

    it("le train de bois léger perd plus de vitesse que le train par défaut (traînée quadratique ÷ masse)", () => {
        const plan = circuitWith([{ op: "lift", height: 14 }, { op: "drop", height: 12 }, { op: "hill", height: 8 }, { op: "hill", height: 6 }]);
        const model = new SpeedModels(null).get(wooden);
        const light = simulate(model, table, plan, model.stationSpeed, composeTrain(mft, { stationTiles: 6, rideType: wooden }));
        const heavy = simulate(model, table, plan, model.stationSpeed, DEFAULT_TRAIN);
        const last = plan.length - 1;
        expect(light[last].vIn).toBeLessThan(heavy[last].vIn - 1);
    });
});
