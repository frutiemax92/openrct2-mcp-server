// Marcheur de piste, macros et fermeture de circuit (SPEC 12.2 à 12.6).
//
// Modèle de pose repris de TrackDesignPlaceVirtual (ride/TrackDesign.cpp) :
//  - une pose est (x, y, z, rot, pente, inclinaison) au début de la pièce suivante ; x, y en tuiles, z en unités monde,
//    rot de 0 à 7 (bit 2 = diagonale) ;
//  - la pièce T se pose avec trackplace { x, y, z: pose.z − T.beginZ, direction: rot & 3 } ;
//  - pose suivante : xy += rotate(T.endX, T.endY, rot), z = origine.z + T.endZ,
//    rot = ((rot + T.endDirection − T.beginDirection) & 3) | (T.endDirection & 4), puis un pas dans rot si la fin
//    n'est pas diagonale.
// L'origine d'une pièce posée (TrackIterator.position) est exactement l'argument de trackplace (Track.cpp,
// GetTrackSegmentOrigin) : le marcheur se valide contre le jeu par track.circuit.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    DIRECTION_DELTA,
    RIDE_TYPES,
    TRACK_ELEM_TYPES,
    TRACK_GROUPS,
    rotateOffset,
    type Direction,
    type RegionTile,
    type TrackPieceInfo,
    type TrackSegmentInfo,
} from "@openrct2-claude/protocol";

/** `TrackPitch` (pente) et `TrackRoll` (inclinaison) tels que l'API les expose. */
export const PITCH = { flat: 0, up25: 2, up60: 4, down25: 6, down60: 8, up90: 10, down90: 18 } as const;
export const ROLL = { none: 0, left: 2, right: 4, upsideDown: 15 } as const;

const PITCH_NAME: Record<number, string> = { 0: "flat", 2: "up25", 4: "up60", 6: "down25", 8: "down60", 10: "up90", 18: "down90" };
const ROLL_NAME: Record<number, string> = { 0: "none", 2: "left", 4: "right", 15: "upside_down" };

/** Drapeaux de trackplace.trackPlaceFlags (ride/RideConstruction.h). */
export const TRACK_PLACE_FLAGS = { liftHill: 1, inverted: 2 } as const;

/** Pièces de station (endStation, beginStation, middleStation). */
export const STATION_TYPES: ReadonlySet<number> = new Set([1, 2, 3]);

export interface TrackPose {
    x: number;
    y: number;
    z: number;
    /** 0-3 orthogonal, 4-7 diagonal (bit 2). */
    rot: number;
    slope: number;
    bank: number;
}

export interface PlannedPiece extends TrackPieceInfo {
    name: string;
    chain?: boolean;
    brakeSpeed?: number;
    /** Indice de la macro qui a produit la pièce (compileMacros). */
    macro?: number;
}

export const poseKey = (p: TrackPose): string => `${p.x},${p.y},${p.z},${p.rot},${p.slope},${p.bank}`;
export const samePose = (a: TrackPose, b: TrackPose): boolean => poseKey(a) === poseKey(b);

export function describePose(p: TrackPose): Record<string, unknown> {
    return {
        x: p.x,
        y: p.y,
        level: p.z / 16,
        direction: p.rot & 3,
        diagonal: (p.rot & 4) !== 0 || undefined,
        slope: PITCH_NAME[p.slope] ?? p.slope,
        bank: ROLL_NAME[p.bank] ?? p.bank,
    };
}

const mod4 = (n: number): number => ((n % 4) + 4) % 4;

// ---------------------------------------------------------------------------
// Table des segments
// ---------------------------------------------------------------------------

export function segmentsFile(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(join(here, "..", "..", "..", "..", "data", "track_segments.json"));
}

const NAME_BY_TYPE: Record<number, string> = Object.fromEntries(Object.entries(TRACK_ELEM_TYPES).map(([k, v]) => [v, k]));

export class SegmentTable {
    private readonly byType = new Map<number, TrackSegmentInfo>();

    constructor(segments: TrackSegmentInfo[]) {
        for (const s of segments) this.byType.set(s.type, s);
    }

    static fromFile(file = segmentsFile()): SegmentTable | null {
        if (!existsSync(file)) return null;
        const data = JSON.parse(readFileSync(file, "utf8")) as { segments: TrackSegmentInfo[] };
        return new SegmentTable(data.segments);
    }

    get(type: number): TrackSegmentInfo | undefined {
        return this.byType.get(type);
    }

    require(type: number): TrackSegmentInfo {
        const s = this.byType.get(type);
        if (!s) throw new Error(`Segment inconnu : ${type}`);
        return s;
    }

    byName(name: string): TrackSegmentInfo | undefined {
        const t = (TRACK_ELEM_TYPES as Record<string, number>)[name];
        return t === undefined ? undefined : this.byType.get(t);
    }

    all(): TrackSegmentInfo[] {
        return [...this.byType.values()];
    }

    static nameOf(type: number): string {
        return NAME_BY_TYPE[type] ?? `piece${type}`;
    }
}

// ---------------------------------------------------------------------------
// Géométrie d'une pièce
// ---------------------------------------------------------------------------

/** La pièce peut-elle commencer à cette pose (pente, inclinaison, diagonale) ? */
export function fits(pose: TrackPose, seg: TrackSegmentInfo): boolean {
    return seg.beginSlope === pose.slope && seg.beginBank === pose.bank && (seg.beginDirection & 4) === (pose.rot & 4);
}

/** Origine (argument de trackplace) de la pièce posée à cette pose. */
export function originAt(pose: TrackPose, seg: TrackSegmentInfo): TrackPieceInfo {
    return { type: seg.type, x: pose.x, y: pose.y, z: pose.z - seg.beginZ, direction: (pose.rot & 3) as Direction };
}

