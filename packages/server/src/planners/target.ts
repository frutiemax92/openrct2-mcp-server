// Cibles tirées d'un circuit de référence (COASTER_SPACE.md, sections 9 et 7 tervicies) : longueur de piste, contour
// (emprise vue de dessus, trous compris), trains, forme de la première chute. coaster_build_plan les suit à chaque appel
// et refuse de fermer un circuit trop court, trop étalé (contour) ou qui fait tourner moins de trains que la référence.
// L'empilement et le dessous du lift sont mesurés mais n'imposent rien : un circuit peut être compact côte à côte.
// Fonctions pures.

import type { TrackPieceInfo } from "@openrct2-claude/protocol";
import { spaceProfile, type SpaceProfile } from "./space.js";
import { STATION_TYPES, SegmentTable, blockSections, layoutStats, type LayoutStats } from "./track.js";

type Piece = TrackPieceInfo & { chain?: boolean };

/** Longueur minimale d'un circuit fermé, en part de la référence (refus de fermeture en dessous). */
export const LENGTH_MIN = 0.9;
/** Au-delà, simple avertissement : le circuit déborde de la référence. */
export const LENGTH_MAX = 1.2;
/**
 * Contour maximal d'un circuit fermé (tuiles de piste + trous enfermés, vu de dessus), en part de la référence (refus
 * de fermeture au-dessus). Seul critère de compacité bloquant : avec la longueur minimale, il fixe aussi la densité.
 */
export const FOOTPRINT_MAX = 1.3;
/** Pièces raides (60° et 90°) minimales, en part de la référence (refus de fermeture en dessous). */
export const STEEP_MIN = 0.5;
/** Hauteur minimale de la première chute, en part de celle de la référence (refus de pose en dessous). */
export const DROP_MIN = 0.8;
/** Tuiles à plat au sommet du lift permises en plus de la référence avant la première chute (refus de pose au-delà). */
export const TOP_RUN_SLACK = 3;
/** Tuiles horizontales par niveau de lift (25°) et de chute raide (60°) : lift 23 ≈ 23 tuiles, chute raide 20 ≈ 10. */
const LIFT_TILES_PER_LEVEL = 1;
const DROP_TILES_PER_LEVEL = 0.5;
/** km/h par √niveau de première chute (Black Widow : 87 km/h pour 17 niveaux), quand la vitesse de la référence est inconnue. */
const KMH_PER_SQRT_LEVEL = 21;
/** Petit côté en plus par train au-delà de la référence (frein de bloc à plat, puis descente pour repartir). */
const SHORT_PER_EXTRA_TRAIN = 0.1;

/**
 * Première chute : ce qui suit le sommet du premier lift. topRun = tuiles de piste entre le haut de la chaîne et la
 * première pièce qui descend (virage à plat au sommet) ; puis la chute jusqu'à la première pièce qui ne descend plus.
 */
export interface FirstDrop {
    /** La chute est finie (une pièce qui ne descend pas la suit) : elle se juge alors, circuit ouvert compris. */
    complete: boolean;
    /** Index (dans pieces) de la dernière pièce de chaîne, et de la première pièce après la chute. */
    liftEnd: number;
    end: number;
    topRun: number;
    /** Niveaux perdus du sommet du lift au bas de la chute. */
    height: number;
    /** Pièces à 60° ou 90° dans la chute. */
    steep: number;
}

const isSteep = (type: number): boolean => /60|90/.test(SegmentTable.nameOf(type));

/** Première chute d'un circuit (pièces dans l'ordre de marche) ; null tant que le lift n'est pas fini. */
export function firstDrop(table: SegmentTable, pieces: Piece[]): FirstDrop | null {
    const i0 = pieces.findIndex((p) => p.chain && !STATION_TYPES.has(p.type));
    if (i0 < 0) return null;
    let i = i0;
    while (i + 1 < pieces.length && pieces[i + 1].chain) i++;
    if (i + 1 >= pieces.length) return null;
    const liftEnd = i;
    const len = (p: Piece) => Math.max(table.get(p.type)?.length ?? 32, 1) / 32;
    const descends = (p: Piece) => {
        const seg = table.get(p.type);
        return !!seg && seg.endZ < seg.beginZ;
    };
    let j = liftEnd + 1;
    let topRun = 0;
    while (j < pieces.length && !descends(pieces[j])) topRun += len(pieces[j++]);
    let height = 0;
    let steep = 0;
    for (; j < pieces.length && descends(pieces[j]); j++) {
        const seg = table.require(pieces[j].type);
        height += (seg.beginZ - seg.endZ) / 16;
        if (isSteep(pieces[j].type)) steep++;
    }
    return { complete: j < pieces.length, liftEnd, end: j, topRun: Math.round(topRun * 10) / 10, height, steep };
}

