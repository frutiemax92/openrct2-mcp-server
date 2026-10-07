import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TRACK_ELEM_TYPES } from "@openrct2-claude/protocol";
import { describe, expect, it } from "vitest";
import { SegmentTable } from "../src/planners/track.js";
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
});
