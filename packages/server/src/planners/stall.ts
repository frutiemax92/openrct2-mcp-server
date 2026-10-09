// Train arrêté en essai (SPEC 12.4, « train bloqué ») : le jeu ne lève hasStalledVehicle ni sur un circuit à sections de
// bloc (Vehicle::CheckIfMissing sort dès isBlockSectioned), ni avant 9600 ticks ; le serveur le déduit des relevés.

import type { TrackPieceInfo } from "@openrct2-claude/protocol";
import { SegmentTable, STATION_TYPES } from "./track.js";
import { mphToKmh, type MeasuredPiece } from "./speed.js";

/** Nombre de pas d'essai consécutifs sans nouvelle pièce parcourue au-delà duquel le train est déclaré bloqué. */
export const STALL_STEPS = 2;

export interface StallInfo {
    /** Dernière pièce atteinte (indice dans le circuit) : le train s'y est arrêté ou y a reculé. */
    index: number;
    piece: string;
    tile: { x: number; y: number };
    /** Niveau absolu de la pièce (1 niveau = 16 unités). */
    level: number;
    /** Vitesse d'entrée mesurée (km/h) et vitesse minimale dans la pièce. */
    enterKmh: number;
    minKmh: number;
    /** Pièce suivante, jamais atteinte (absente si la dernière pièce du circuit a été atteinte). */
    next?: string;
    /** Pièces parcourues / total. */
    reached: number;
    total: number;
    message: string;
}

/** Pièces dont au moins une frame a été relevée. */
export const reachedCount = (measured: MeasuredPiece[]): number => measured.filter((m) => m.sample && m.sample.n > 0).length;

/**
 * Le premier train a fait le tour : la dernière pièce du circuit (celle d'avant la station) a un relevé. Plus aucune
 * pièce nouvelle n'est alors relevée aux pas suivants, sans que le train soit bloqué : les pièces trop courtes pour une
 * frame à vitesse 4 n'en auront jamais.
 */
export const lapCompleted = (measured: MeasuredPiece[]): boolean => {
    const last = measured[measured.length - 1];
    return !!last?.sample && last.sample.n > 0;
};

/**
 * Où le train s'est arrêté : la pièce la plus avancée du circuit où un relevé existe. Les pièces d'après n'ont jamais
 * été atteintes (une pièce trop courte pour une frame à vitesse 4 n'a pas de relevé : on remonte au dernier relevé).
 */
export function findStall(measured: MeasuredPiece[]): StallInfo | undefined {
    let last = -1;
    measured.forEach((m, i) => {
        if (m.sample && m.sample.n > 0) last = i;
    });
    if (last < 0) return undefined;
    const m = measured[last];
    const s = m.sample!;
    const piece = SegmentTable.nameOf(m.piece.type);
    const next = measured[last + 1] ? SegmentTable.nameOf(measured[last + 1].piece.type) : undefined;
    const enterKmh = mphToKmh(s.vFirst);
    const minKmh = mphToKmh(s.vMin);
    const level = Math.round((m.piece.z / 16) * 10) / 10;
    const where = `pièce ${last + 1}/${measured.length} ${piece} en (${m.piece.x},${m.piece.y}) niveau ${level}`;
    const cause = STATION_TYPES.has(m.piece.type)
        ? "le train ne quitte pas la station (départ bloqué : sections de bloc, ou temps d'attente)."
        : m.piece.chain
          ? "la chaîne ne tient pas le train (pente trop raide pour la chaîne ?)."
          : `élan insuffisant : entrée à ${enterKmh} km/h, ${minKmh} km/h au plus bas. Baisse la hauteur de l'élément (ou de ce qui le précède), avance-le, ou ajoute une descente avant.`;
    return {
        index: last,
        piece,
        tile: { x: m.piece.x, y: m.piece.y },
        level,
        enterKmh,
        minKmh,
        next,
        reached: reachedCount(measured),
        total: measured.length,
        message: `TRAIN BLOQUÉ sur ${where}${next ? `, avant ${next}` : ""} : ${cause}`,
    };
}

// ---------------------------------------------------------------------------
// Frein de bloc fermé : le train repart de presque rien
// ---------------------------------------------------------------------------

