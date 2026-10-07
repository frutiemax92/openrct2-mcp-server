// Conventions de coordonnées (SPEC 6.5, F22). Toute l'API publique utilise des tuiles et des
// « niveaux » (marches de terrain visibles). Les unités monde restent internes.

/** 1 tuile = 32 unités monde. */
export const TILE_SIZE = 32;
/** z = baseHeight × 8. */
export const Z_STEP = 8;
/** 1 marche de terrain = 16 unités monde = 2 baseHeight. */
export const LEVEL_Z = 16;
export const LEVEL_BASE_HEIGHT = LEVEL_Z / Z_STEP;
/** Bornes du terrain et de l'eau, en baseHeight. */
export const MIN_LAND_BASE_HEIGHT = 2;
export const MAX_LAND_BASE_HEIGHT = 254;
export const MIN_LEVEL = MIN_LAND_BASE_HEIGHT / LEVEL_BASE_HEIGHT;
export const MAX_LEVEL = MAX_LAND_BASE_HEIGHT / LEVEL_BASE_HEIGHT;

export type Direction = 0 | 1 | 2 | 3;

export interface TileXY {
    x: number;
    y: number;
}

/** Rectangle de tuiles, bornes incluses. */
export interface TileRect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export const tileToWorld = (t: number): number => t * TILE_SIZE;
export const tileCenterToWorld = (t: number): number => t * TILE_SIZE + TILE_SIZE / 2;
export const worldToTile = (w: number): number => Math.floor(w / TILE_SIZE);
export const levelToZ = (level: number): number => level * LEVEL_Z;
export const zToLevel = (z: number): number => z / LEVEL_Z;
export const levelToBaseHeight = (level: number): number => level * LEVEL_BASE_HEIGHT;
export const baseHeightToLevel = (baseHeight: number): number => baseHeight / LEVEL_BASE_HEIGHT;

/** Direction 0-3 en repère carte : 0 = −X, 1 = +Y, 2 = +X, 3 = −Y (Map.cpp, CoordsDirectionDelta). */
export const DIRECTION_DELTA: readonly TileXY[] = [
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
];

export const DIRECTION_LABEL = ["-x", "+y", "+x", "-y"] as const;

export const reverseDirection = (d: Direction): Direction => ((d + 2) & 3) as Direction;

export function stepTile(t: TileXY, d: Direction, n = 1): TileXY {
    const delta = DIRECTION_DELTA[d];
    return { x: t.x + delta.x * n, y: t.y + delta.y * n };
}

/** Direction d'une tuile vers une tuile voisine (4-connexité), ou null. */
export function directionBetween(from: TileXY, to: TileXY): Direction | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    for (let d = 0; d < 4; d++) {
        if (DIRECTION_DELTA[d].x === dx && DIRECTION_DELTA[d].y === dy) return d as Direction;
    }
    return null;
}

/** Rotation d'un décalage, identique à CoordsXY::rotate (world/Location.hpp). */
export function rotateOffset<T extends { x: number; y: number }>(p: T, direction: number): { x: number; y: number } {
    switch (direction & 3) {
        case 1:
            return { x: p.y, y: -p.x };
        case 2:
            return { x: -p.x, y: -p.y };
        case 3:
            return { x: -p.y, y: p.x };
        default:
            return { x: p.x, y: p.y };
    }
}

/** Pente de surface : bits des coins relevés (Slope.h). */
export const SLOPE = {
    FLAT: 0,
    N: 1,
    E: 2,
    S: 4,
    W: 8,
    DIAGONAL: 16,
} as const;

export function normalizeRect(r: TileRect): TileRect {
    return {
        x1: Math.min(r.x1, r.x2),
        y1: Math.min(r.y1, r.y2),
        x2: Math.max(r.x1, r.x2),
        y2: Math.max(r.y1, r.y2),
    };
}

export const rectWidth = (r: TileRect): number => Math.abs(r.x2 - r.x1) + 1;
export const rectHeight = (r: TileRect): number => Math.abs(r.y2 - r.y1) + 1;
export const rectArea = (r: TileRect): number => rectWidth(r) * rectHeight(r);

export function rectContains(r: TileRect, t: TileXY): boolean {
    return t.x >= r.x1 && t.x <= r.x2 && t.y >= r.y1 && t.y <= r.y2;
}

/** Rectangle de tuiles → MapRange en unités monde (bornes incluses : début de la dernière tuile). */
export function rectToWorldRange(r: TileRect): { x1: number; y1: number; x2: number; y2: number } {
    const n = normalizeRect(r);
    return { x1: tileToWorld(n.x1), y1: tileToWorld(n.y1), x2: tileToWorld(n.x2), y2: tileToWorld(n.y2) };
}

export const tileKey = (t: TileXY): string => `${t.x},${t.y}`;
