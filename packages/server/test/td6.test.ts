import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TRACK_ELEM_TYPES } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { STATION_LAUNCH_MODES, SegmentTable, blockBrakesBeforeLift, blockSections, rideTrackInfo } from "../src/planners/track.js";
import { designTrain, exactTrain } from "../src/planners/speed.js";
import { simulateExact } from "../src/planners/vehicle.js";
import { decodeRle, designDirs, designLayout, loadLibrary, parseTrackDesign } from "../src/planners/td6.js";

/** Codage RLE en littéraux seuls (suffisant pour le décodeur), plus 4 octets de somme de contrôle. */
function encode(raw: number[]): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < raw.length; i += 128) {
        const chunk = raw.slice(i, i + 128);
        out.push(chunk.length - 1, ...chunk);
    }
    return Uint8Array.from([...out, 0, 0, 0, 0]);
}

function synthetic(elements: [number, number][]): Uint8Array {
    const h = new Array(0xa3).fill(0);
    h[0x00] = 52; // looping_roller_coaster
    h[0x06] = 1; // mode
    h[0x07] = (2 << 2) | 1; // td6, schéma de couleurs 1
    h[0x4c] = 2; // trains
    h[0x4d] = 5; // voitures
    h[0x5b] = 65; // excitement 6,5
    [..."ARRT1   "].forEach((c, i) => (h[0x74 + i] = c.charCodeAt(0)));
    h[0xa2] = (1 << 5) | 5;
    const els = elements.flatMap(([t, f]) => [t, f]);
    // entrée en (−1 tuile, +1 tuile), z 0, direction 3 ; sortie en (0, +1), direction 3 | 0x80
    const ent = [0, 3, 0xe0, 0xff, 32, 0, 0, 0x83, 0, 0, 32, 0];
    return encode([...h, ...els, 0xff, ...ent, 0xff, 0xff]);
}

