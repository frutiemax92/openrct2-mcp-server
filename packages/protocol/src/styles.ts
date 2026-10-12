// Style Picker et Magic Fill Tool (SPEC 13.7) : format d'une région annotée (« style ») et des demandes de
// remplissage, partagé par le plugin (qui les produit) et le serveur (qui les range sur disque et les relit).
//
// Toutes les hauteurs d'un style sont en unités `baseHeight` (z = baseHeight × 8), la granularité réelle du jeu :
// avec le cheat Zero Clearances, un décorateur empile des objets à 8 unités près, ce que les « niveaux » des autres
// outils (16 unités) perdraient. `dz` est la hauteur relative à la base de la surface de la tuile.

import type { TileXY } from "./coords.js";

export const STYLE_FORMAT_VERSION = 1;
/** Plafond de tuiles d'une région annotée ou remplie (taille des données et de la capture). */
export const STYLE_MAX_TILES = 2500;
/** Styles en attente dans le plugin quand aucun serveur MCP n'est connecté. */
export const STYLE_MAX_PENDING = 8;
/** Clé `sharedStorage` des styles en attente (persistés dans plugin.store.json jusqu'à leur réception). */
export const STYLE_PENDING_STORAGE_KEY = "claude-bridge.pendingStyles";
/** Bouton « Clear all styles » cliqué sans serveur connecté : la base sera vidée à la connexion suivante. */
export const STYLE_CLEAR_STORAGE_KEY = "claude-bridge.clearStyles";

/** Couleurs d'un élément recolorable : principale, secondaire, tertiaire (index de la palette du jeu, 0-31). */
export type StyleColours = [number, number, number];

export interface StyleSurface {
    dx: number;
    dy: number;
    baseHeight: number;
    slope: number;
    /** Identifiants des objets terrain_surface et terrain_edge. */
    surface: string | null;
    edge: string | null;
    /** Hauteur de l'eau en baseHeight (0 = pas d'eau). */
    water: number;
    grassLength: number;
    ownership: number;
    parkFences: number;
}

export type StyleElementType = "footpath" | "track" | "small_scenery" | "wall" | "entrance" | "large_scenery" | "banner";

export interface StyleElement {
    t: StyleElementType;
    dx: number;
    dy: number;
    baseHeight: number;
    clearanceHeight: number;
    /** baseHeight − baseHeight de la surface de la tuile. */
    dz: number;
    occupiedQuadrants: number;
    /** Identifiant de l'objet (scénerie, mur, bannière, surface du chemin, ride). */
    object?: string | null;
    direction?: number;
    quadrant?: number;
    colours?: StyleColours;
    age?: number;
    /** Grande scénerie : index de la tuile de l'objet, et origine (tuile 0) relative au coin du style. */
    sequence?: number;
    origin?: { dx: number; dy: number; baseHeight: number };
    /** Mur : pente déduite du terrain par le jeu. */
    slope?: number;
    bannerText?: string | null;
    isNoEntry?: boolean;
    // Chemins
    railings?: string | null;
    legacyPath?: boolean;
    isQueue?: boolean;
    edges?: number;
    corners?: number;
    slopeDirection?: number | null;
    addition?: string | null;
    isWide?: boolean;
    // Pistes et entrées
    ride?: number;
    rideType?: number;
    trackType?: number;
    colourScheme?: number | null;
    hasChainLift?: boolean;
    isInverted?: boolean;
    brakeBoosterSpeed?: number | null;
    seatRotation?: number | null;
    station?: number | null;
    /** Entrée : ride_entrance, ride_exit ou park_entrance. */
    kind?: string;
}

export interface StyleObjectInfo {
    type: string;
    name: string;
    /** Drapeaux bruts de l'objet (SmallSceneryObject.flags, F33) quand l'API les expose. */
    flags?: number;
    height?: number;
    /** Grande scénerie : décalages des tuiles par rapport à la tuile 0 (unités monde, non tournés). */
    tiles?: { x: number; y: number; z: number }[];
}

export interface StyleRide {
    id: number;
    name: string;
    type: number;
    classification: string;
    object: string | null;
    /** Couleurs de piste par schéma (main, additional, supports) et de véhicules (body, trim, tertiary). */
    colourSchemes: { main: number; additional: number; supports: number }[];
    vehicleColours: { body: number; trim: number; tertiary: number }[];
    stationStyle: number | null;
}

export interface StyleScreenshot {
    rotation: number;
    zoom: number;
    /** Nom du fichier dans le dossier screenshot du jeu (déplacé par le serveur dans le dossier du style). */
    file: string;
    width: number;
    height: number;
    /** Centre de la vue en unités monde, et hauteur du terrain au centre (pour reprojeter les tuiles). */
    centerX: number;
    centerY: number;
    centerZ: number;
}