export function beginPose(piece: TrackPieceInfo, seg: TrackSegmentInfo): TrackPose {
    return { x: piece.x, y: piece.y, z: piece.z + seg.beginZ, rot: piece.direction | (seg.beginDirection & 4), slope: seg.beginSlope, bank: seg.beginBank };
}

export function endPose(piece: TrackPieceInfo, seg: TrackSegmentInfo): TrackPose {
    const o = rotateOffset({ x: seg.endX, y: seg.endY }, piece.direction);
    const rot0 = piece.direction | (seg.beginDirection & 4);
    const rot = mod4(rot0 + seg.endDirection - seg.beginDirection) | (seg.endDirection & 4);
    let x = piece.x + Math.round(o.x / 32);
    let y = piece.y + Math.round(o.y / 32);
    if (!(seg.endDirection & 4)) {
        x += DIRECTION_DELTA[rot & 3].x;
        y += DIRECTION_DELTA[rot & 3].y;
    }
    return { x, y, z: piece.z + seg.endZ, rot, slope: seg.endSlope, bank: seg.endBank };
}

/** Pièce de type `seg` qui se termine exactement à `end` (marche arrière), ou null si incompatible. */
export function pieceEndingAt(end: TrackPose, seg: TrackSegmentInfo): TrackPieceInfo | null {
    if (end.slope !== seg.endSlope || end.bank !== seg.endBank || (end.rot & 4) !== (seg.endDirection & 4)) return null;
    const direction = mod4((end.rot & 3) - seg.endDirection + seg.beginDirection) as Direction;
    let x = end.x;
    let y = end.y;
    if (!(seg.endDirection & 4)) {
        x -= DIRECTION_DELTA[end.rot & 3].x;
        y -= DIRECTION_DELTA[end.rot & 3].y;
    }
    const o = rotateOffset({ x: seg.endX, y: seg.endY }, direction);
    return { type: seg.type, x: x - Math.round(o.x / 32), y: y - Math.round(o.y / 32), z: end.z - seg.endZ, direction };
}

/** Blocs occupés (tuiles et z monde). */
export function pieceElements(piece: TrackPieceInfo, seg: TrackSegmentInfo): { x: number; y: number; z: number }[] {
    return seg.elements.map((e) => {
        const o = rotateOffset(e, piece.direction);
        return { x: piece.x + Math.round(o.x / 32), y: piece.y + Math.round(o.y / 32), z: piece.z + e.z };
    });
}

/** z à passer à trackremove : base du premier bloc (TrackDesign.cpp, removeGhost). */
export function removeZ(piece: TrackPieceInfo, seg: TrackSegmentInfo): number {
    return piece.z + (seg.elements[0]?.z ?? 0);
}

export function climbs(seg: TrackSegmentInfo): boolean {
    return seg.endZ > seg.beginZ;
}

// ---------------------------------------------------------------------------
// Pièces autorisées par type d'attraction
// ---------------------------------------------------------------------------

const G = TRACK_GROUPS as Record<string, number>;

/** Groupes qui ne sont pas de la géométrie de parcours (fonctions spéciales), exclus des recherches. */
const SPECIAL_GROUPS = new Set(
    [
        "flat",
        "stationEnd",
        "brakes",
        "blockBrakes",
        "booster",
        "onridePhoto",
        "liftHillCable",
        "reverser",
        "reverseFreefall",
        "poweredLift",
        "logFlumeReverser",
        "waterSplash",
        "spinningTunnel",
        "rapids",
        "waterfall",
        "whirlpool",
        "brakeForDrop",
        "heartlineTransfer",
        "miniGolfHole",
        "rotationControlToggle",
        "tower",
        "flatRideBase",
        "diagBrakes",
        "diagBlockBrakes",
        "inclinedBrakes",
        "diagBooster",
    ]
        .map((n) => G[n])
        .filter((v) => v !== undefined),
);

export interface RideTrackInfo {
    rideType: number;
    name: string;
    groups: Set<number>;
    supportsSteepLift: boolean;
}

export function rideTrackInfo(rideType: number): RideTrackInfo | null {
    const info = RIDE_TYPES.find((r) => r.rideType === rideType);
    if (!info || !info.trackGroups.length || info.startTrackPieceName !== "endStation") return null;
    const groups = new Set(info.trackGroups);
    return { rideType, name: info.name, groups, supportsSteepLift: groups.has(G.liftHillSteep) };
}

export interface CatalogOptions {
    inversions?: boolean;
    diagonals?: boolean;
    steep?: boolean;
    /** Exclut les montées qui ne peuvent pas porter de chaîne (fermeture : toute montée est tractée). */
    chainedClimbsOnly?: boolean;
}

const isSteep = (s: number) => s === PITCH.up60 || s === PITCH.down60 || s === PITCH.up90 || s === PITCH.down90;

/** Pièces de géométrie utilisables par une recherche (fermeture, transitions). */
export function searchCatalog(table: SegmentTable, ride: RideTrackInfo, opts: CatalogOptions = {}): TrackSegmentInfo[] {
    return table.all().filter((s) => {
        if (!ride.groups.has(s.trackGroup) || SPECIAL_GROUPS.has(s.trackGroup)) return false;
        if (s.flags?.onlyAllowedUnderwater) return false;
        const inv = !!s.flags?.isInversion || s.beginBank === ROLL.upsideDown || s.endBank === ROLL.upsideDown;
        if (inv && !opts.inversions) return false;
        if (((s.beginDirection | s.endDirection) & 4) && !opts.diagonals) return false;
        if ((isSteep(s.beginSlope) || isSteep(s.endSlope)) && !opts.steep) return false;
        if (s.beginSlope === PITCH.up90 || s.endSlope === PITCH.up90 || s.beginSlope === PITCH.down90 || s.endSlope === PITCH.down90) return false;
        if (opts.chainedClimbsOnly && climbs(s)) {
            if (!s.flags?.allowsChainLift) return false;
            if (s.flags?.isSteepUp && !ride.supportsSteepLift) return false;
        }
        return true;
    });
}

