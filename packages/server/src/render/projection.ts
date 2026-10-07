// Projection isométrique d'OpenRCT2 (SPEC 10.3), reprise du code du jeu :
//  - Translate3DTo2DWithZ (interface/Viewport.cpp) : r = pos.rotate(rotation) ; sx = r.y − r.x ; sy = (r.x + r.y) / 2 − z ;
//  - CaptureImage (interface/Screenshot.cpp) : la vue est centrée sur la projection de (position, TileElementHeight),
//    et couvre width × 2^zoom unités d'écran ;
//  - CoordsXY::rotate (world/Location.hpp) : rotation 1 → (y, −x), 2 → (−x, −y), 3 → (−y, x).
// Vérifié en jeu à rotation 0, zoom 0 (F28) ; les rotations 1 à 3 et les autres zooms découlent du même code.

import { LEVEL_Z, TILE_SIZE, rotateOffset } from "@openrct2-claude/protocol";

export interface CaptureView {
    /** Centre de la capture en unités monde (centre de tuile) et hauteur du terrain en ce point. */
    centerX: number;
    centerY: number;
    centerZ: number;
    zoom: number;
    rotation: number;
    width: number;
    height: number;
}

/** Point monde → écran (unités d'écran au zoom 0, sans translation). */
export function worldToScreen(x: number, y: number, z: number, rotation: number): { sx: number; sy: number } {
    const r = rotateOffset({ x, y }, rotation);
    return { sx: r.y - r.x, sy: Math.floor((r.x + r.y) / 2) - z };
}

/** Point monde → pixel de l'image capturée. */
export function worldToPixel(view: CaptureView, x: number, y: number, z: number): { px: number; py: number } {
    const c = worldToScreen(view.centerX, view.centerY, view.centerZ, view.rotation);
    const p = worldToScreen(x, y, z, view.rotation);
    const k = 2 ** view.zoom;
    return { px: (p.sx - c.sx) / k + view.width / 2, py: (p.sy - c.sy) / k + view.height / 2 };
}

/**
 * Hauteur du terrain au centre d'une tuile (TileElementHeight au point (16, 16)) en unités monde, à partir des
 * coins (S, E, N, W) en niveaux : un coin relevé ne change pas le centre, deux coins le montent d'une demi-marche,
 * trois coins ou une diagonale d'une marche.
 */
export function tileCenterZ(corners: readonly number[]): number {
    const min = Math.min(...corners);
    const raised = corners.filter((c) => c > min).length;
    const max = Math.max(...corners);
    const half = LEVEL_Z / 2;
    if (max - min === 2) return (min + 1) * LEVEL_Z;
    return min * LEVEL_Z + (raised === 3 ? LEVEL_Z : raised === 2 ? half : 0);
}

/** Pixel d'un sommet de tuile (coin −x −y de la tuile (vx, vy)) au niveau donné. */
export function vertexToPixel(view: CaptureView, vx: number, vy: number, level: number): { px: number; py: number } {
    return worldToPixel(view, vx * TILE_SIZE, vy * TILE_SIZE, level * LEVEL_Z);
}

/** Rayon (en tuiles) de la zone visible autour du centre, avec marge. */
export function visibleRadius(view: CaptureView): number {
    const k = 2 ** view.zoom;
    // Une tuile occupe 64 unités d'écran en largeur et 32 en hauteur.
    return Math.ceil(((view.width * k) / 64 + (view.height * k) / 32) / 2) + 2;
}