/** Pièces à 60° et à 90° du circuit entier. */
export function steepCount(pieces: Piece[]): number {
    return pieces.filter((p) => isSteep(p.type)).length;
}

export interface ReferenceTarget {
    name: string;
    pieces: number;
    /** Longueur de piste en tuiles (somme des longueurs de segments). */
    lengthTiles: number;
    /** Emprise : tuiles du contour vu de dessus (piste + trous enfermés), pas le rectangle englobant. */
    footprintArea: number;
    /** Trous enfermés par la piste (tuiles), compris dans footprintArea. */
    holes?: number;
    /** Tuiles de piste par tuile du contour. */
    density: number;
    coverage: number;
    stackedTiles: number;
    /** Tuiles du lift qui portent aussi une autre partie du circuit. */
    liftShared: number;
    inversions: number;
    maxTrains: number;
    /** Écart de hauteur du circuit (niveau max − niveau min), en niveaux. */
    heightLevels: number;
    /** Pièces à 60° et à 90° (la forme : Black Widow plonge et remonte à 60°). */
    steepPieces?: number;
    /** Première chute de la référence (raide ou non, hauteur, tuiles à plat au sommet). */
    firstDrop?: FirstDrop | null;
    /** Vitesse de pointe prédite (km/h), donnée par l'appelant (simulateur, même train que le circuit construit). */
    topSpeedKmh?: number;
    /** Côtés de l'emprise (grand, petit), modifications comprises. */
    footprintSides?: [number, number];
    /** Modifications demandées (applyMods) ; les champs ci-dessus en tiennent déjà compte. */
    mods?: ReferenceMods;
    /** Référence avant modifications : l'emprise permise se recalcule à la fermeture sur la chute réellement posée. */
    base?: { sides: [number, number]; area: number; density: number; dropHeight: number; maxTrains: number; topSpeedKmh?: number; extraLevels: number };
}

/** « Comme la référence, mais… » : trains au total, niveaux de plus, km/h de plus, % de piste en plus. */
export interface ReferenceMods {
    trains?: number;
    taller?: number;
    faster?: number;
    longer?: number;
}

export function targetFrom(name: string, layout: LayoutStats, space: SpaceProfile): ReferenceTarget {
    return {
        name,
        pieces: layout.pieces,
        lengthTiles: layout.lengthTiles,
        footprintArea: space.outline.area,
        holes: space.outline.holes,
        density: outlineDensity(layout, space),
        coverage: space.coverage,
        stackedTiles: space.stackedTiles,
        liftShared: space.elements.find((e) => e.kind === "lift")?.shared ?? 0,
        inversions: layout.inversions,
        maxTrains: layout.blocks.maxTrains,
        heightLevels: layout.maxLevel - layout.minLevel,
        footprintSides: sides(space.footprint.w, space.footprint.h),
    };
}

/** Tuiles de piste par tuile du contour. */
export function outlineDensity(layout: LayoutStats, space: SpaceProfile): number {
    return space.outline.area > 0 ? Math.round((layout.lengthTiles / space.outline.area) * 100) / 100 : 0;
}

const sides = (w: number, h: number): [number, number] => [Math.max(w, h), Math.min(w, h)];

/**
 * Niveaux de première chute en plus qu'exigent les modifications : taller tel quel, faster par v² ∝ hauteur
 * (au moins). La vitesse de la référence vient du simulateur si on l'a, sinon de sa chute.
 */
