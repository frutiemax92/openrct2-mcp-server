// Inventaire typé des méthodes plugin (SPEC 7.3). Coordonnées en tuiles, hauteurs en niveaux
// (1 niveau = 1 marche de terrain = 16 unités monde), sauf `batch.execute` qui transmet des
// arguments bruts de game actions (unités monde).

import type { Direction, TileRect, TileXY } from "./coords.js";
import type { BridgeError } from "./errors.js";

/** Référence d'objet : identifiant (« rct2.burgb ») ou index d'objet chargé. */
export type ObjectRef = string | number;

export interface Capabilities {
    captureImage: boolean;
    directEdit: boolean;
    consoleLegacy: boolean;
    saveLoad: boolean;
    trackSegments: boolean;
    pathNavigator: boolean;
}

export interface HelloParams {
    token: string;
    clientVersion: string;
}

export interface HelloResult {
    pluginVersion: string;
    protocolVersion: number;
    apiVersion: number;
    networkMode: string;
    gameMode: string;
    headless: boolean;
    mapSize: TileXY;
    capabilities: Capabilities;
}

export interface GameDateInfo {
    day: number;
    month: number;
    year: number;
    ticksElapsed: number;
    monthsElapsed: number;
}

export interface SessionInfo {
    pluginVersion: string;
    apiVersion: number;
    networkMode: string;
    gameMode: string;
    paused: boolean;
    gameSpeed: number;
    mapSize: TileXY;
    park: {
        name: string;
        cash: number;
        rating: number;
        guests: number;
        date: GameDateInfo;
    } | null;
    cheats: Record<string, boolean | number>;
    queue: { pending: number };
}

export interface CheatSetItem {
    /** Nom de `CheatType` (ex. "sandboxMode") ou valeur numérique. */
    cheat: string | number;
    param1?: number;
    param2?: number;
}

export interface CheatSetParams {
    items: CheatSetItem[];
}

export interface ActionOutcome {
    ok: boolean;
    cost?: number;
    error?: BridgeError;
}

export interface ParkOverview {
    name: string;
    cash: number;
    bankLoan: number;
    maxBankLoan: number;
    rating: number;
    guests: number;
    suggestedGuestMaximum: number;
    entranceFee: number;
    value: number;
    companyValue: number;
    parkSize: number;
    date: GameDateInfo;
    isOpen: boolean;
    rides: { total: number; open: number; broken: number; brokenIds: number[] };
    topThoughts: { type: string; count: number }[];
    happiness: number | null;
}

export interface ParkSetParams {
    name?: string;
    entranceFee?: number;
    loan?: number;
    open?: boolean;
    dryRun?: boolean;
}

export interface ParkEntranceParams {
    x: number;
    y: number;
    level: number;
    direction: Direction;
    entranceObject?: ObjectRef;
    pathObject?: ObjectRef;
    dryRun?: boolean;
}

