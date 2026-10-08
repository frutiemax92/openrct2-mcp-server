// Cibles tirées d'un circuit de référence (COASTER_SPACE.md, section 9) : longueur de piste, densité, empilement,
// dessous du lift et trains. coaster_build_plan les suit à chaque appel et refuse de fermer un circuit trop court
// ou qui fait tourner moins de trains que la référence. Fonctions pures.

import type { TrackPieceInfo } from "@openrct2-claude/protocol";
import { spaceProfile, type SpaceProfile } from "./space.js";
import { blockSections, layoutStats, type LayoutStats, type SegmentTable } from "./track.js";

type Piece = TrackPieceInfo & { chain?: boolean };

/** Longueur minimale d'un circuit fermé, en part de la référence (refus de fermeture en dessous). */
export const LENGTH_MIN = 0.9;
/** Au-delà, simple avertissement : le circuit déborde de la référence. */
export const LENGTH_MAX = 1.2;
/** Densité minimale d'un circuit fermé, en part de la référence (refus de fermeture en dessous). */
export const DENSITY_MIN = 0.75;
/** Emprise maximale d'un circuit fermé, en part de la référence (refus de fermeture au-dessus). */
export const FOOTPRINT_MAX = 1.3;
/** Tuiles empilées minimales, en part de la référence (refus de fermeture en dessous). */
export const STACKED_MIN = 0.4;
/** Dessous du lift minimal, en part de la référence, quand elle en a un (refus de fermeture en dessous). */
export const LIFT_SHARED_MIN = 0.25;

export interface ReferenceTarget {
    name: string;
    pieces: number;
    /** Longueur de piste en tuiles (somme des longueurs de segments). */
    lengthTiles: number;
    footprintArea: number;
    /** Tuiles de piste par tuile d'emprise. */
    density: number;
    coverage: number;
    stackedTiles: number;
    /** Tuiles du lift qui portent aussi une autre partie du circuit. */
    liftShared: number;
    inversions: number;
    maxTrains: number;
}

export function targetFrom(name: string, layout: LayoutStats, space: SpaceProfile): ReferenceTarget {
    return {
        name,
        pieces: layout.pieces,
        lengthTiles: layout.lengthTiles,
        footprintArea: space.footprint.area,
        density: layout.density,
        coverage: space.coverage,
        stackedTiles: space.stackedTiles,
        liftShared: space.elements.find((e) => e.kind === "lift")?.shared ?? 0,
        inversions: layout.inversions,
        maxTrains: layout.blocks.maxTrains,
    };
}

/** Cibles d'un circuit fermé (circuit du parc ou design relu). */
export function referenceTarget(name: string, table: SegmentTable, pieces: Piece[]): ReferenceTarget {
    return targetFrom(name, layoutStats(table, pieces), spaceProfile(table, pieces, { closed: true }));
}

const pct = (x: number): number => Math.round(x * 100);

export interface TargetCheck {
    /** Progression lisible : « 120 / 205 tuiles (59 %) »… */
    view: Record<string, unknown>;
    /** Écarts à corriger (avertissements). */
    warnings: string[];
    /** Écarts qui interdisent de fermer le circuit : longueur, trains, emprise, densité, empilement, dessous du lift. */
    blocking: string[];
}

/**
 * Compare le circuit (ouvert ou fermé) à la référence. Sur un circuit ouvert, seule la longueur restante est donnée :
 * densité et empilement ne se jugent qu'à la fermeture.
 */