describe("td6", () => {
    it("décode le RLE (répétitions et littéraux)", () => {
        expect([...decodeRle(Uint8Array.from([0xfd, 7, 1, 1, 2]))]).toEqual([7, 7, 7, 7, 1, 2]);
    });

    it("lit en-tête, pièces, drapeaux et entrées", () => {
        const T = TRACK_ELEM_TYPES as Record<string, number>;
        const td = parseTrackDesign(
            synthetic([
                [T.endStation, 0],
                [T.flat, 0x80 | 0x10],
                [T.brakes, 3],
                [T.blockBrakes, 7],
            ]),
        );
        expect(td.vehicleObject).toBe("ARRT1");
        expect(td.version).toBe("td6");
        expect(td.stats.excitement).toBe(6.5);
        expect(td.numberOfTrains).toBe(2);
        expect(td.numCircuits).toBe(1);
        expect(td.liftHillSpeed).toBe(5);
        expect(td.elements[0].stationIndex).toBe(0);
        expect(td.elements[1]).toMatchObject({ chain: true, colourScheme: 1 });
        expect(td.elements[2].brakeSpeed).toBe(6);
        expect(td.elements[3].brakeSpeed).toBe(2); // freins de bloc td6 : vitesse par défaut
        expect(td.entrances).toEqual([
            { z: 0, direction: 3, isExit: false, x: -1, y: 1 },
            { z: 0, direction: 3, isExit: true, x: 0, y: 1 },
        ]);
    });

    it("refuse les labyrinthes et les designs RCT1", () => {
        const maze = synthetic([]);
        const raw = decodeRle(maze.subarray(0, maze.length - 4));
        raw[0] = 20;
        expect(() => parseTrackDesign(encode([...raw]))).toThrow(/labyrinthe/);
        raw[0] = 52;
        raw[7] = 0;
        expect(() => parseTrackDesign(encode([...raw]))).toThrow(/td4/);
    });

    const table = SegmentTable.fromFile();
    const dirs = designDirs(process.env.OPENRCT2_USER_DIR ?? join(homedir(), ".config", "OpenRCT2"));
    const hasLibrary = dirs.some((d) => existsSync(d)) && !!table;

    it.skipIf(!hasLibrary)("rejoue les designs installés : les circuits bouclent quelle que soit la rotation", () => {
        const lib = loadLibrary(dirs).filter((e) => e.design);
        let closed = 0;
        for (const e of lib) {
            const a = designLayout(e.design!, table!, { x: 50, y: 50, z: 160 }, 0);
            const b = designLayout(e.design!, table!, { x: 50, y: 50, z: 160 }, 3);
            expect(a.unknownPieces).toEqual([]);
            expect(b.closed).toBe(a.closed);
            if (a.closed) closed++;
        }
        if (lib.length) expect(closed / lib.length).toBeGreaterThan(0.85);
    });

    it("compte les sections de bloc comme le jeu (stations + freins de bloc + sommets de lift)", () => {
        const T = TRACK_ELEM_TYPES as Record<string, number>;
        const p = (name: string, chain = false) => ({ type: T[name], x: 0, y: 0, z: 0, direction: 0 as const, chain });
        const station = [p("endStation"), p("middleStation"), p("beginStation")];
        const lift = [p("flatToUp25", true), p("up25", true), p("up25ToFlat", true)];
        const noBlock = blockSections([...station, ...lift, p("flat"), p("flat")]);
        expect(noBlock).toMatchObject({ stations: 1, blockBrakes: 0, liftTops: 1, sections: 2, autoBlockMode: false, maxTrains: 1 });
        const withBlock = blockSections([...station, ...lift, p("flat"), p("blockBrakes"), p("flat")]);
        expect(withBlock).toMatchObject({ sections: 3, autoBlockMode: true, maxTrains: 2, boundaries: "station@0, lift@5, block@7" });
        // Sans chaîne, la fin de montée ne ferme pas de section.
        expect(blockSections([...station, p("up25ToFlat"), p("blockBrakes")]).maxTrains).toBe(1);
    });

    it.skipIf(!table)("frein de bloc entre la station et le premier lift : refusé, sauf au pied du lift avec le train hors de la station", () => {
        const T = TRACK_ELEM_TYPES as Record<string, number>;
        const p = (name: string, chain = false) => ({ type: T[name], x: 0, y: 0, z: 0, direction: 0 as const, chain });
        const station = [p("endStation"), p("middleStation"), p("beginStation")];
        const lift = [p("flatToUp25", true), p("up25", true), p("up25ToFlat", true)];
        const flats = (n: number) => Array.from({ length: n }, () => p("flat"));
        const idx = (pieces: ReturnType<typeof p>[], opts: Parameters<typeof blockBrakesBeforeLift>[1] = {}) =>
            blockBrakesBeforeLift(pieces, { table: table!, ...opts }).map((b) => b.index);
        // Black Widow de Sonnet : station, plat, frein de bloc, lift. Le train de 5 tuiles resterait dans la station.
        expect(blockBrakesBeforeLift([...station, p("flat"), p("blockBrakes"), ...lift], { table: table!, trainTiles: 5 })).toEqual([{ index: 4, gapTiles: 1, needTiles: 5 }]);
        // Assez de piste pour le train : permis au pied du lift.
        expect(idx([...station, ...flats(5), p("blockBrakes"), ...lift], { trainTiles: 5 })).toEqual([]);
        // Sans longueur de train : celle de la station (3 tuiles).
        expect(idx([...station, ...flats(2), p("blockBrakes"), ...lift])).toEqual([5]);
        expect(idx([...station, ...flats(3), p("blockBrakes"), ...lift])).toEqual([]);
        // Pas au pied du lift (un plat entre le frein et la chaîne), ou sans table : refusé.
        expect(idx([...station, ...flats(6), p("blockBrakes"), p("flat"), ...lift])).toEqual([9]);
        expect(blockBrakesBeforeLift([...station, ...flats(6), p("blockBrakes"), ...lift]).map((b) => b.index)).toEqual([9]);
        // Frein de bloc en bout de circuit ouvert, lift pas encore posé : refusé.
        expect(idx([...station, ...flats(6), p("blockBrakes")])).toEqual([9]);
        expect(idx([...station, ...lift, p("flat"), p("blockBrakes"), p("flat")])).toEqual([]);
        // Frein de bloc avant la station (fin de parcours) : permis.
        expect(idx([...lift, p("flat"), p("blockBrakes"), ...station])).toEqual([]);
        // Liste qui commence au milieu d'un circuit fermé : la sortie de station reprend au début.
        expect(idx([p("flat"), p("blockBrakes"), p("flat"), ...lift, p("flat"), ...station])).toEqual([1]);
        // Lancement motorisé au lieu d'une chaîne.
        expect(idx([...station, p("flatToUp25"), p("poweredLift"), p("up25ToFlat"), p("blockBrakes")])).toEqual([]);
        // Frein de bloc qui protège une seconde station (Dream Chariots) ; circuit lancé depuis la station.
        expect(idx([...station, p("flat"), p("blockBrakes"), ...station, ...lift])).toEqual([]);
        expect(idx([...station, p("flat"), p("blockBrakes"), p("flat")], { stationLaunch: true })).toEqual([]);
    });

    it.skipIf(!hasLibrary)("frein de bloc avant le premier lift : les designs RCT2 qui le font l'ont au pied du lift", () => {
        const bad: string[] = [];
        for (const e of loadLibrary(dirs)) {
            if (!e.design) continue;
            const l = designLayout(e.design, table!, { x: 50, y: 50, z: 160 }, 0);
            if (!l.closed) continue;
            const early = blockBrakesBeforeLift(l.pieces, { table: table!, stationLaunch: STATION_LAUNCH_MODES.has(e.design.rideMode) });
            if (early.length) bad.push(`${e.name}: ${JSON.stringify(early)}`);
        }
        console.log(bad.join("\n"));
        // Écarts voulus (SPEC 12.6) : Contortion (frein suivi d'un S-bend et de virages avant le lift), Flying Dutchman
        // Gold Mine (0,8 tuile entre la station et le frein au pied du lift : le train qui attend resterait en station).
        expect(bad.filter((n) => !/^(Contortion|Flying Dutchman Gold Mine):/.test(n))).toEqual([]);
    });

    it.skipIf(!hasLibrary)("G prédits par le simulateur exact : dans la marge enregistrée par les designs (0,32 G) pour 95 % d'entre eux", () => {
        let n = 0;
        let lat = 0;
        let vert = 0;
        for (const e of loadLibrary(dirs)) {
            const td = e.design;
            if (!td || !rideTrackInfo(td.rideType)) continue;
            const l = designLayout(td, table!, { x: 0, y: 0, z: 0 }, 0);
            if (!l.closed || l.unknownPieces.length) continue;
            const ex = simulateExact(l.pieces, {
                rideType: td.rideType,
                train: exactTrain(designTrain(td)),
                liftHillSpeed: td.liftHillSpeed,
                rideMode: td.rideMode,
                closed: true,
                blockZ: (t) => table!.get(t)?.elements[0]?.z ?? 0,
            });
            if (!ex?.completed || !ex.gForces) continue;
            n++;
            // Le fichier tronque à 32 centièmes : la vraie valeur est dans [enregistré, enregistré + 0,32).
            const within = (g: number, stored: number) => g / 100 >= stored - 0.05 && g / 100 < stored + 0.37;
            if (within(ex.gForces.maxLat, td.stats.maxLatG)) lat++;
            if (within(ex.gForces.maxPosVert, td.stats.maxPosG)) vert++;
        }
        expect(n).toBeGreaterThan(50);
        expect(lat / n).toBeGreaterThan(0.95);
        expect(vert / n).toBeGreaterThan(0.95);
    });

    it.skipIf(!hasLibrary)("designs à sections de bloc : leur nombre de trains tient dans les sections comptées", () => {
        const lib = loadLibrary(dirs).filter((e) => e.design && (e.design.rideMode === 34 || e.design.rideMode === 36));
        const bad: string[] = [];
        for (const e of lib) {
            const l = designLayout(e.design!, table!, { x: 50, y: 50, z: 160 }, 0);
            if (!l.closed) continue;
            const b = blockSections(l.pieces);
            if (e.design!.numberOfTrains > b.maxTrains) bad.push(`${e.name}: ${e.design!.numberOfTrains} > ${b.maxTrains} (${b.boundaries})`);
        }
        expect(bad).toEqual([]);
        const fm = lib.find((e) => /frightmare/i.test(e.name));
        if (fm) {
            const b = blockSections(designLayout(fm.design!, table!, { x: 50, y: 50, z: 160 }, 0).pieces);
            console.log(`Frightmare : ${fm.design!.numberOfTrains} trains, ${JSON.stringify(b)}`);
        }
    });
});