export function extraDropLevels(dropHeight: number, mods: ReferenceMods, topSpeedKmh?: number): number {
    let fromSpeed = 0;
    if (mods.faster && dropHeight > 0) {
        const v = topSpeedKmh ?? KMH_PER_SQRT_LEVEL * Math.sqrt(dropHeight);
        fromSpeed = dropHeight * (((v + mods.faster) / v) ** 2 - 1);
    }
    return Math.max(mods.taller ?? 0, fromSpeed);
}

/**
 * Emprise d'une référence modifiée. Plus long : les deux côtés × √k (densité inchangée). Plus haut ou plus rapide :
 * le lift et la première chute s'allongent sur le grand côté (1 tuile par niveau de lift, ½ par niveau de chute raide),
 * et le petit côté grandit comme la hauteur, car les virages à la vitesse de pointe s'élargissent comme v² (G latéraux).
 * Plus de trains : un frein de bloc de plus par train, sur du plat suivi d'une descente.
 * Sans ça, « Black Widow +3 niveaux, +8 km/h, +25 %, 3 trains » (lift 23, retour en gare) ne tenait pas dans
 * 1,3 × 1,25 × l'emprise de Black Widow : aucune fermeture possible (2026-10-08).
 */
export function grownFootprint(
    refSides: [number, number],
    dropHeight: number,
    mods: ReferenceMods,
    opts: { topSpeedKmh?: number; extraLevels?: number; refTrains?: number } = {},
): { long: number; short: number; area: number; extraLevels: number } {
    const s = Math.sqrt(1 + (mods.longer ?? 0) / 100);
    const extraLevels = opts.extraLevels ?? extraDropLevels(dropHeight, mods, opts.topSpeedKmh);
    const heightRatio = dropHeight > 0 ? (dropHeight + extraLevels) / dropHeight : 1;
    const extraTrains = Math.max(0, (mods.trains ?? 0) - (opts.refTrains ?? mods.trains ?? 0));
    const long = refSides[0] * s + extraLevels * (LIFT_TILES_PER_LEVEL + DROP_TILES_PER_LEVEL);
    const short = refSides[1] * s * heightRatio * (1 + SHORT_PER_EXTRA_TRAIN * extraTrains);
    return { long: Math.ceil(long), short: Math.ceil(short), area: Math.round(long * short), extraLevels: Math.round(extraLevels * 10) / 10 };
}

/**
 * Applique les modifications à une cible : longueur × k, hauteur, vitesse et trains visés, et l'emprise permise
 * agrandie par grownFootprint (la densité visée baisse d'autant : une chute plus longue est de la piste droite).
 * L'empilement et le dessous du lift (indicatifs) restent ceux de la référence.
 */
export function applyMods(t: ReferenceTarget, mods: ReferenceMods | undefined): ReferenceTarget {
    if (!mods || !Object.values(mods).some((v) => v !== undefined)) return t;
    const k = 1 + (mods.longer ?? 0) / 100;
    const refSides = t.footprintSides ?? sides(Math.ceil(Math.sqrt(t.footprintArea)), Math.ceil(Math.sqrt(t.footprintArea)));
    const dropHeight = t.firstDrop?.height ?? t.heightLevels;
    const g = grownFootprint(refSides, dropHeight, mods, { topSpeedKmh: t.topSpeedKmh, refTrains: t.maxTrains });
    // Aire des côtés contre aire mesurée : la mesure fait foi pour la référence elle-même (longer seul : × k exactement).
    const areaGrowth = g.area / (refSides[0] * refSides[1]);
    const footprintArea = Math.round(t.footprintArea * areaGrowth);
    return {
        ...t,
        name: `${t.name} modifié (${modsLabel(mods)})`,
        lengthTiles: Math.round(t.lengthTiles * k),
        footprintArea,
        footprintSides: [g.long, g.short],
        density: Math.round(((t.density * k) / areaGrowth) * 100) / 100,
        maxTrains: mods.trains ?? t.maxTrains,
        heightLevels: t.heightLevels + (mods.taller ?? 0),
        firstDrop: t.firstDrop && mods.taller ? { ...t.firstDrop, height: t.firstDrop.height + mods.taller } : t.firstDrop,
        topSpeedKmh: t.topSpeedKmh === undefined ? undefined : t.topSpeedKmh + (mods.faster ?? 0),
        mods,
        base: { sides: refSides, area: t.footprintArea, density: t.density, dropHeight, maxTrains: t.maxTrains, topSpeedKmh: t.topSpeedKmh, extraLevels: g.extraLevels },
    };
}