/** Le type d'attraction autorise-t-il cette pièce (groupe constructible) ? */
export function pieceAllowed(ride: RideTrackInfo, seg: TrackSegmentInfo): boolean {
    return ride.groups.has(seg.trackGroup);
}

// ---------------------------------------------------------------------------
// Occupation et environnement
// ---------------------------------------------------------------------------

/** Écart vertical minimal entre deux blocs de piste sur une même tuile (unités monde). */
export const TRACK_CLEARANCE = 40;

export class Occupancy {
    private readonly cells = new Map<string, number[]>();

    add(elements: { x: number; y: number; z: number }[]): void {
        for (const e of elements) {
            const k = `${e.x},${e.y}`;
            const list = this.cells.get(k);
            if (list) list.push(e.z);
            else this.cells.set(k, [e.z]);
        }
    }

    /** Premier bloc en conflit, ou null. */
    conflict(elements: { x: number; y: number; z: number }[]): { x: number; y: number; z: number } | null {
        for (const e of elements) {
            const list = this.cells.get(`${e.x},${e.y}`);
            if (list && list.some((z) => Math.abs(z - e.z) < TRACK_CLEARANCE)) return e;
        }
        return null;
    }
}

export type TileGetter = (x: number, y: number) => RegionTile | undefined;

export interface TrackEnv {
    get: TileGetter;
    rideId: number;
    sandbox: boolean;
    mapSize: { x: number; y: number };
}

/** Hauteur du point le plus haut de la surface (unités monde). */
export function groundTopZ(t: RegionTile): number {
    let lvl = t.h;
    if (t.s & 15) lvl += 1;
    if (t.s & 16) lvl += 1;
    return Math.max(lvl, t.w || 0) * 16;
}

/** Raison pour laquelle un bloc de piste ne peut pas être posé à cet endroit, ou null (contrôle côté serveur, prudent). */
export function blockProblem(env: TrackEnv, e: { x: number; y: number; z: number }): string | null {
    if (e.x < 1 || e.y < 1 || e.x >= env.mapSize.x - 1 || e.y >= env.mapSize.y - 1) return "hors carte";
    const t = env.get(e.x, e.y);
    if (!t) return "hors zone lue";
    if (!(t.o & 3) && !env.sandbox) return "terrain non possédé";
    if (e.z < groundTopZ(t)) return "sous le terrain";
    for (const p of t.p ?? []) if (Math.abs(p.l * 16 - e.z) < 48) return "chemin";
    for (const en of t.e ?? []) if (Math.abs(en.l * 16 - e.z) < 64) return "entrée/sortie";
    if (t.r?.some((r) => r !== env.rideId) && e.z < ((t.rh ?? t.h) + 3) * 16) return "autre attraction";
    if (t.lg) return "grande scénerie";
    return null;
}

// ---------------------------------------------------------------------------
// Transitions de pente et d'inclinaison
// ---------------------------------------------------------------------------

/** Pièces droites (sans virage ni diagonale) qui changent la pente et/ou l'inclinaison. */
function straightPieces(table: SegmentTable, ride: RideTrackInfo, opts: CatalogOptions): TrackSegmentInfo[] {
    return searchCatalog(table, ride, opts).filter((s) => s.turnDirection === "straight" && s.endY === 0 && s.beginDirection === 0 && s.endDirection === 0);
}

/** Plus courte suite de pièces droites menant de (pente, inclinaison) à l'état voulu (≤ 4 pièces). */
export function findTransition(
    table: SegmentTable,
    ride: RideTrackInfo,
    from: { slope: number; bank: number },
    to: { slope: number; bank: number },
    opts: CatalogOptions = { steep: true },
): TrackSegmentInfo[] | null {
    if (from.slope === to.slope && from.bank === to.bank) return [];
    const pieces = straightPieces(table, ride, opts);
    const key = (s: { slope: number; bank: number }) => `${s.slope}|${s.bank}`;
    const prev = new Map<string, { k: string; seg: TrackSegmentInfo } | null>([[key(from), null]]);
    let frontier = [from];
    for (let depth = 0; depth < 4 && frontier.length; depth++) {
        const next: { slope: number; bank: number }[] = [];
        for (const st of frontier) {
            for (const seg of pieces) {
                if (seg.beginSlope !== st.slope || seg.beginBank !== st.bank) continue;
                const ns = { slope: seg.endSlope, bank: seg.endBank };
                const k = key(ns);
                if (prev.has(k)) continue;
                prev.set(k, { k: key(st), seg });
                if (k === key(to)) {
                    const out: TrackSegmentInfo[] = [];
                    let cur: string | undefined = k;
                    while (cur && prev.get(cur)) {
                        const p = prev.get(cur) as { k: string; seg: TrackSegmentInfo };
                        out.unshift(p.seg);
                        cur = p.k;
                    }
                    return out;
                }
                next.push(ns);
            }
        }
        frontier = next;
    }
    return null;
}

/**
 * Suite de pièces droites non inclinées qui part de `fromSlope` et finit à plat avec un dénivelé exact `dz`
 * (montées, descentes). Minimise le nombre de pièces.
 */
