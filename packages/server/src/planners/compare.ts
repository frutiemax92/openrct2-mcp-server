// Comparaison d'un circuit à une référence (COASTER_REFERENCE P2) : mesures gardées par attraction, profils le long
// du parcours et écarts de notes par composante, pour conclure sur les leviers qui rapportent le plus.

import type { RideDetail, TrackPieceInfo } from "@openrct2-claude/protocol";
import type { RatingInputs, TermPart } from "./ratings.js";
import { elementKind } from "./speed.js";
import { SegmentTable, type LayoutStats } from "./track.js";

/** Terme de note tel que gardé avec une mesure (notes en centièmes). */
export interface StoredTerm {
    key: string;
    excitement: number;
    intensity: number;
    nausea: number;
    input?: string;
    parts?: TermPart[];
}

/** Mesures d'un essai, gardées par attraction pour ne pas retester inutilement. */
export interface CoasterMeasure {
    rideId: number;
    name: string;
    rideType: number;
    /** Empreinte du circuit (nombre de pièces + hachage) : la mesure ne vaut que pour ce circuit. */
    fingerprint: string;
    measuredAt: string;
    ratings: { excitement: number; intensity: number; nausea: number };
    stats: RideDetail["stats"];
    layout: LayoutStats;
    pieces: TrackPieceInfo[];
    /** Vitesse d'entrée mesurée par pièce (km/h, -1 si aucun relevé). */
    speedsKmh: number[];
    /** G mesurés par pièce (null si aucun relevé). */
    g: ({ vertMax: number; vertMin: number; latMax: number } | null)[];
    rating?: { terms: StoredTerm[]; inputs: RatingInputs; computed: { excitement: number; intensity: number; nausea: number } };
}

/** Empreinte d'un circuit : nombre de pièces et hachage FNV-1a de leurs types et positions. */
export function circuitFingerprint(pieces: TrackPieceInfo[]): string {
    let h = 0x811c9dc5;
    for (const p of pieces) {
        const s = `${p.type},${p.x},${p.y},${p.z},${p.direction};`;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
    }
    return `${pieces.length}:${h.toString(16).padStart(8, "0")}`;
}

/** Début de chaque pièce en fraction de la longueur (unités de segment), et la longueur totale. */
function cumulative(table: SegmentTable, pieces: TrackPieceInfo[]): { starts: number[]; total: number } {
    const starts: number[] = [];
    let u = 0;
    for (const p of pieces) {
        starts.push(u);
        u += Math.max(table.get(p.type)?.length ?? 32, 1);
    }
    return { starts: starts.map((s) => (u ? s / u : 0)), total: u };
}

/**
 * Vitesse (km/h) à intervalles réguliers de la longueur parcourue (0, 1/n … 1) : pièce qui contient le point, ou la
 * mesure connue la plus proche quand la pièce n'a pas de relevé.
 */
export function speedProfile(table: SegmentTable, pieces: TrackPieceInfo[], speedsKmh: number[], n = 10): (number | null)[] {
    const { starts } = cumulative(table, pieces);
    const known = speedsKmh.map((v, i) => ({ v, i })).filter((x) => x.v >= 0);
    const out: (number | null)[] = [];
    for (let k = 0; k <= n; k++) {
        const f = Math.min(k / n, 0.9999);
        let i = starts.length - 1;
        while (i > 0 && starts[i] > f) i--;
        if (speedsKmh[i] >= 0) out.push(speedsKmh[i]);
        else if (known.length) out.push(known.reduce((a, b) => (Math.abs(b.i - i) < Math.abs(a.i - i) ? b : a)).v);
        else out.push(null);
    }
    return out;
}

export interface GSection {
    /** Bornes en fraction de la longueur. */
    from: number;
    to: number;
    vertMax: number | null;
    vertMin: number | null;
    latMax: number | null;
}

/** G extrêmes par tranche de parcours (n tranches de même longueur). */
export function gSections(table: SegmentTable, pieces: TrackPieceInfo[], g: CoasterMeasure["g"], n = 5): GSection[] {
    const { starts } = cumulative(table, pieces);
    const out: GSection[] = [];
    for (let k = 0; k < n; k++) out.push({ from: k / n, to: (k + 1) / n, vertMax: null, vertMin: null, latMax: null });
    pieces.forEach((_, i) => {
        const s = g[i];
        if (!s) return;
        const sec = out[Math.min(n - 1, Math.floor(starts[i] * n))];
        const r = (v: number) => Math.round(v * 100) / 100;
        sec.vertMax = sec.vertMax === null ? r(s.vertMax) : Math.max(sec.vertMax, r(s.vertMax));
        sec.vertMin = sec.vertMin === null ? r(s.vertMin) : Math.min(sec.vertMin, r(s.vertMin));
        sec.latMax = sec.latMax === null ? r(s.latMax) : Math.max(sec.latMax, r(s.latMax));
    });
    return out;
}