export interface PeepSpawnParams {
    x: number;
    y: number;
    level: number;
    direction: Direction;
    dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Carte
// ---------------------------------------------------------------------------

export interface RegionPath {
    /** Niveau de la base du chemin. */
    l: number;
    /** 1 si file d'attente. */
    q: 0 | 1;
    /** Masque des bords connectés (bits 0-3 = directions 0-3). */
    e: number;
    /** Direction de montée si en pente, sinon -1. */
    sd: number;
    /** Attraction associée (files d'attente) ou -1. */
    r: number;
    /** Addition (banc, lampe…) : index d'objet ou -1. */
    a: number;
}

export interface RegionEntrance {
    /** 0 entrée d'attraction, 1 sortie, 2 entrée du parc. */
    k: 0 | 1 | 2;
    d: Direction;
    r: number;
    st: number;
    l: number;
    seq: number;
}

export interface RegionTile {
    /** Niveau du terrain (baseHeight / 2). */
    h: number;
    /** Pente de surface (bits N=1, E=2, S=4, W=8, 16 diagonale). */
    s: number;
    /** Niveau de l'eau, 0 si aucune. */
    w: number;
    /** Index de l'objet de surface (terrain_surface). */
    t: number;
    /** Bit 1 = possédé, bit 2 = droits de construction. */
    o: number;
    p?: RegionPath[];
    /** Attractions ayant une pièce sur la tuile. */
    r?: number[];
    /** Hauteur max (niveau) des pièces d'attraction sur la tuile. */
    rh?: number;
    /** Intervalles [base, dégagement] (niveaux) occupés par chaque pièce d'attraction sur la tuile (passerelles : trouver un créneau libre entre deux pièces à des hauteurs différentes). */
    ri?: [number, number][];
    e?: RegionEntrance[];
    /** Nombre d'éléments de petite scénerie, grande scénerie, murs. */
    sc?: number;
    lg?: number;
    wl?: number;
    /** Hauteur max (niveau) de la scénerie. */
    sh?: number;
}

export interface RegionParams extends TileRect {}

export interface RegionResult {
    rect: TileRect;
    /** Ligne par ligne (y externe, x interne). */
    tiles: RegionTile[];
}

export interface TileElementInfo {
    index: number;
    type: string;
    level: number;
    clearanceLevel: number;
    baseHeight: number;
    isGhost: boolean;
    [key: string]: unknown;
}

export interface TileInfo {
    x: number;
    y: number;
    elements: TileElementInfo[];
}

export type OwnershipMode = "buy_land" | "buy_rights" | "set_owned" | "set_rights" | "set_unowned" | "own_all";

export interface OwnershipParams extends Partial<TileRect> {
    mode: OwnershipMode;
    dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export interface TerrainHeightItem {
    x: number;
    y: number;
    level: number;
    slope?: number;
}

export interface TerrainSetHeightsParams {
    tiles: TerrainHeightItem[];
    dryRun?: boolean;
}

export interface TerrainSetSurfaceParams extends TileRect {
    surfaceObject?: ObjectRef | null;
    edgeObject?: ObjectRef | null;
    dryRun?: boolean;
}

export interface TerrainSetWaterParams extends TileRect {
    /** Niveau d'eau ; 0 pour retirer l'eau. */
    level: number;
    dryRun?: boolean;
}

export interface TileOutcome extends ActionOutcome {
    x: number;
    y: number;
    /** Niveau effectif (position renvoyée par le jeu), si connu. */
    level?: number;
}

export interface BulkResult {
    dryRun: boolean;
    results: TileOutcome[];
    placed: number;
    failed: number;
    totalCost: number;
}

// ---------------------------------------------------------------------------
// Chemins
// ---------------------------------------------------------------------------

export interface PathTile {
    x: number;
    y: number;
    level: number;
    /** Direction de montée (0-3) si la tuile est une rampe, sinon absent/null. */
    slopeDirection?: Direction | null;
}

export interface PathPlaceParams {
    tiles: PathTile[];
    object?: ObjectRef;
    railings?: ObjectRef;
    queue?: boolean;
    dryRun?: boolean;
}

export interface PathRemoveParams {
    tiles: { x: number; y: number; level?: number }[];
    dryRun?: boolean;
}

export interface PathAdditionParams {
    tiles: { x: number; y: number; level?: number }[];
    object: ObjectRef;
    dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Attractions
// ---------------------------------------------------------------------------

export interface RideStationInfo {
    index: number;
    start: { x: number; y: number; level: number } | null;
    length: number;
    entrance: { x: number; y: number; level: number; direction: number } | null;
    exit: { x: number; y: number; level: number; direction: number } | null;
}

export interface RideSummary {
    id: number;
    name: string;
    type: number;
    classification: string;
    status: string;
    object: string | null;
    excitement: number | null;
    intensity: number | null;
    nausea: number | null;
    price: number[];
    stations: RideStationInfo[];
}

export interface RideDetail extends RideSummary {
    mode: number;
    totalCustomers: number;
    age: number;
    runningCost: number;
    totalProfit: number;
    value: number;
    downtime: number;
    reliability: number;
    breakdown: string | null;
    satisfaction: number;
    queueTime: number[];
    stats: {
        maxSpeed: number;
        averageSpeed: number;
        rideTime: number;
        rideLength: number;
        maxPositiveVerticalGs: number;
        maxNegativeVerticalGs: number;
        maxLateralGs: number;
        totalAirTime: number;
        numDrops: number;
        numLiftHills: number;
        highestDropHeight: number;
    };
    inspectionInterval: number;
    minimumWaitingTime: number;
    maximumWaitingTime: number;
    vehicles: number;
}

export interface RideCreateParams {
    object: ObjectRef;
    /** Type interne ; défaut : premier type déclaré par l'objet. */
    rideType?: number;
    stationObject?: ObjectRef;
    colour1?: number;
    colour2?: number;
    inspectionInterval?: number;
    dryRun?: boolean;
}

export interface RideCreateResult {
    rideId: number | null;
    rideType: number;
    cost: number;
    dryRun: boolean;
}

export interface TrackFootprintParams {
    trackType: number;
    x: number;
    y: number;
    direction: Direction;
}

export interface FootprintTile extends TileXY {
    /** Côtés (directions carte) où une entrée/sortie peut se raccorder, si connus. */
    sides?: number;
}

export interface TrackFootprintResult {
    tiles: FootprintTile[];
}

export interface TrackPlaceParams {
    ride: number;
    trackType: number;
    x: number;
    y: number;
    level: number;
    direction: Direction;
    rideType?: number;
    brakeSpeed?: number;
    colour?: number;
    seatRotation?: number;
    flags?: number;
    dryRun?: boolean;
}

export interface EntranceExitParams {
    ride: number;
    station?: number;
    x: number;
    y: number;
    /** Direction de la tuile d'entrée vers la station (convention de l'action). */
    direction: Direction;
    isExit: boolean;
    dryRun?: boolean;
}

export type RideStatusName = "closed" | "open" | "testing" | "simulating";

export interface RideSetStatusParams {
    ride: number;
    status: RideStatusName;
}

export interface RideSetPriceParams {
    ride: number;
    price: number;
    primary?: boolean;
}

export interface RideSetSettingParams {
    ride: number;
    setting: number | string;
    value: number;
}

export interface RideSetNameParams {
    ride: number;
    name: string;
}

export interface RideDemolishParams {
    ride: number;
    dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Scénerie
// ---------------------------------------------------------------------------

export interface SmallSceneryItem {
    object: ObjectRef;
    x: number;
    y: number;
    /** Niveau ; absent = hauteur automatique (surface ou eau). */
    level?: number | null;
    quadrant?: number;
    direction?: Direction;
    colours?: [number?, number?, number?];
}

export interface SceneryPlaceParams {
    items: SmallSceneryItem[];
    dryRun?: boolean;
}

export interface LargeSceneryItem {
    object: ObjectRef;
    x: number;
    y: number;
    level?: number | null;
    direction?: Direction;
    colours?: [number?, number?, number?];
}

export interface LargeSceneryPlaceParams {
    items: LargeSceneryItem[];
    dryRun?: boolean;
}

export interface WallItem {
    object: ObjectRef;
    x: number;
    y: number;
    level?: number | null;
    edge: Direction;
    colours?: [number?, number?, number?];
}

export interface WallPlaceParams {
    items: WallItem[];
    dryRun?: boolean;
}

export const CLEAR_ITEMS = {
    smallScenery: 1,
    largeScenery: 2,
    footpath: 4,
    walls: 8,
    footpathAdditions: 16,
} as const;

export interface SceneryClearParams extends TileRect {
    /** Masque CLEAR_ITEMS. Défaut : petite + grande scénerie + murs. */
    items?: number;
    dryRun?: boolean;
}

export interface SceneryRemoveSmallParams {
    items: { x: number; y: number; level: number; object: ObjectRef; quadrant: number }[];
    dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Objets
// ---------------------------------------------------------------------------

export interface ObjectInfo {
    identifier: string;
    name: string;
    type: string;
    loaded: boolean;
    index: number | null;
    legacyIdentifier?: string | null;
    sourceGames?: string[];
    /** Champs propres au type (rideType, taille, prix…). */
    extra?: Record<string, unknown>;
}

export interface ObjectsListParams {
    type?: string;
    query?: string;
    loadedOnly?: boolean;
    cursor?: number;
    limit?: number;
}

export interface ObjectsListResult {
    items: ObjectInfo[];
    total: number;
    nextCursor: number | null;
}

export interface ObjectsLoadParams {
    identifiers: string[];
}

export interface ObjectsLoadResult {
    results: { identifier: string; ok: boolean; index: number | null; type: string | null; error?: string }[];
}

// ---------------------------------------------------------------------------
// Captures, checkpoints, temps, lots
// ---------------------------------------------------------------------------

export interface CaptureParams {
    /** Centre en tuiles ; absent = capture géante de tout le parc. */
    center?: TileXY;
    zoom?: number;
    rotation?: number;
    width?: number;
    height?: number;
    /** Nom de fichier relatif au dossier de captures, sans extension. */
    name: string;
    transparent?: boolean;
}

export interface CaptureResult {
    filename: string;
    width: number | null;
    height: number | null;
}

export interface CheckpointParams {
    name: string;
}

export interface CheckpointRestoreParams {
    /** Nom dans le dossier save/ ou chemin absolu. */
    name: string;
}

export interface TimeStatus {
    paused: boolean;
    gameSpeed: number;
    date: GameDateInfo;
}

export interface TimeRunParams {
    ticks: number;
    speed?: number;
    /** Remettre la pause après (défaut : état initial). */
    pauseAfter?: boolean;
    /** Relève, à chaque frame, la vitesse et les G du premier train de cette attraction, par pièce de piste. */
    sample?: { ride: number };
}

/**
 * Mesures agrégées sur une pièce de piste pendant time.run { sample } (G en g). Les vitesses sont en velocity / 65536
 * (unités des consignes de frein) : × 2,25 pour des mph affichés (ToHumanReadableSpeed : velocity × 9 >> 18).
 */
export interface PieceSample {
    /** Origine de la pièce (unités monde), comme trackplace. */
    x: number;
    y: number;
    z: number;
    direction: number;
    trackType: number;
    /** Nombre de relevés (frames) où la tête du train était sur la pièce. */
    n: number;
    /** Vitesse au premier relevé sur la pièce (entrée approximative), minimale et maximale. */
    vFirst: number;
    vMin: number;
    vMax: number;
    /** G verticaux max/min et G latéraux max (valeur absolue), toutes voitures confondues. */
    gVertMax: number;
    gVertMin: number;
    gLatMax: number;
}

export interface BatchOp {
    action: string;
    args: Record<string, unknown>;
}

export interface BatchParams {
    ops: BatchOp[];
    dryRun?: boolean;
    stopOnError?: boolean;
}

export interface BatchOpResult extends ActionOutcome {
    index: number;
    /** Champs supplémentaires du résultat (ride, bannerIndex…). */
    data?: Record<string, unknown>;
}

export interface BatchResult {
    dryRun: boolean;
    results: BatchOpResult[];
    totalCost: number;
    firstFailureIndex: number | null;
}

export interface TrackSegmentInfo {
    type: number;
    description: string;
    elements: { x: number; y: number; z: number }[];
    beginZ: number;
    endZ: number;
    endX: number;
    endY: number;
    beginDirection: number;
    endDirection: number;
    beginSlope: number;
    endSlope: number;
    beginBank: number;
    endBank: number;
    length: number;
    trackGroup: number;
    /** Champs complets (track.segments uniquement). */
    turnDirection?: "straight" | "left" | "right";
    slopeDirection?: "flat" | "up" | "down";
    mirrorSegment?: number | null;
    alternateTypeSegment?: number | null;
    priceModifier?: number;
    flags?: {
        onlyAllowedUnderwater: boolean;
        onlyAllowedAboveGround: boolean;
        allowsChainLift: boolean;
        isBanked: boolean;
        isInversion: boolean;
        isSteepUp: boolean;
        startsHalfHeightUp: boolean;
        isBankedTurn: boolean;
        isSlopedTurn: boolean;
        isHelix: boolean;
        countsAsInversion: boolean;
    };
}

export interface TrackSegmentsParams {
    cursor?: number;
    limit?: number;
}

export interface TrackSegmentsResult {
    items: TrackSegmentInfo[];
    total: number;
    nextCursor: number | null;
}

/** Pièce posée, telle que `trackplace` la prend : origine en tuiles, z en unités monde (multiple de 8). */
export interface TrackPieceInfo {
    type: number;
    x: number;
    y: number;
    z: number;
    direction: Direction;
    /** Indice de station (pièces de station), sinon absent. */
    station?: number;
    chain?: boolean;
    /** Vitesse de frein ou de booster (mph), lue dans le jeu. */
    brakeSpeed?: number;
}

export interface TrackCircuitParams {
    ride: number;
    /** Tuile de départ si l'attraction n'a pas de station. */
    at?: TileXY;
}

export interface TrackCircuitResult {
    /** Pièces dans le sens de marche, depuis le début de la chaîne (ou la station si le circuit est fermé). */
    pieces: TrackPieceInfo[];
    closed: boolean;
    truncated: boolean;
}

/** Compteurs de proximité de RideRatings.cpp (ordre de l'énumération PROXIMITY_*). */
export const PROXIMITY_KEYS = [
    "waterOver",
    "waterTouch",
    "waterLow",
    "waterHigh",
    "surfaceTouch",
    "queuePathOver",
    "queuePathTouchAbove",
    "queuePathTouchUnder",
    "pathTouchAbove",
    "pathTouchUnder",
    "ownTrackTouchAbove",
    "ownTrackCloseAbove",
    "foreignTrackAboveOrBelow",
    "foreignTrackTouchAbove",
    "foreignTrackCloseAbove",
    "scenerySideBelow",
    "scenerySideAbove",
    "ownStationTouchAbove",
    "ownStationCloseAbove",
    "trackThroughVerticalLoop",
    "pathThroughVerticalLoop",
    "intersectingVerticalLoop",
    "throughVerticalLoop",
    "pathSideClose",
    "foreignTrackSideClose",
    "surfaceSideClose",
] as const;
export type ProximityKey = (typeof PROXIMITY_KEYS)[number];

export interface RatingScanParams {
    ride: number;
    /** Pièces dans le sens de marche : tuile, z monde du bloc de séquence 0, type. */
    pieces: { x: number; y: number; z: number; type: number }[];
    /** Points où tester l'abri (TrackGetIsSheltered), z monde du train. */
    shelter?: { x: number; y: number; z: number }[];
}

export interface RatingScanResult {
    /** Compteurs de proximité, comme ride_ratings_score_close_proximity (une fois par pièce). */
    proximity: Record<ProximityKey, number>;
    /** Pièces dont l'élément de séquence 0 n'a pas été trouvé (indices). */
    missing: number[];
    /** Résultat de TrackGetIsSheltered pour chaque point de `shelter` (ou sous terre). */
    sheltered: boolean[];
    /** ride_ratings_get_scenery_score : éléments de scénerie dans un carré 11×11 autour de la station. */
    scenery: { items: number; underground: boolean };
    carsPerTrain: number;
    trains: number;
    /** Ride.flags et departFlags bruts. */
    rideFlags: number;
    departFlags: number;
    /** Objet de véhicule : multiplicateurs (RideObject) et drapeaux (RideEntryFlag). */
    entry: { excitement: number; intensity: number; nausea: number; flags: number };
    /** La station n'a pas d'entrée : le jeu ne compte alors aucune proximité. */
    noEntrance: boolean;
}

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------

export type StaffTypeName = "handyman" | "mechanic" | "security" | "entertainer";

/** `StaffType` (entity/Staff.h). */
export const STAFF_TYPE_VALUE: Record<StaffTypeName, number> = { handyman: 0, mechanic: 1, security: 2, entertainer: 3 };

/** Bits d'ordres (enum STAFF_ORDERS, entity/Staff.h) : agents d'entretien, puis mécaniciens. */
export const STAFF_ORDERS = {
    handyman: { sweeping: 1, water_flowers: 2, empty_bins: 4, mowing: 8 },
    mechanic: { inspect_rides: 1, fix_rides: 2 },
} as const;

export interface StaffHireParams {
    type: StaffTypeName;
    /** Masque STAFF_ORDERS ; défaut : ordres par défaut du jeu pour ce type. */
    orders?: number;
    /** Zone de patrouille (tuiles) ; absente = tout le parc. */
    patrol?: TileRect;
    dryRun?: boolean;
}

export interface StaffHireResult extends ActionOutcome {
    id: number | null;
    patrolSet?: boolean;
}

export interface StaffInfo {
    id: number;
    type: StaffTypeName;
    name: string;
    orders: number;
    tile: TileXY | null;
    patrolTiles: number;
}

/** Table méthode → [params, résultat]. */
export interface MethodMap {
    "session.hello": [HelloParams, HelloResult];
    "session.info": [Record<string, never>, SessionInfo];
    "session.set_paused": [{ paused: boolean }, { paused: boolean }];
    "session.cheats.get": [Record<string, never>, Record<string, boolean | number>];
    "session.cheats.set": [CheatSetParams, { results: ActionOutcome[] }];
    "session.ping": [Record<string, never>, { pong: true; tick: number }];
    "park.overview": [Record<string, never>, ParkOverview];
    "park.set": [ParkSetParams, { results: Record<string, ActionOutcome> }];
    "park.entrance_place": [ParkEntranceParams, ActionOutcome];
    "park.spawn_place": [PeepSpawnParams, ActionOutcome];
    "map.size": [Record<string, never>, TileXY];
    "map.region": [RegionParams, RegionResult];
    "map.tile": [TileXY, TileInfo];
    "map.ownership.set": [OwnershipParams, ActionOutcome];
    "terrain.set_heights": [TerrainSetHeightsParams, BulkResult];
    "terrain.set_surface": [TerrainSetSurfaceParams, ActionOutcome];
    "terrain.set_water": [TerrainSetWaterParams, BulkResult];
    "path.place_tiles": [PathPlaceParams, BulkResult];
    "path.remove_tiles": [PathRemoveParams, BulkResult];
    "path.place_addition": [PathAdditionParams, BulkResult];
    "path.remove_addition": [PathRemoveParams, BulkResult];
    "ride.list": [Record<string, never>, { rides: RideSummary[] }];
    "ride.get": [{ id: number }, RideDetail];
    "ride.create": [RideCreateParams, RideCreateResult];
    "ride.place_track": [TrackPlaceParams, ActionOutcome & { footprint: FootprintTile[] }];
    "ride.place_entrance_exit": [EntranceExitParams, ActionOutcome];
    "ride.set_status": [RideSetStatusParams, ActionOutcome];
    "ride.set_price": [RideSetPriceParams, ActionOutcome];
    "ride.set_setting": [RideSetSettingParams, ActionOutcome];
    "ride.set_name": [RideSetNameParams, ActionOutcome];
    "ride.demolish": [RideDemolishParams, ActionOutcome];
    "track.footprint": [TrackFootprintParams, TrackFootprintResult];
    "track.segment": [{ type: number }, TrackSegmentInfo | null];
    "track.segments": [TrackSegmentsParams, TrackSegmentsResult];
    "track.circuit": [TrackCircuitParams, TrackCircuitResult];
    "track.rating_scan": [RatingScanParams, RatingScanResult];
    "scenery.place_small": [SceneryPlaceParams, BulkResult];
    "scenery.place_large": [LargeSceneryPlaceParams, BulkResult];
    "scenery.place_wall": [WallPlaceParams, BulkResult];
    "scenery.remove_small": [SceneryRemoveSmallParams, BulkResult];
    "scenery.clear_region": [SceneryClearParams, ActionOutcome];
    "objects.list": [ObjectsListParams, ObjectsListResult];
    "objects.load": [ObjectsLoadParams, ObjectsLoadResult];
    "objects.unload": [{ identifiers: string[] }, { ok: true }];
    "capture.view": [CaptureParams, CaptureResult];
    "checkpoint.save": [CheckpointParams, { filename: string }];
    "checkpoint.restore": [CheckpointRestoreParams, { requested: string }];
    "time.status": [Record<string, never>, TimeStatus];
    "time.run": [TimeRunParams, TimeStatus & { ticksRun: number; samples?: PieceSample[] }];
    "batch.execute": [BatchParams, BatchResult];
    "staff.hire": [StaffHireParams, StaffHireResult];
    "staff.fire": [{ id: number }, ActionOutcome];
    "staff.set_orders": [{ id: number; orders: number }, ActionOutcome];
    "staff.set_patrol": [{ id: number; rect: TileRect; mode: "set" | "unset" | "clear" }, ActionOutcome];
    "staff.list": [Record<string, never>, { staff: StaffInfo[] }];
}

export type MethodName = keyof MethodMap;
export type MethodParams<M extends MethodName> = MethodMap[M][0];
export type MethodResult<M extends MethodName> = MethodMap[M][1];

export const RIDE_STATUS_VALUE: Record<RideStatusName, number> = {
    closed: 0,
    open: 1,
    testing: 2,
    simulating: 3,
};

/** `RideSetSetting` (actions/ride/RideSetSettingAction.h). */
export const RIDE_SETTINGS = {
    mode: 0,
    departure: 1,
    minWaitingTime: 2,
    maxWaitingTime: 3,
    operation: 4,
    inspectionInterval: 5,
    music: 6,
    musicType: 7,
    liftHillSpeed: 8,
    numCircuits: 9,
    rideType: 10,
} as const;

/** Drapeaux de `footpathplace.constructFlags` (world/Footpath.h). */
export const PATH_CONSTRUCT_FLAGS = { isQueue: 1, isLegacyPathObject: 2 } as const;

/** Drapeaux de FootpathSurfaceObject.flags (object/FootpathEntry.h). */
export const FOOTPATH_SURFACE_FLAGS = { editorOnly: 4, isQueue: 8 } as const;

/** Bits de `Ride.flags` (enum RideFlag, ride/Ride.h). */
export const RIDE_FLAGS = {
    onTrack: 1 << 0,
    tested: 1 << 1,
    testInProgress: 1 << 2,
    brokenDown: 1 << 7,
    dueInspection: 1 << 8,
    crashed: 1 << 10,
    hasStalledVehicle: 1 << 11,
} as const;

/** Bits de SmallSceneryObject.flags (enum SmallSceneryFlag, object/SmallSceneryEntry.h ; FlagHolder : 1 << rang). */
export const SMALL_SCENERY_FLAGS = {
    occupiesFullTile: 1 << 0,
    requiresFlatSurface: 1 << 2,
    isRotatable: 1 << 3,
    isDiagonal: 1 << 8,
    isStackable: 1 << 17,
    occupiesHalfTile: 1 << 24,
    occupiesThreeQuarters: 1 << 25,
    isTree: 1 << 28,
} as const;
