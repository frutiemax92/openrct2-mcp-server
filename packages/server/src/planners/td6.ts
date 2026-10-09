// Lecture des designs de montagnes russes .td6 / .td7 (SPEC 12.7).
//
// Format repris de rct2/T6Importer.cpp et rct12/TD46.cpp :
//  - fichier = données codées en RLE (SawyerChunkReader::DecodeChunkRLE) suivies d'une somme de contrôle de 4 octets ;
//  - en-tête TD6Track de 0xA3 octets, puis éléments de piste (2 octets, 3 en td7) terminés par 0xFF (0xFFFF en td7),
//    puis entrées/sorties (6 octets) terminées par 0xFF, puis scénerie (22 octets) terminée par 0xFF.
// Les labyrinthes et les attractions plates ne sont pas lus (pas de circuit à rejouer).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { DIRECTION_DELTA, TRACK_ELEM_TYPES, rotateOffset, type Direction } from "@openrct2-claude/protocol";
import { SegmentTable, endPose, originAt, pieceElements, type PlannedPiece, type TrackPose } from "./track.js";

export interface TdTrackElement {
    /** TrackElemType d'OpenRCT2 (les alias RCT2 sont convertis). */
    type: number;
    chain: boolean;
    inverted: boolean;
    /** Vitesse interne (brakeBoosterSpeed) pour freins et boosters, sinon undefined. */
    brakeSpeed?: number;
    seatRotation: number;
    colourScheme: number;
    stationIndex?: number;
}

export interface TdEntrance {
    /** Décalage en tuiles depuis l'origine (direction 0). */
    x: number;
    y: number;
    /** Hauteur relative à l'origine, en unités de 8 (kCoordsZStep). */
    z: number;
    direction: number;
    isExit: boolean;
}

export interface TrackDesign {
    name: string;
    file: string;
    version: "td6" | "td7";
    /** Type d'attraction RCT2 (à convertir selon l'objet de véhicule, voir resolveRideType). */
    rideType: number;
    /** Nom DAT de l'objet de véhicule, sans espaces finaux (ex. « ARRT1 »). */
    vehicleObject: string;
    rideMode: number;
    departFlags: number;
    numberOfTrains: number;
    carsPerTrain: number;
    minWaitingTime: number;
    maxWaitingTime: number;
    operationSetting: number;
    liftHillSpeed: number;
    numCircuits: number;
    colourScheme: number;
    vehicleColours: { body: number; trim: number; tertiary: number }[];
    trackColours: { main: number; additional: number; supports: number }[];
    entranceStyle: number;
    stats: {
        excitement: number;
        intensity: number;
        nausea: number;
        maxSpeedKmh: number;
        rideLengthM: number;
        inversions: number;
        drops: number;
        /** G enregistrés avec le design (octets 0x55-0x57 × 32 centièmes, kTD46GForcesMultiplier : précision 0,32 G par défaut). */
        maxPosG: number;
        maxNegG: number;
        maxLatG: number;
    };
    /** Encombrement annoncé par le fichier (tuiles). */
    spaceRequired: { x: number; y: number };
    elements: TdTrackElement[];
    entrances: TdEntrance[];
    sceneryCount: number;
}

export class TdParseError extends Error {}

/** Décodage RLE des chunks Sawyer (la somme de contrôle finale est ignorée). */
export function decodeRle(src: Uint8Array): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < src.length; i++) {
        const code = src[i];
        if (code & 128) {
            i++;
            if (i >= src.length) throw new TdParseError("RLE corrompu");
            const count = 257 - code;
            for (let n = 0; n < count; n++) out.push(src[i]);
        } else {
            const len = code + 1;
            if (i + 1 + len > src.length) throw new TdParseError("RLE corrompu");
            for (let n = 0; n < len; n++) out.push(src[i + 1 + n]);
            i += len;
        }
        if (out.length > 0x600000) throw new TdParseError("design trop grand");
    }
    return Uint8Array.from(out);
}