export function slopeRun(
    table: SegmentTable,
    ride: RideTrackInfo,
    fromSlope: number,
    dz: number,
    opts: { steep: boolean; chain: boolean },
): TrackSegmentInfo[] | null {
    const pieces = straightPieces(table, ride, { steep: opts.steep, chainedClimbsOnly: opts.chain }).filter(
        (s) => s.beginBank === 0 && s.endBank === 0 && (dz >= 0 ? s.endZ >= s.beginZ : s.endZ <= s.beginZ),
    );
    const key = (slope: number, z: number) => `${slope}|${z}`;
    const prev = new Map<string, { k: string; seg: TrackSegmentInfo } | null>([[key(fromSlope, 0), null]]);
    let frontier = [{ slope: fromSlope, z: 0 }];
    const goal = key(PITCH.flat, dz);
    for (let depth = 0; depth < 80 && frontier.length; depth++) {
        const next: { slope: number; z: number }[] = [];
        for (const st of frontier) {
            for (const seg of pieces) {
                if (seg.beginSlope !== st.slope) continue;
                const z = st.z + seg.endZ - seg.beginZ;
                if (dz >= 0 ? z > dz : z < dz) continue;
                const k = key(seg.endSlope, z);
                if (prev.has(k)) continue;
                prev.set(k, { k: key(st.slope, st.z), seg });
                if (k === goal) {
                    const out: TrackSegmentInfo[] = [];
                    let cur: string | undefined = k;
                    while (cur && prev.get(cur)) {
                        const p = prev.get(cur) as { k: string; seg: TrackSegmentInfo };
                        out.unshift(p.seg);
                        cur = p.k;
                    }
                    return out;
                }
                next.push({ slope: seg.endSlope, z });
            }
        }
        frontier = next;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Macros (SPEC 12.6)
// ---------------------------------------------------------------------------

export type TurnSide = "left" | "right";

export type InversionKind = "loop" | "immelmann" | "dive_loop" | "corkscrew" | "zero_g_roll" | "barrel_roll";
export const INVERSION_KINDS: readonly InversionKind[] = ["loop", "immelmann", "dive_loop", "corkscrew", "zero_g_roll", "barrel_roll"];

export type Macro =
    | { op: "straight"; length: number }
    | { op: "lift"; height: number; steep?: boolean }
    | { op: "climb"; height: number; steep?: boolean }
    | { op: "drop"; height: number; steep?: boolean }
    | { op: "hill"; height: number; steep?: boolean }
    | {
          op: "turn";
          dir: TurnSide;
          size?: "small" | "medium" | "large";
          banked?: boolean;
          quarters?: number;
          slope?: "flat" | "up" | "down" | "steep_up" | "steep_down";
      }
    | { op: "helix"; dir: TurnSide; quarters: number; down?: boolean; size?: "small" | "large" }
    | { op: "s_bend"; dir: TurnSide }
    | { op: "loop"; dir: TurnSide }
    | { op: "inversion"; kind: InversionKind; dir: TurnSide; size?: "small" | "medium" | "large" }
    | { op: "brakes"; length: number; speed?: number }
    | { op: "block_brakes" }
    | { op: "photo" }
    | { op: "level" }
    | { op: "piece"; name: string; chain?: boolean };

export interface CompileResult {
    pieces: PlannedPiece[];
    end: TrackPose;
    errors: { macro: number; message: string }[];
}

interface PieceRequest {
    seg: TrackSegmentInfo;
    chain?: boolean;
    brakeSpeed?: number;
}

const TURN_SLOPE = { flat: PITCH.flat, up: PITCH.up25, down: PITCH.down25, steep_up: PITCH.up60, steep_down: PITCH.down60 } as const;

/** Pièces d'un quart de tour (1 pièce, ou 2 pour size 'large' : huitième vers la diagonale puis retour à l'orthogonale). */
function findTurn(table: SegmentTable, ride: RideTrackInfo, m: Extract<Macro, { op: "turn" }>): TrackSegmentInfo[] | null {
    const slope = TURN_SLOPE[m.slope ?? "flat"];
    const steep = slope === PITCH.up60 || slope === PITCH.down60;
    // Les virages raides (1 tuile, 60°) n'existent pas inclinés.
    const bank = m.banked && !steep ? (m.dir === "left" ? ROLL.left : ROLL.right) : ROLL.none;
    const same = (s: TrackSegmentInfo) =>
        pieceAllowed(ride, s) && !s.flags?.isHelix && s.turnDirection === m.dir && s.beginSlope === slope && s.endSlope === slope && s.beginBank === bank && s.endBank === bank;
    const quarterEnd = m.dir === "left" ? 3 : 1;
    if (steep) {
        const s = table.all().find((s) => same(s) && s.beginDirection === 0 && s.endDirection === quarterEnd);
        return s ? [s] : null;
    }
    if (m.size === "large") {
        // leftEighthToDiag (0 → 7) + leftEighthToOrthogonal (4 → 0) ; rightEighthToDiag (0 → 4) + rightEighthToOrthogonal (4 → 1).
        const toDiag = table.all().find((s) => same(s) && s.beginDirection === 0 && s.endDirection === (m.dir === "left" ? 7 : 4));
        const toOrth = table.all().find((s) => same(s) && s.beginDirection === 4 && s.endDirection === (m.dir === "left" ? 0 : 1));
        return toDiag && toOrth ? [toDiag, toOrth] : null;
    }
    const span = m.size === "small" ? 32 : 64;
    const s = table.all().find((s) => same(s) && s.beginDirection === 0 && s.endDirection === quarterEnd && Math.abs(s.endX) === span);
    return s ? [s] : null;
}

/**
 * Suites de pièces candidates pour une inversion complète (entrée et sortie non inversées), par ordre de préférence.
 * Appariements relevés dans les designs de RCT2 : tire-bouchon gauche-haut + droit-bas, grande boucle droite-haut +
 * gauche-bas, rouleaux et vrilles du même côté, Immelmann = demi-boucle + demi-tonneau (Frightmare).
 */
export function inversionCandidates(kind: InversionKind, dir: TurnSide, size: "small" | "medium" | "large" = "large"): string[][] {
    const d = dir;
    const o = dir === "left" ? "right" : "left";
    const halfUp = size === "small" ? "halfLoopUp" : `${d}${size === "large" ? "Large" : "Medium"}HalfLoopUp`;
    const halfDown = size === "small" ? "halfLoopDown" : `${d}${size === "large" ? "Large" : "Medium"}HalfLoopDown`;
    switch (kind) {
        case "loop":
            if (size === "small") return [[`${d}VerticalLoop`]];
            return [[halfUp, `${o}${size === "large" ? "Large" : "Medium"}HalfLoopDown`]];
        case "immelmann":
            return [
                [halfUp, `${d}BarrelRollDownToUp`],
                [halfUp, `${d}TwistUpToDown`],
                [halfUp, `${d}CorkscrewDown`],
            ];
        case "dive_loop":
            return [
                [`${d}BarrelRollUpToDown`, halfDown],
                [`${d}TwistDownToUp`, halfDown],
                [`${d}CorkscrewUp`, halfDown],
            ];
        case "corkscrew":
            return size === "large" ? [[`${d}LargeCorkscrewUp`, `${o}LargeCorkscrewDown`]] : [[`${d}CorkscrewUp`, `${o}CorkscrewDown`]];
        case "zero_g_roll":
            return size === "large" ? [[`${d}LargeZeroGRollUp`, `${d}LargeZeroGRollDown`]] : [[`${d}ZeroGRollUp`, `${d}ZeroGRollDown`]];
        case "barrel_roll":
            return [
                [`${d}BarrelRollUpToDown`, `${d}BarrelRollDownToUp`],
                [`${d}TwistDownToUp`, `${d}TwistUpToDown`],
            ];
    }
}

/** Inversions (genre × taille) que ce type d'attraction peut construire. */
export function availableInversions(table: SegmentTable, ride: RideTrackInfo): string[] {
    const out: string[] = [];
    for (const kind of INVERSION_KINDS) {
        // Une taille ne compte que si elle donne d'autres pièces que la taille inférieure (corkscrew medium = small).
        const seen = new Set<string>();
        const sizes = (["small", "medium", "large"] as const).filter((size) => {
            const ok = inversionCandidates(kind, "left", size).find((names) =>
                names.every((n) => {
                    const s = table.byName(n);
                    return !!s && pieceAllowed(ride, s);
                }),
            );
            if (!ok || seen.has(ok.join("+"))) return false;
            seen.add(ok.join("+"));
            return true;
        });
        if (sizes.length) out.push(`${kind}(${sizes.join("/")})`);
    }
    return out;
}

function expandMacro(table: SegmentTable, ride: RideTrackInfo, m: Macro, pose: TrackPose): PieceRequest[] | string {
    const named = (name: string): TrackSegmentInfo | string => {
        const s = table.byName(name);
        if (!s) return `pièce inconnue : ${name}`;
        if (!pieceAllowed(ride, s)) return `${name} n'est pas disponible pour ${ride.name}`;
        return s;
    };
    const many = (names: string[], extra: Partial<PieceRequest> = {}): PieceRequest[] | string => {
        const out: PieceRequest[] = [];
        for (const n of names) {
            const s = named(n);
            if (typeof s === "string") return s;
            out.push({ seg: s, ...extra });
        }
        return out;
    };
    const level = (): PieceRequest[] | string => {
        const t = findTransition(table, ride, pose, { slope: PITCH.flat, bank: ROLL.none });
        return t ? t.map((seg) => ({ seg })) : "impossible de revenir à plat depuis l'état courant";
    };
    switch (m.op) {
        case "straight":
            return many(Array(m.length).fill("flat"));
        case "level":
            return level();
        case "lift":
        case "climb":
        case "drop": {
            const lv = level();
            if (typeof lv === "string") return lv;
            const dz = (m.op === "drop" ? -1 : 1) * m.height * 16;
            // Lift : raide (60°) si le type le permet, sauf steep: false (lift 25° classique, 1 niveau par tuile).
            const steep = m.op === "lift" ? (m.steep ?? ride.supportsSteepLift) && ride.supportsSteepLift : !!m.steep;
            if (m.op === "lift" && m.steep && !ride.supportsSteepLift) return `${ride.name} n'a pas de chaîne raide (60°) : lift sans steep`;
            const run = slopeRun(table, ride, PITCH.flat, dz, { steep, chain: m.op === "lift" });
            if (!run) return `aucune suite de pièces droites ne fait ${m.op === "drop" ? "descendre" : "monter"} de ${m.height} niveau(x) exactement`;
            return [...lv, ...run.map((seg) => ({ seg, chain: m.op === "lift" && climbs(seg) }))];
        }
        case "hill": {
            // Colline (camelback) : montée sur l'élan puis descente de la même hauteur, sans palier au sommet.
            const lv = level();
            if (typeof lv === "string") return lv;
            const up = slopeRun(table, ride, PITCH.flat, m.height * 16, { steep: !!m.steep, chain: false });
            const down = slopeRun(table, ride, PITCH.flat, -m.height * 16, { steep: !!m.steep, chain: false });
            if (!up || !down) return `aucune colline de ${m.height} niveau(x) exactement`;
            return [...lv, ...up.map((seg) => ({ seg })), ...down.map((seg) => ({ seg }))];
        }
        case "turn": {
            const segs = findTurn(table, ride, m);
            if (!segs) {
                const steep = m.slope === "steep_up" || m.slope === "steep_down";
                return `aucun virage ${m.dir} ${steep ? "1 tuile" : m.size ?? "medium"}${m.banked && !steep ? " incliné" : ""}${m.slope && m.slope !== "flat" ? ` en ${m.slope}` : ""} pour ${ride.name}`;
            }
            return Array.from({ length: m.quarters ?? 1 }, () => segs.map((seg) => ({ seg }))).flat();
        }
        case "inversion": {
            // Sans taille : la plus grande disponible (large, puis medium, puis small).
            const sizes = m.size ? [m.size] : (["large", "medium", "small"] as const);
            for (const size of sizes) {
                for (const names of inversionCandidates(m.kind, m.dir, size)) {
                    const segs = names.map((n) => table.byName(n));
                    if (segs.every((s): s is TrackSegmentInfo => !!s && pieceAllowed(ride, s))) return segs.map((seg) => ({ seg }));
                }
            }
            const avail = availableInversions(table, ride);
            return `inversion ${m.kind}${m.size ? ` ${m.size}` : ""} indisponible pour ${ride.name} (possibles : ${avail.length ? avail.join(", ") : "aucune"})`;
        }
        case "helix": {
            const d = m.dir === "left" ? "left" : "right";
            const ud = m.down === false ? "Up" : "Down";
            const out: PieceRequest[] = [];
            let q = m.quarters;
            // Large par défaut : l'hélice serrée (small, rayon 3 tuiles) n'est à sa place qu'à basse vitesse, en fin de parcours.
            const large = m.size !== "small";
            const half = named(`${d}HalfBankedHelix${ud}${large ? "Large" : "Small"}`);
            const quarter = large ? named(`${d}QuarterBankedHelixLarge${ud}`) : null;
            if (typeof half === "string") return half;
            while (q >= 2) {
                out.push({ seg: half });
                q -= 2;
            }
            if (q === 1) {
                if (!quarter || typeof quarter === "string") return "nombre impair de quarts : utilise size 'large' ou un nombre pair";
                out.push({ seg: quarter });
            }
            return out;
        }
        case "s_bend":
            return many([m.dir === "left" ? "sBendLeft" : "sBendRight"]);
        case "loop":
            return many([m.dir === "left" ? "leftVerticalLoop" : "rightVerticalLoop"]);
        case "brakes":
            return many(Array(m.length).fill("brakes"), { brakeSpeed: m.speed ?? 10 });
        case "block_brakes":
            return many(["blockBrakes"], { brakeSpeed: 10 });
        case "photo":
            return many(["onRidePhoto"]);
        case "piece": {
            const s = named(m.name);
            if (typeof s === "string") return s;
            return [{ seg: s, chain: m.chain }];
        }
    }
}

/** Compile une liste de macros en pièces à partir d'une pose, avec transitions automatiques de pente/inclinaison. */
export function compileMacros(table: SegmentTable, ride: RideTrackInfo, start: TrackPose, macros: Macro[]): CompileResult {
    const pieces: PlannedPiece[] = [];
    const errors: { macro: number; message: string }[] = [];
    let pose = start;
    let current = 0;
    const push = (seg: TrackSegmentInfo, extra: { chain?: boolean; brakeSpeed?: number }) => {
        const piece = originAt(pose, seg);
        pieces.push({ ...piece, name: SegmentTable.nameOf(seg.type), ...extra, macro: current });
        pose = endPose(piece, seg);
    };
    macros.forEach((m, i) => {
        current = i;
        const reqs = expandMacro(table, ride, m, pose);
        if (typeof reqs === "string") {
            errors.push({ macro: i, message: reqs });
            return;
        }
        for (const r of reqs) {
            if (!fits(pose, r.seg)) {
                const t = findTransition(table, ride, pose, { slope: r.seg.beginSlope, bank: r.seg.beginBank });
                if (!t || (pose.rot & 4) !== (r.seg.beginDirection & 4)) {
                    errors.push({ macro: i, message: `${SegmentTable.nameOf(r.seg.type)} ne peut pas suivre l'état ${JSON.stringify(describePose(pose))}` });
                    return;
                }
                // Une montée de transition hérite de la chaîne si la macro est tractée.
                for (const seg of t) push(seg, { chain: r.chain && climbs(seg) });
            }
            push(r.seg, { chain: r.chain, brakeSpeed: r.brakeSpeed });
        }
    });
    return { pieces, end: pose, errors };
}

// ---------------------------------------------------------------------------
// Mesures et relecture d'un tracé (comparaison avec un circuit de référence)
// ---------------------------------------------------------------------------

export interface LayoutStats {
    pieces: number;
    /** Longueur de piste en tuiles (somme des longueurs de segments). */
    lengthTiles: number;
    footprint: { x1: number; y1: number; x2: number; y2: number; size: string };
    /** Tuiles de piste par tuile d'emprise : plus c'est haut, plus le tracé est compact et s'enroule sur lui-même. */
    density: number;
    minLevel: number;
    maxLevel: number;
    liftPieces?: number;
    inversions: number;
}

/** Une inversion compte une fois : la pièce qui fait passer à l'envers (ou la boucle entière). */
const startsInversion = (s: TrackSegmentInfo): boolean => (!!s.flags?.isInversion || s.endBank === ROLL.upsideDown) && s.beginBank !== ROLL.upsideDown;

export function layoutStats(table: SegmentTable, pieces: (TrackPieceInfo & { chain?: boolean })[], knowsChain = true): LayoutStats {
    let length = 0;
    let inversions = 0;
    let lift = 0;
    const blocks: { x: number; y: number; z: number }[] = [];
    for (const p of pieces) {
        const seg = table.get(p.type);
        if (!seg) continue;
        length += Math.max(seg.length, 1) / 32;
        if (startsInversion(seg)) inversions++;
        if (p.chain) lift++;
        blocks.push(...pieceElements(p, seg));
    }
    const xs = blocks.map((b) => b.x);
    const ys = blocks.map((b) => b.y);
    const zs = blocks.map((b) => b.z);
    const fp = blocks.length ? { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) } : { x1: 0, y1: 0, x2: -1, y2: -1 };
    const w = fp.x2 - fp.x1 + 1;
    const h = fp.y2 - fp.y1 + 1;
    return {
        pieces: pieces.length,
        lengthTiles: Math.round(length),
        footprint: { ...fp, size: `${w}×${h}` },
        density: w * h > 0 ? Math.round((length / (w * h)) * 100) / 100 : 0,
        minLevel: blocks.length ? Math.min(...zs) / 16 : 0,
        maxLevel: blocks.length ? Math.max(...zs) / 16 : 0,
        liftPieces: knowsChain ? lift : undefined,
        inversions,
    };
}

/**
 * Séquence lisible par groupes de pièces identiques, avec la hauteur au début et à la fin de chaque groupe :
 * « 17×up25⛓ L1→18, flatToDown25 L18… ». Sert à relire un circuit de référence pour en reprendre le style.
 */
export function describeSequence(
    table: SegmentTable,
    pieces: (TrackPieceInfo & { chain?: boolean; name?: string })[],
    baseZ = 0,
    /** Vitesse d'entrée de chaque pièce (km/h), affichée au début de chaque groupe. */
    speedsKmh?: number[],
): string {
    const out: string[] = [];
    const lvl = (z: number) => Math.round(((z - baseZ) / 16) * 2) / 2;
    let i = 0;
    while (i < pieces.length) {
        let j = i;
        while (j + 1 < pieces.length && pieces[j + 1].type === pieces[i].type && !!pieces[j + 1].chain === !!pieces[i].chain) j++;
        const a = table.get(pieces[i].type);
        const b = table.get(pieces[j].type);
        const z0 = a ? lvl(pieces[i].z + a.beginZ) : 0;
        const z1 = b ? lvl(pieces[j].z + b.endZ) : z0;
        const n = j - i + 1;
        const speed = speedsKmh ? ` @${speedsKmh[i] < 0 ? "?" : speedsKmh[i]}` : "";
        out.push(`${n > 1 ? `${n}×` : ""}${SegmentTable.nameOf(pieces[i].type)}${pieces[i].chain ? "⛓" : ""} L${z0}${z1 !== z0 ? `→${z1}` : ""}${speed}`);
        i = j + 1;
    }
    return out.join(", ");
}

/**
 * Défauts de style d'un plan, signalés sans bloquer : lift en courbe, virage serré ou non incliné pris à grande vitesse.
 * La vitesse est estimée par la hauteur perdue depuis le point le plus haut atteint avant la pièce (frottements ignorés).
 */
export function planWarnings(table: SegmentTable, pieces: PlannedPiece[], peakBefore: number): string[] {
    const out = new Map<string, string>();
    let peak = peakBefore;
    const isTurn = (s: TrackSegmentInfo | undefined) => s?.turnDirection === "left" || s?.turnDirection === "right";
    const curvedLift = pieces.filter((p) => p.chain && isTurn(table.get(p.type)));
    if (curvedLift.length) {
        out.set("lift", `Chaîne posée sur ${curvedLift.length} pièce(s) en virage (${curvedLift[0].name}) : un lift droit est plus lisible. Un lift 25° monte d'1 niveau par tuile, c'est normal ; la compacité vient du reste du tracé qui s'enroule autour et sous le lift.`);
    }
    for (const p of pieces) {
        const seg = table.get(p.type);
        if (!seg) continue;
        const zBegin = p.z + seg.beginZ;
        peak = Math.max(peak, zBegin);
        const lost = (peak - zBegin) / 16;
        const turning = isTurn(seg) && !seg.flags?.isInversion;
        const steep = isSteep(seg.beginSlope) || isSteep(seg.endSlope);
        if (turning && !steep && !p.chain && lost >= 8 && /3Tile|HelixUpSmall|HelixDownSmall/.test(p.name) && !out.has("tight")) {
            out.set("tight", `Virage serré ${p.name} en (${p.x},${p.y}) pris environ ${lost} niveaux sous le point haut : G élevés probables. Préfère size 'medium'/'large' (turn) ou une hélice large, ou ralentis avant (montée).`);
        }
        if (turning && !steep && !p.chain && lost >= 6 && seg.beginBank === 0 && seg.endBank === 0 && !out.has("unbanked")) {
            out.set("unbanked", `Virage non incliné ${p.name} en (${p.x},${p.y}) à grande vitesse (~${lost} niveaux sous le point haut) : G latéraux élevés ; mets banked: true.`);
        }
        peak = Math.max(peak, p.z + seg.endZ);
        // Après des freins, le train repart lentement : l'élan se compte depuis la sortie des freins (+2 niveaux de marge).
        if (/[bB]rakes$/.test(p.name)) peak = p.z + seg.endZ + 32;
    }
    return [...out.values()];
}

// ---------------------------------------------------------------------------
// Fermeture du circuit (SPEC 12.5) : A* pondéré de la pose courante vers la pose d'entrée de la station
// ---------------------------------------------------------------------------

export interface ClosureOptions {
    maxExpansions?: number;
    maxPieces?: number;
    weight?: number;
    zMin?: number;
    zMax?: number;
    /** Pièces interdites (refusées par le jeu lors d'une tentative précédente), clé `type@x,y,z,dir`. */
    forbidden?: Set<string>;
}

export interface ClosureResult {
    pieces: PlannedPiece[];
    expansions: number;
}

export const pieceKey = (p: TrackPieceInfo): string => `${p.type}@${p.x},${p.y},${p.z},${p.direction}`;

interface Node {
    pose: TrackPose;
    g: number;
    f: number;
    piece: TrackPieceInfo | null;
    seg: TrackSegmentInfo | null;
    elements: { x: number; y: number; z: number }[];
    parent: Node | null;
    depth: number;
}

class MinHeap {
    private a: Node[] = [];
    get size(): number {
        return this.a.length;
    }
    push(n: Node): void {
        const a = this.a;
        a.push(n);
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (a[p].f <= a[i].f) break;
            [a[p], a[i]] = [a[i], a[p]];
            i = p;
        }
    }
    pop(): Node | undefined {
        const a = this.a;
        if (!a.length) return undefined;
        const top = a[0];
        const last = a.pop() as Node;
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                if (l < a.length && a[l].f < a[m].f) m = l;
                if (r < a.length && a[r].f < a[m].f) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                i = m;
            }
        }
        return top;
    }
}