/** Vitesse de repartie d'un frein de bloc (kBlockBrakeBaseSpeed 0x20364, ToHumanReadableSpeed : v × 9 >> 18). */
export const BLOCK_RELEASE_MPH = (0x20364 * 9) / 262144;
export const BLOCK_BRAKE_NAMES = new Set(["blockBrakes", "diagBlockBrakes"]);
const STOP_AFTER = /[bB]rakes$/;
/** Pièces suivantes simulées après un frein de bloc (jusqu'au prochain frein, station ou chaîne). */
export const RESTART_WINDOW = 40;
/** Pièces d'avant le frein où poser la queue du train (plus longues que le plus long des trains, ~7 tuiles). */
export const TAIL_CONTEXT = 16;

type BrakePiece = TrackPieceInfo & { chain?: boolean; brakeSpeed?: number };

/**
 * Le simulateur ne passe un frein de bloc que « ouvert » (un train à la fois). Dès qu'il y a plusieurs trains, un bloc
 * occupé arrête le train, tête sur le frein, que le jeu relâche à ~7 km/h (applyNonstopBlockBrake : vitesse tenue tant
 * que la tête est sur le frein) : la queue est alors encore sur les pièces d'avant le frein, et toute montée qui suit
 * se fait sur cet élan. Pour chaque frein de bloc, simule la repartie, queue comprise, et signale la première pièce où
 * le train cale ou recule. Une seconde simulation, queue sur du plat, distingue la queue restée dans la montée d'avant
 * (frein au sommet d'une colline : le train recule sur le suivant) d'une montée trop haute après le frein.
 */
export function blockBrakeRestartWarnings(
    pieces: BrakePiece[],
    simulateFrom: (slice: BrakePiece[], vStartMph: number, startPiece: number) => { stall: boolean; vIn: number; reached?: boolean }[],
): string[] {
    const out: string[] = [];
    pieces.forEach((p, i) => {
        if (!BLOCK_BRAKE_NAMES.has(SegmentTable.nameOf(p.type))) return;
        if (pieces[i + 1] && BLOCK_BRAKE_NAMES.has(SegmentTable.nameOf(pieces[i + 1].type))) return;
        const after: BrakePiece[] = [];
        for (let j = i + 1; j < pieces.length && after.length < RESTART_WINDOW; j++) {
            const q = pieces[j];
            if (q.chain || STATION_TYPES.has(q.type) || STOP_AFTER.test(SegmentTable.nameOf(q.type))) break;
            after.push(q);
        }
        if (!after.length) return;
        const from = Math.max(0, i - TAIL_CONTEXT);
        const slice = [...pieces.slice(from, i + 1), ...after];
        const start = i - from;
        const stallAt = (sim: { stall: boolean }[], offset: number): number => sim.findIndex((s, k) => k >= offset && s.stall);
        const k = stallAt(simulateFrom(slice, BLOCK_RELEASE_MPH, start), start);
        if (k < 0) return;
        const q = slice[k];
        const nth = k - start;
        const onFlatTail = stallAt(simulateFrom([p, ...after], BLOCK_RELEASE_MPH, 0), 0) >= 0;
        const release = `le frein de bloc en (${p.x},${p.y}) arrête le train quand le bloc suivant est occupé (plusieurs trains) et ne le relâche qu'à ${mphToKmh(BLOCK_RELEASE_MPH)} km/h`;
        const where = nth > 0 ? `sur ${SegmentTable.nameOf(q.type)} en (${q.x},${q.y}) (${nth}e pièce après le frein)` : `sur le frein`;
        out.push(
            onFlatTail
                ? `FREIN DE BLOC AVANT UNE MONTÉE : ${release} ; il cale ensuite ${where}. Pose le frein de bloc sur un plat suivi d'une descente (ou d'une chaîne), jamais devant une colline.`
                : `FREIN DE BLOC AU SOMMET D'UNE MONTÉE : ${release}, la queue du train encore dans la montée d'avant le frein ; elle le tire en arrière ${where} : il recule et percute le train suivant (accident). ` +
                      `Pose le frein de bloc au bout d'un plat au moins aussi long que le train (brakes{length} puis block_brakes, comme en gare), jamais au sommet d'une colline.`,
        );
    });
    return out;
}