// Constantes de rct12/RCT12.h, rct2/RCT2.cpp, ride/RideData.h
const T = TRACK_ELEM_TYPES as Record<string, number>;
const RIDE_TYPE_MAZE = 20;
const RIDE_TYPE_STEEL_WILD_MOUSE = 54;
const ALIAS_INVERTED_UP90_TO_FLAT_QUARTER_LOOP = 101;
const ALIAS_ROTATION_CONTROL_TOGGLE = 100;
const DEFAULT_BLOCK_BRAKE_SPEED = 2;
const STATIONS = new Set([T.endStation, T.beginStation, T.middleStation]);

/** Pièces qui portent une vitesse (trackTypeHasSpeedSetting) : freins, freins de bloc, boosters. */
export const SPEED_PIECES: ReadonlySet<number> = new Set(
    ["brakes", "diagBrakes", "down25Brakes", "diagDown25Brakes", "blockBrakes", "diagBlockBrakes", "booster", "diagBooster"].map((n) => T[n]),
);

export function parseTrackDesign(buf: Uint8Array, file = "design.td6"): TrackDesign {
    if (buf.length < 8) throw new TdParseError("fichier trop court");
    const d = decodeRle(buf.subarray(0, buf.length - 4));
    if (d.length < 0xa3) throw new TdParseError("en-tête incomplet");
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const u8 = (o: number) => {
        if (o >= d.length) throw new TdParseError("fin de données inattendue");
        return d[o];
    };
    const versionBits = u8(0x07) >> 2;
    if (versionBits !== 2 && versionBits !== 3) throw new TdParseError(versionBits < 2 ? "design RCT1 (td4) non pris en charge" : "version de design inconnue");
    const version = versionBits === 3 ? "td7" : "td6";
    const rideType = u8(0x00);
    if (rideType === RIDE_TYPE_MAZE) throw new TdParseError("labyrinthe : non pris en charge (pas de circuit)");
    const vehicleObject = String.fromCharCode(...d.subarray(0x74, 0x7c)).replace(/[\0 ]+$/, "");
    const vehicleColours = Array.from({ length: 32 }, (_, i) => ({ body: u8(0x08 + i * 2), trim: u8(0x09 + i * 2), tertiary: u8(0x82 + i) }));
    const trackColours = Array.from({ length: 4 }, (_, i) => ({ main: u8(0x60 + i), additional: u8(0x64 + i), supports: u8(0x68 + i) }));

    let pos = 0xa3;
    const elements: TdTrackElement[] = [];
    const wildMouse = rideType === RIDE_TYPE_STEEL_WILD_MOUSE;
    for (;;) {
        let type: number;
        let flags: number;
        if (version === "td7") {
            const t = dv.getUint16(pos, true);
            if (t === 0xffff) {
                pos += 2;
                break;
            }
            type = t;
            flags = u8(pos + 2);
            pos += 3;
        } else {
            const t = u8(pos);
            if (t === 0xff) {
                pos += 1;
                break;
            }
            flags = u8(pos + 1);
            pos += 2;
            type = t;
            if (t === ALIAS_INVERTED_UP90_TO_FLAT_QUARTER_LOOP) type = T.multiDimInvertedUp90ToFlatQuarterLoop;
            else if (wildMouse && t === ALIAS_ROTATION_CONTROL_TOGGLE) type = T.rotationControlToggle;
        }
        const el: TdTrackElement = { type, chain: !!(flags & 0x80), inverted: !!(flags & 0x40), seatRotation: 4, colourScheme: (flags & 0x30) >> 4 };
        if (STATIONS.has(type)) el.stationIndex = flags & 3;
        else if (SPEED_PIECES.has(type)) el.brakeSpeed = type === T.blockBrakes && version === "td6" ? DEFAULT_BLOCK_BRAKE_SPEED : (flags & 15) << 1;
        else el.seatRotation = flags & 15;
        elements.push(el);
        if (elements.length > 5000) throw new TdParseError("trop de pièces");
    }

    const entrances: TdEntrance[] = [];
    for (;;) {
        if (u8(pos) === 0xff) {
            pos += 1;
            break;
        }
        const z = dv.getInt8(pos);
        const dir = u8(pos + 1);
        entrances.push({
            z: z === -128 ? -1 : z,
            direction: dir & 15,
            isExit: !!(dir >> 7),
            // x, y en unités monde (int16), convertis en tuiles comme TileCoordsXY(CoordsXY).
            x: Math.trunc(dv.getInt16(pos + 2, true) / 32),
            y: Math.trunc(dv.getInt16(pos + 4, true) / 32),
        });
        pos += 6;
    }

    let sceneryCount = 0;
    while (pos < d.length && d[pos] !== 0xff) {
        sceneryCount++;
        pos += 22;
    }

    return {
        name: basename(file, extname(file)),
        file,
        version,
        rideType,
        vehicleObject,
        rideMode: u8(0x06),
        departFlags: u8(0x4b),
        numberOfTrains: u8(0x4c),
        carsPerTrain: u8(0x4d),
        minWaitingTime: u8(0x4e),
        maxWaitingTime: u8(0x4f),
        operationSetting: u8(0x50),
        liftHillSpeed: u8(0xa2) & 0x1f,
        numCircuits: u8(0xa2) >> 5,
        colourScheme: u8(0x07) & 3,
        vehicleColours,
        trackColours,
        entranceStyle: u8(0x49),
        stats: {
            excitement: u8(0x5b) / 10,
            intensity: u8(0x5c) / 10,
            nausea: u8(0x5d) / 10,
            // MaxSpeed : ToHumanReadableSpeed(v << 16) = v × 9 / 4 mph ; RideLength en mètres.
            maxSpeedKmh: Math.round(((dv.getInt8(0x51) * 9) / 4) * 1.609),
            rideLengthM: dv.getUint16(0x53, true),
            inversions: u8(0x58) & 0x1f,
            drops: u8(0x59) & 0x3f,
            maxPosG: (u8(0x55) * 32) / 100,
            maxNegG: (dv.getInt8(0x56) * 32) / 100,
            maxLatG: (u8(0x57) * 32) / 100,
        },
        spaceRequired: { x: u8(0x80), y: u8(0x81) },
        elements,
        entrances,
        sceneryCount,
    };
}