export function checkTarget(t: ReferenceTarget, layout: LayoutStats, space: SpaceProfile, closed: boolean): TargetCheck {
    const minLength = Math.ceil(t.lengthTiles * LENGTH_MIN);
    const lift = space.elements.find((e) => e.kind === "lift")?.shared ?? 0;
    const view: Record<string, unknown> = {
        reference: t.name,
        lengthTiles: `${layout.lengthTiles} / ${t.lengthTiles} (${pct(layout.lengthTiles / t.lengthTiles)} %, minimum ${minLength} pour fermer)`,
        remainingTiles: Math.max(0, minLength - layout.lengthTiles),
        density: `${layout.density} / ${t.density}`,
        stackedTiles: `${space.stackedTiles} / ${t.stackedTiles}`,
        liftShared: `${lift} / ${t.liftShared}`,
        maxTrains: `${layout.blocks.maxTrains} / ${t.maxTrains}`,
    };
    const warnings: string[] = [];
    const blocking: string[] = [];
    if (!closed) {
        if (layout.lengthTiles < minLength)
            warnings.push(
                `LONGUEUR : ${layout.lengthTiles} tuiles de piste sur ${t.lengthTiles} dans ${t.name} ; il en reste au moins ${minLength - layout.lengthTiles} à poser avant de fermer ` +
                    "(la fermeture sera refusée en dessous). Ajoute des éléments qui s'enroulent dans l'emprise (hélices, virages en pente, passages sous le lift), pas des droites. Pour la fin du circuit, coaster_search_section cherche une seconde moitié compacte dans bounds ; la poser à la main donne des circuits étalés.",
            );
        return { view, warnings, blocking };
    }
    if (layout.lengthTiles < minLength)
        blocking.push(`circuit trop court : ${layout.lengthTiles} tuiles de piste contre ${t.lengthTiles} dans ${t.name} (minimum ${minLength}, ${pct(LENGTH_MIN)} %)`);
    if (layout.blocks.maxTrains < t.maxTrains) blocking.push(`${layout.blocks.maxTrains} train(s) permis contre ${t.maxTrains} dans ${t.name} : ajoute des block_brakes`);
    // Compacité : sans ces seuils, un circuit long mais étalé (densité 0,15 contre 0,52, 2 tuiles empilées contre 52) fermait.
    if (space.footprint.area > t.footprintArea * FOOTPRINT_MAX)
        blocking.push(`emprise ${space.footprint.area} tuiles contre ${t.footprintArea} dans ${t.name} (${(space.footprint.area / t.footprintArea).toFixed(2)} ×, maximum ${FOOTPRINT_MAX} ×) : refais le circuit dans suggestedBounds`);
    if (layout.density < t.density * DENSITY_MIN)
        blocking.push(`densité ${layout.density} contre ${t.density} dans ${t.name} (minimum ${(t.density * DENSITY_MIN).toFixed(2)})`);
    if (space.stackedTiles < t.stackedTiles * STACKED_MIN)
        blocking.push(`${space.stackedTiles} tuiles empilées contre ${t.stackedTiles} dans ${t.name} (minimum ${Math.ceil(t.stackedTiles * STACKED_MIN)}) : la piste doit passer au-dessus et au-dessous d'elle-même`);
    if (t.liftShared > 0 && lift < t.liftShared * LIFT_SHARED_MIN)
        blocking.push(`dessous du lift : ${lift} tuile(s) contre ${t.liftShared} dans ${t.name} (minimum ${Math.ceil(t.liftShared * LIFT_SHARED_MIN)}) : la seconde moitié doit passer sous le lift (coaster_search_section)`);
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
        out.push(`densité ${ride.density} tuile de piste par tuile d'emprise contre ${ref.density} : à emprise égale, la référence pose ${Math.round((ref.density / Math.max(ride.density, 0.01) - 1) * 100)} % de piste en plus`);
    if (ride.stackedTiles < ref.stackedTiles * 0.6) out.push(`tuiles empilées ${ride.stackedTiles} contre ${ref.stackedTiles} : la piste doit passer au-dessus et au-dessous d'elle-même`);
    if (ref.liftShared > 0 && ride.liftShared < ref.liftShared / 2) out.push(`dessous du lift : ${ride.liftShared} tuile(s) contre ${ref.liftShared} : fais passer la seconde moitié sous le lift`);
    return out;
}