function pieceCost(seg: TrackSegmentInfo): number {
    let c = Math.max(1, seg.length / 32);
    if (seg.beginSlope !== seg.endSlope || seg.beginBank !== seg.endBank) c += 0.3;
    if (isSteep(seg.beginSlope) || isSteep(seg.endSlope)) c += 0.5;
    // Virages non inclinés : G latéraux élevés à vitesse de croisière (rapport de coaster_test).
    if (seg.turnDirection !== "straight" && seg.beginBank === 0 && seg.endBank === 0) c += 1.5;
    if (seg.turnDirection !== "straight" && Math.abs(seg.endX) <= 32 && Math.abs(seg.endY) <= 32) c += 0.8;
    // S-bends (décalage latéral sans changer de direction) : laids et brusques ; en dernier recours seulement.
    if (seg.endY !== 0 && seg.endDirection === seg.beginDirection) c += 3;
    return c;
}

function heuristic(p: TrackPose, goal: TrackPose): number {
    const man = Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);
    const dz = Math.abs(p.z - goal.z);
    let h = Math.max(man, dz / 64);
    if ((p.rot & 3) !== (goal.rot & 3)) h += 1.5;
    if (p.slope !== goal.slope || p.bank !== goal.bank) h += 1;
    return h;
}

function selfConflict(node: Node, elements: { x: number; y: number; z: number }[]): boolean {
    // Les blocs de la pièce précédente sont voisins par construction : on les saute.
    for (let n = node.parent?.parent ?? null; n; n = n.parent) {
        for (const a of n.elements) for (const b of elements) if (a.x === b.x && a.y === b.y && Math.abs(a.z - b.z) < TRACK_CLEARANCE) return true;
    }
    return false;
}