export interface StyleRecord {
    format: number;
    id: string;
    caption: string;
    createdAt: string;
    /** « user » : Style Picker en jeu ; « claude » : outil style_save. */
    source: "user" | "claude";
    park: { name: string; mapSize: TileXY } | null;
    /** Coin (x, y minimaux) de la région ; toutes les positions du style sont relatives à ce coin. */
    origin: TileXY;
    size: TileXY;
    tiles: [number, number][];
    surfaces: StyleSurface[];
    elements: StyleElement[];
    objects: Record<string, StyleObjectInfo>;
    rides: StyleRide[];
    screenshots: StyleScreenshot[];
    /** Raison si les captures ont échoué (jeu sans fenêtre, dossier screenshot absent…). */
    screenshotError?: string;
    /** Éléments fantômes (aperçus de construction) ignorés. */
    ghostsSkipped?: number;
    /**
     * Nature choisie par l'utilisateur (Style Picker, style_update) ; absente : déduite du relevé par le serveur.
     * structure : bloc rigide, posé entier à une seule hauteur sur un sol nivelé ; natural : patchs coupables.
     */
    kind?: StyleKindChoice;
}

export type StyleKindChoice = "structure" | "natural";

export interface MagicFillRequest {
    id: string;
    prompt: string;
    tiles: [number, number][];
    brushSize: number;
    createdAt: string;
    park: { name: string; mapSize: TileXY } | null;
}

export type MagicFillStatus = "pending" | "received" | "working" | "done" | "failed" | "dismissed";

// ---------------------------------------------------------------------------
// Méthodes du protocole
// ---------------------------------------------------------------------------

export interface StylesCaptureParams {
    tiles: TileXY[];
    caption: string;
    /** Faux : pas de capture d'écran (extraction seule). Défaut : vrai. */
    screenshot?: boolean;
    /** Rotations capturées (défaut : 0 à 3). */
    rotations?: number[];
    source?: "user" | "claude";
}

export interface StylesExtractParams {
    tiles: TileXY[];
}

export interface InboxTakeResult {
    /** Au plus un style par appel (un style peut peser quelques Mo). */
    styles: StyleRecord[];
    fills: MagicFillRequest[];
    remaining: { styles: number; fills: number };
    /** Vrai : l'utilisateur a cliqué « Clear all styles ». Le serveur vide la base AVANT de ranger `styles` (sauvés après le clic). */
    clearStyles?: boolean;
}

export interface InboxAckParams {
    styles: string[];
    fills: string[];
    /** Présent quand la base a été vidée (`clearStyles`) : nombre de styles supprimés sur disque. */
    clearedStyles?: number;
}

export interface InboxEvent {
    styles: number;
    fills: number;
    clearStyles?: boolean;
}

export interface MaskedCaptureParams {
    /** Préfixe du nom de fichier ([a-zA-Z0-9_-]) ; le plugin ajoute -r<rotation>.png. */
    name: string;
    tiles: TileXY[];
    rotations?: number[];
}

export interface MaskedCaptureResult {
    screenshots: StyleScreenshot[];
    hidden: number;
}

export interface MagicFillStatusParams {
    id: string;
    status: MagicFillStatus;
    message?: string;
}

/** Boîte d'avertissement du jeu (ui.showError), par exemple limite d'objets du parc atteinte pendant un Magic Fill. */
export interface UiAlertParams {
    title: string;
    message: string;
}

// ---------------------------------------------------------------------------
// Géométrie partagée
// ---------------------------------------------------------------------------

/** Rotation d'un quart de tour d'un objet posé : direction, quadrant et bord de mur tournent ensemble (F28). */
export function rotateQuarter(value: number, k: number): number {
    return (value + k) & 3;
}

/**
 * Hauteur du terrain au centre d'une tuile (TileElementHeight au point 16,16), en unités monde, à partir de la base
 * de la surface (baseHeight) et de sa pente (bits N=1, E=2, S=4, W=8, 16 = diagonale ; F22, F30).
 */
export function surfaceCenterZ(baseHeight: number, slope: number): number {
    const base = baseHeight * 8;
    const corners = slope & 0xf;
    const raised = (corners & 1 ? 1 : 0) + (corners & 2 ? 1 : 0) + (corners & 4 ? 1 : 0) + (corners & 8 ? 1 : 0);
    if (slope & 16) return base + 16;
    if (raised === 3) return base + 16;
    if (raised === 2) return base + 8;
    return base;
}

/** Nom de fichier sûr dérivé d'un texte libre (légende) : minuscules, chiffres et tirets. */
export function slugify(text: string, max = 32): string {
    const s = text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return s.slice(0, max).replace(/-+$/g, "") || "style";
}