/** Suite des éléments marquants (inversions, virages, hélices), répétitions consécutives regroupées. */
export function elementSequence(pieces: (TrackPieceInfo & { chain?: boolean })[]): string {
    const out: { kind: string; n: number }[] = [];
    let lift = 0;
    for (const p of pieces) {
        if (p.chain) {
            lift++;
            continue;
        }
        if (lift) {
            out.push({ kind: `lift×${lift}`, n: 1 });
            lift = 0;
        }
        const kind = elementKind(SegmentTable.nameOf(p.type));
        if (!kind) continue;
        const last = out[out.length - 1];
        if (last && last.kind === kind) last.n++;
        else out.push({ kind, n: 1 });
    }
    return out.map((e) => (e.n > 1 ? `${e.kind}×${e.n}` : e.kind)).join(" → ");
}

export interface RatingGap {
    key: string;
    /** Écart d'excitation référence − circuit (centièmes). */
    gap: number;
    ride: number;
    reference: number;
    rideInput?: string;
    referenceInput?: string;
}

/**
 * Écart d'excitation par composante, au grain le plus fin disponible (sous-parts des virages, G, chutes, proximité,
 * abri), trié du plus grand manque au plus grand surplus.
 */
export function ratingGaps(ride: StoredTerm[], reference: StoredTerm[]): RatingGap[] {
    const flat = (terms: StoredTerm[]) => {
        const m = new Map<string, { e: number; input?: string }>();
        for (const t of terms) {
            if (t.key === "base") continue;
            if (t.parts?.length) {
                // La somme des parts peut différer du terme d'1 ou 2 centièmes (arrondis séparés) : le reste va au terme.
                let rest = t.excitement;
                for (const p of t.parts) {
                    m.set(p.key, { e: p.excitement, input: p.input });
                    rest -= p.excitement;
                }
                if (rest) m.set(`${t.key}.arrondi`, { e: rest });
            } else m.set(t.key, { e: t.excitement, input: t.input });
        }
        return m;
    };
    const a = flat(ride);
    const b = flat(reference);
    const keys = new Set([...a.keys(), ...b.keys()]);
    const out: RatingGap[] = [];
    for (const k of keys) {
        if (k.endsWith(".arrondi")) continue;
        const x = a.get(k);
        const y = b.get(k);
        const gap = (y?.e ?? 0) - (x?.e ?? 0);
        if (!gap) continue;
        out.push({ key: k, gap, ride: x?.e ?? 0, reference: y?.e ?? 0, rideInput: x?.input, referenceInput: y?.input });
    }
    return out.sort((p, q) => q.gap - p.gap);
}

/** Libellés des composantes, pour les leviers. */
const LABELS: Record<string, string> = {
    averageSpeed: "vitesse moyenne",
    maxSpeed: "vitesse max",
    length: "longueur",
    duration: "durée",
    inversions: "inversions",
    helices: "hélices",
    flatTurns: "virages plats",
    bankedTurns: "virages inclinés",
    slopedTurns: "virages en pente",
    numDrops: "nombre de chutes",
    highestDrop: "plus haute chute",
    gPositive: "G verticaux max",
    gNegative: "G négatifs",
    gLateral: "G latéraux",
    "proximity.surfaceTouch": "pièces au ras du sol",
    "proximity.ownTrackTouchAbove": "piste qui touche sa propre piste au-dessus/au-dessous",
    "proximity.ownTrackCloseAbove": "piste proche de sa propre piste au-dessus/au-dessous",
    "proximity.surfaceSideClose": "piste en tranchée (terrain à côté plus haut)",
    "proximity.pathSideClose": "chemins à côté de la piste",
    "proximity.scenerySideBelow": "scénerie à côté de la piste",
    "proximity.scenerySideAbove": "scénerie à côté, sous la piste",
    shelteredSections: "sections abritées (tunnels)",
    shelteredLength: "longueur abritée",
    scenery: "scénerie autour de la station",
    trainLength: "voitures par train",
    airTime: "temps en l'air",
    intensityPenalty: "pénalité d'intensité",
    lateralPenalty: "pénalité de G latéraux",
};

export const gapLabel = (key: string): string => LABELS[key] ?? key;

/** Phrases des n leviers qui rapportent le plus : « +0,37 : vitesse moyenne 23 mph → 32 mph ». */
export function topLevers(gaps: RatingGap[], n = 3): string[] {
    return gaps
        .filter((g) => g.gap > 0)
        .slice(0, n)
        .map((g) => {
            const inputs = g.rideInput || g.referenceInput ? ` ${g.rideInput ?? "0"} → ${g.referenceInput ?? "0"}` : "";
            return `+${(g.gap / 100).toFixed(2)} : ${gapLabel(g.key)}${inputs}`;
        });
}