/** Cherche une suite de pièces de `start` à `goal` (pose exacte). */
export function planClosure(
    catalog: TrackSegmentInfo[],
    start: TrackPose,
    goal: TrackPose,
    occupancy: Occupancy,
    env: TrackEnv,
    opts: ClosureOptions = {},
): ClosureResult | null {
    const maxExp = opts.maxExpansions ?? 60_000;
    const maxPieces = opts.maxPieces ?? 80;
    const w = opts.weight ?? 1.5;
    const zMin = opts.zMin ?? 16;
    const zMax = opts.zMax ?? Math.max(start.z, goal.z) + 160;
    const byState = new Map<string, TrackSegmentInfo[]>();
    for (const s of catalog) {
        const k = `${s.beginSlope}|${s.beginBank}|${s.beginDirection & 4}`;
        const list = byState.get(k) ?? [];
        list.push(s);
        byState.set(k, list);
    }
    const goalKey = poseKey(goal);
    const best = new Map<string, number>();
    const heap = new MinHeap();
    heap.push({ pose: start, g: 0, f: w * heuristic(start, goal), piece: null, seg: null, elements: [], parent: null, depth: 0 });
    best.set(poseKey(start), 0);
    let expansions = 0;
    while (heap.size && expansions < maxExp) {
        const node = heap.pop() as Node;
        const k = poseKey(node.pose);
        if ((best.get(k) ?? Infinity) < node.g) continue;
        if (node.piece && selfConflict(node, node.elements)) continue;
        if (k === goalKey && node.piece) {
            const pieces: PlannedPiece[] = [];
            for (let n: Node | null = node; n && n.piece && n.seg; n = n.parent) {
                pieces.unshift({ ...n.piece, name: SegmentTable.nameOf(n.seg.type), chain: climbs(n.seg) || undefined });
            }
            return { pieces, expansions };
        }
        expansions++;
        if (node.depth >= maxPieces) continue;
        const list = byState.get(`${node.pose.slope}|${node.pose.bank}|${node.pose.rot & 4}`) ?? [];
        for (const seg of list) {
            const piece = originAt(node.pose, seg);
            if (opts.forbidden?.has(pieceKey(piece))) continue;
            const end = endPose(piece, seg);
            if (end.z < zMin || end.z > zMax) continue;
            const elements = pieceElements(piece, seg);
            if (elements.some((e) => e.z < zMin - 64 || blockProblem(env, e) !== null)) continue;
            if (occupancy.conflict(elements)) continue;
            const g = node.g + pieceCost(seg);
            const ek = poseKey(end);
            if ((best.get(ek) ?? Infinity) <= g) continue;
            best.set(ek, g);
            heap.push({ pose: end, g, f: g + w * heuristic(end, goal), piece, seg, elements, parent: node, depth: node.depth + 1 });
        }
    }
    return null;
}