// ---------------------------------------------------------------------------
// Bibliothèque : dossiers Tracks du jeu RCT2 et track/ du dossier utilisateur
// ---------------------------------------------------------------------------

export interface DesignEntry {
    design: TrackDesign | null;
    file: string;
    name: string;
    error?: string;
}

/** Dossiers de designs : <game_path>/Tracks, <userDir>/track, plus OPENRCT2_TRACKS_DIR (séparés par « : »). */
export function designDirs(userDir: string, env = process.env): string[] {
    const dirs: string[] = [];
    if (env.OPENRCT2_TRACKS_DIR) dirs.push(...env.OPENRCT2_TRACKS_DIR.split(":").filter(Boolean));
    dirs.push(join(userDir, "track"));
    const gamePath = env.OPENRCT2_RCT2_PATH ?? readGamePath(userDir);
    if (gamePath) dirs.push(join(gamePath, "Tracks"), join(gamePath, "tracks"));
    return [...new Set(dirs)];
}

function readGamePath(userDir: string): string | null {
    try {
        const ini = readFileSync(join(userDir, "config.ini"), "utf8");
        const m = /^\s*game_path\s*=\s*"?([^"\n]*)"?\s*$/m.exec(ini);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

function walk(dir: string, out: string[], depth = 0): void {
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return;
    }
    for (const n of names) {
        const p = join(dir, n);
        let st;
        try {
            st = statSync(p);
        } catch {
            continue;
        }
        if (st.isDirectory() && depth < 3) walk(p, out, depth + 1);
        else if (/\.td[67]$/i.test(n)) out.push(p);
    }
}