/**
 * Emprise et densité permises à la fermeture : celles de la cible, ou plus si la première chute posée a dû monter
 * plus haut que prévu pour atteindre la vitesse (Haiku : lift 23 pour +8 km/h, l'estimation v² en donnait 20).
 * Plafonné à 2 × l'estimation + 3 niveaux, pour qu'un lift démesuré n'ouvre pas une emprise sans limite.
 */
export function allowedSpace(t: ReferenceTarget, ride: FirstDrop | null | undefined): { area: number; density: number; extraLevels: number } {
    const b = t.base;
    if (!b || !t.mods || !(t.mods.taller || t.mods.faster) || !ride?.complete) return { area: t.footprintArea, density: t.density, extraLevels: b?.extraLevels ?? 0 };
    const built = ride.height - b.dropHeight;
    const extraLevels = Math.min(Math.max(built, b.extraLevels), 2 * b.extraLevels + 3);
    if (extraLevels <= b.extraLevels) return { area: t.footprintArea, density: t.density, extraLevels: b.extraLevels };
    const g = grownFootprint(b.sides, b.dropHeight, t.mods, { extraLevels, refTrains: b.maxTrains });
    const areaGrowth = g.area / (b.sides[0] * b.sides[1]);
    const k = 1 + (t.mods.longer ?? 0) / 100;
    return { area: Math.round(b.area * areaGrowth), density: Math.round(((b.density * k) / areaGrowth) * 100) / 100, extraLevels };
}

function modsLabel(m: ReferenceMods): string {
    return [
        m.trains !== undefined ? `${m.trains} trains` : "",
        m.taller ? `+${m.taller} niveaux` : "",
        m.faster ? `+${m.faster} km/h` : "",
        m.longer ? `+${m.longer} % de piste` : "",
    ]
        .filter(Boolean)
        .join(", ");
}

/** Cibles d'un circuit fermé (circuit du parc ou design relu). */
export function referenceTarget(name: string, table: SegmentTable, pieces: Piece[]): ReferenceTarget {
    return { ...targetFrom(name, layoutStats(table, pieces), spaceProfile(table, pieces, { closed: true })), steepPieces: steepCount(pieces), firstDrop: firstDrop(table, pieces) };
}

/**
 * Forme de la première chute contre la référence : refus dès qu'elle est finie, circuit ouvert compris (le reste du
 * circuit ne la rattrape pas). Haiku posait un virage à plat de 180° au sommet du lift puis une chute à 25° alors que
 * Black Widow plonge à 60° dès le sommet ; seuls des avertissements le disaient.
 */
export function firstDropProblems(t: ReferenceTarget, ride: FirstDrop | null | undefined): string[] {
    const ref = t.firstDrop;
    if (!ref || !ride?.complete) return [];
    const out: string[] = [];
    if (ride.topRun > ref.topRun + TOP_RUN_SLACK)
        out.push(
            `SOMMET : ${ride.topRun} tuiles de piste entre le haut du lift et la première chute contre ${ref.topRun} dans ${t.name} : ` +
                (ref.topRun <= 1 ? "la référence plonge dès le sommet. " : "") +
                "Le train s'y traîne à moins de 10 km/h ; enchaîne la chute juste après le lift (pour tourner, tourne en descendant : turn { slope: 'down' } ou 'steep_down')",
        );
    if (ref.steep > 0 && ride.steep === 0)
        out.push(`PREMIÈRE CHUTE PAS RAIDE : 0 pièce à 60° contre ${ref.steep} dans ${t.name} : drop { height, steep: true }`);
    if (ride.height < Math.floor(ref.height * DROP_MIN))
        out.push(`PREMIÈRE CHUTE TROP COURTE : ${ride.height} niveaux contre ${ref.height} dans ${t.name} (minimum ${Math.floor(ref.height * DROP_MIN)}) : descends jusqu'au sol ou sous la station`);
    return out;
}

const pct = (x: number): number => Math.round(x * 100);

function dropLabel(d: FirstDrop | null | undefined): string {
    if (!d) return "lift pas fini";
    return `${d.topRun} t à plat, chute ${d.height} niv${d.steep ? ` dont ${d.steep} à 60°` : " à 25°"}${d.complete ? "" : " (en cours)"}`;
}

export interface TargetCheck {
    /** Progression lisible : « 120 / 205 tuiles (59 %) »… */
    view: Record<string, unknown>;
    /** Écarts à corriger (avertissements). */
    warnings: string[];
    /** Écarts qui interdisent de fermer le circuit : longueur, trains, contour, pièces raides, hauteur, vitesse. */
    blocking: string[];
}

/**
 * Compare le circuit (ouvert ou fermé) à la référence. Sur un circuit ouvert, seule la longueur restante est donnée :
 * contour et densité ne se jugent qu'à la fermeture.
 */
export function checkTarget(
    t: ReferenceTarget,
    layout: LayoutStats,
    space: SpaceProfile,
    closed: boolean,
    ride: { topSpeedKmh?: number; firstDrop?: FirstDrop | null; steepPieces?: number } = {},
): TargetCheck {
    const minLength = Math.ceil(t.lengthTiles * LENGTH_MIN);
    const lift = space.elements.find((e) => e.kind === "lift")?.shared ?? 0;
    const allowed = allowedSpace(t, ride.firstDrop);
    const view: Record<string, unknown> = {
        reference: t.name,
        lengthTiles: `${layout.lengthTiles} / ${t.lengthTiles} (${pct(layout.lengthTiles / t.lengthTiles)} %, minimum ${minLength} pour fermer)`,
        remainingTiles: Math.max(0, minLength - layout.lengthTiles),
        density: `${outlineDensity(layout, space)} / ${t.density}`,
        stackedTiles: `${space.stackedTiles} / ${t.stackedTiles} (indicatif)`,
        liftShared: `${lift} / ${t.liftShared} (indicatif)`,
        maxTrains: `${layout.blocks.maxTrains} / ${t.maxTrains}`,
        heightLevels: `${layout.maxLevel - layout.minLevel} / ${t.heightLevels}`,
        footprint: `contour ${space.outline.area} tuiles (${space.outline.holes} de trous) / ${Math.floor(allowed.area * FOOTPRINT_MAX)} permises${t.mods ? ` (agrandie par les modifications${allowed.extraLevels ? `, chute +${allowed.extraLevels} niveaux` : ""})` : ""}`,
        ...(t.topSpeedKmh !== undefined && ride.topSpeedKmh !== undefined ? { topSpeedKmh: `${Math.round(ride.topSpeedKmh)} / ${Math.round(t.topSpeedKmh)}` } : {}),
        ...(t.firstDrop ? { firstDrop: `${dropLabel(ride.firstDrop)} / ${dropLabel(t.firstDrop)}` } : {}),
        ...(t.steepPieces !== undefined && ride.steepPieces !== undefined ? { steepPieces: `${ride.steepPieces} / ${t.steepPieces}` } : {}),
    };
    const warnings: string[] = [];
    // Forme de la première chute : bloquante dès qu'elle est posée, ouvert ou fermé.
    const blocking: string[] = firstDropProblems(t, ride.firstDrop);
    const height = layout.maxLevel - layout.minLevel;
    const slow = t.topSpeedKmh !== undefined && ride.topSpeedKmh !== undefined && ride.topSpeedKmh < t.topSpeedKmh;
    if (!closed) {
        // Hauteur et vitesse se jouent au lift et à la première chute : les signaler dès que le lift est posé.
        if (layout.blocks.liftTops > 0 && t.mods?.taller && height < t.heightLevels)
            warnings.push(
                `HAUTEUR : ${height} niveaux d'écart (sommet − point bas) contre ${t.heightLevels} visés (${t.name}) : monte le lift plus haut ou fais descendre la première chute plus bas (jusqu'au sol, ou sous la station).`,
            );
        if (layout.blocks.liftTops > 0 && t.mods?.faster && slow)
            warnings.push(
                `VITESSE : ${Math.round(ride.topSpeedKmh!)} km/h au plus jusqu'ici contre ${Math.round(t.topSpeedKmh!)} visés (${t.name}) : la première chute doit perdre plus de hauteur (lift plus haut, chute jusqu'au sol ou sous la station).`,
            );
        if (layout.lengthTiles < minLength)
            warnings.push(
                `LONGUEUR : ${layout.lengthTiles} tuiles de piste sur ${t.lengthTiles} dans ${t.name} ; il en reste au moins ${minLength - layout.lengthTiles} à poser avant de fermer ` +
                    "(la fermeture sera refusée en dessous). Ajoute des éléments qui s'enroulent près de la piste déjà posée (hélices, virages en pente), sans laisser de trous, pas des droites. Pour la fin du circuit, coaster_search_section cherche une seconde moitié compacte dans bounds ; la poser à la main donne des circuits étalés.",
            );
        return { view, warnings, blocking };
    }
    if (layout.lengthTiles < minLength)
        blocking.push(`circuit trop court : ${layout.lengthTiles} tuiles de piste contre ${t.lengthTiles} dans ${t.name} (minimum ${minLength}, ${pct(LENGTH_MIN)} %)`);
    if (t.mods?.taller && height < t.heightLevels) blocking.push(`${height} niveaux d'écart de hauteur contre ${t.heightLevels} visés (${t.name}) : lift plus haut ou chute plus basse`);
    if (t.mods?.faster && slow) blocking.push(`vitesse de pointe ${Math.round(ride.topSpeedKmh!)} km/h contre ${Math.round(t.topSpeedKmh!)} visés (${t.name}) : la première chute doit perdre plus de hauteur`);
    if (t.steepPieces && ride.steepPieces !== undefined && ride.steepPieces < Math.ceil(t.steepPieces * STEEP_MIN))
        blocking.push(
            `${ride.steepPieces} pièces raides (60°) contre ${t.steepPieces} dans ${t.name} (minimum ${Math.ceil(t.steepPieces * STEEP_MIN)}) : collines et chutes steep: true, virages turn { slope: 'steep_down' }`,
        );
    if (layout.blocks.maxTrains < t.maxTrains) blocking.push(`${layout.blocks.maxTrains} train(s) permis contre ${t.maxTrains} dans ${t.name} : ajoute des block_brakes`);
    // Compacité : le contour vu de dessus (piste + trous enfermés), agrandi si la chute posée a dû monter plus haut
    // (allowedSpace). Avec la longueur minimale, il borne aussi la densité. L'empilement et le dessous du lift n'étaient
    // qu'un moyen d'être compact, et les exiger écartait les tracés serrés côte à côte (COASTER_SPACE 7 tervicies).
    if (space.outline.area > allowed.area * FOOTPRINT_MAX)
        blocking.push(
            `contour ${space.outline.area} tuiles (${space.outline.holes} de trous) contre ${allowed.area} dans ${t.name} (${(space.outline.area / allowed.area).toFixed(2)} ×, maximum ${FOOTPRINT_MAX} ×) : ` +
                "le tracé laisse trop de trous vu de dessus ; resserre-le (hélices, virages en pente, passages à côté ou au-dessus de la piste déjà posée)",
        );
    if (layout.lengthTiles > t.lengthTiles * LENGTH_MAX) warnings.push(`circuit long : ${layout.lengthTiles} tuiles de piste contre ${t.lengthTiles} dans ${t.name}`);
    warnings.push(...targetLevers(targetFrom("circuit", layout, space), t));
    return { view, warnings, blocking };
}

/** Leviers de longueur et de densité (coaster_compare et fermeture) : rien si le circuit tient la référence. */
export function targetLevers(ride: ReferenceTarget, ref: ReferenceTarget): string[] {
    const out: string[] = [];
    if (ride.lengthTiles < ref.lengthTiles * LENGTH_MIN)
        out.push(`longueur ${ride.lengthTiles} tuiles de piste contre ${ref.lengthTiles} (${pct(ride.lengthTiles / ref.lengthTiles)} %) : ajoute ${ref.lengthTiles - ride.lengthTiles} tuiles dans la même emprise`);
    if (ride.density < ref.density * 0.85)
        out.push(`densité ${ride.density} tuile de piste par tuile du contour contre ${ref.density} : à contour égal, la référence pose ${Math.round((ref.density / Math.max(ride.density, 0.01) - 1) * 100)} % de piste en plus`);
    return out;
}