export function loadLibrary(dirs: string[]): DesignEntry[] {
    const files: string[] = [];
    for (const d of dirs) walk(d, files);
    const seen = new Set<string>();
    const out: DesignEntry[] = [];
    for (const f of files) {
        if (seen.has(f)) continue;
        seen.add(f);
        const name = basename(f, extname(f));
        try {
            out.push({ design: parseTrackDesign(readFileSync(f), f), file: f, name });
        } catch (e) {
            out.push({ design: null, file: f, name, error: e instanceof Error ? e.message : String(e) });
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Rejeu : pièces, entrées et emprise d'un design posé à une origine (TrackDesignPlaceRide)
// ---------------------------------------------------------------------------

export interface DesignPiece extends PlannedPiece {
    inverted: boolean;
    colourScheme: number;
    seatRotation: number;
}

export interface DesignAccess {
    x: number;
    y: number;
    z: number;
    /** Direction de la tuile d'entrée vers la station (argument de rideentranceexitplace). */
    direction: Direction;
    isExit: boolean;
    /** Station desservie (pièce de station sur la tuile voisine), 0 par défaut. */
    station: number;
}

export interface DesignLayout {
    pieces: DesignPiece[];
    accesses: DesignAccess[];
    /** Blocs de piste (tuiles, z monde). */
    blocks: { x: number; y: number; z: number }[];
    bbox: { x1: number; y1: number; x2: number; y2: number };
    /** La dernière pièce revient sur la première (circuit fermé ; faux pour les navettes et tours). */
    closed: boolean;
    unknownPieces: number[];
}

/**
 * Pose le design à l'origine (x, y, z) avec la rotation `direction` : même marche que TrackDesignPlaceRide
 * (la géométrie seule fait foi ; pas de contrôle de pente, le jeu n'en fait pas non plus).
 */
export function designLayout(td: TrackDesign, table: SegmentTable, origin: { x: number; y: number; z: number }, direction: Direction): DesignLayout {
    const unknownPieces: number[] = [];
    const pieces: DesignPiece[] = [];
    const blocks: { x: number; y: number; z: number }[] = [];
    const stationAt = new Map<string, number>();
    const first = table.get(td.elements[0]?.type ?? -1);
    const start: TrackPose = { x: origin.x, y: origin.y, z: origin.z, rot: direction | ((first?.beginDirection ?? 0) & 4), slope: first?.beginSlope ?? 0, bank: first?.beginBank ?? 0 };
    let pose = start;
    for (const el of td.elements) {
        const seg = table.get(el.type);
        if (!seg) {
            unknownPieces.push(el.type);
            continue;
        }
        const o = originAt(pose, seg);
        const piece: DesignPiece = {
            ...o,
            name: SegmentTable.nameOf(el.type),
            chain: el.chain || undefined,
            brakeSpeed: el.brakeSpeed,
            inverted: el.inverted,
            colourScheme: el.colourScheme,
            seatRotation: el.seatRotation,
        };
        pieces.push(piece);
        const els = pieceElements(o, seg);
        blocks.push(...els);
        if (el.stationIndex !== undefined) for (const b of els) stationAt.set(`${b.x},${b.y}`, el.stationIndex);
        pose = endPose(o, seg);
    }
    const closed = pieces.length > 1 && pose.x === start.x && pose.y === start.y && pose.z === start.z && (pose.rot & 3) === (start.rot & 3);
    const accesses: DesignAccess[] = td.entrances.map((e) => {
        const r = rotateOffset({ x: e.x, y: e.y }, direction);
        const dir = ((direction + e.direction) & 3) as Direction;
        const x = origin.x + r.x;
        const y = origin.y + r.y;
        const toward = DIRECTION_DELTA[dir];
        return { x, y, z: origin.z + e.z * 8, direction: dir, isExit: e.isExit, station: stationAt.get(`${x + toward.x},${y + toward.y}`) ?? 0 };
    });
    const xs = [...blocks.map((b) => b.x), ...accesses.map((a) => a.x)];
    const ys = [...blocks.map((b) => b.y), ...accesses.map((a) => a.y)];
    return {
        pieces,
        accesses,
        blocks,
        bbox: { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) },
        closed,
        unknownPieces,
    };
}
