// Capture « masquée » d'une région (Style Picker, Magic Fill ; SPEC 13.7).
//
// Le plugin ne peut pas filtrer le rendu, mais `TileElement.isHidden` (setInvisible) retire un élément du dessin
// (Paint.TileElement.cpp : `if (tile_element->isInvisible()) continue;`), surface comprise. Dans la même frame :
// on cache tous les éléments des tuiles voisines qui ne font pas partie de la région, on capture avec un fond
// transparent (`transparent: true`), puis on rétablit exactement les éléments qu'on a cachés. Rien n'est enregistré
// entre-temps : la frame n'avance pas pendant l'appel synchrone. Limites : les entités (visiteurs, véhicules) ne sont
// pas des éléments de tuile et restent visibles (le serveur les efface hors de l'emprise projetée de la région), et
// un élément plus haut que MARGIN marches posé devant la région, à plus de MARGIN tuiles, peut encore la masquer.

import { STYLE_MAX_TILES, surfaceCenterZ, type StyleScreenshot, type TileXY } from "@openrct2-claude/protocol";
import { fail, inMap, log } from "../util";
import { bboxOf, largeKey } from "./extract";

/** Tuiles autour de la région dont les éléments sont cachés. */
const MARGIN = 16;
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 1200;
const PADDING = 48;

function rotate(x: number, y: number, rotation: number): { x: number; y: number } {
    switch (rotation & 3) {
        case 1:
            return { x: y, y: -x };
        case 2:
            return { x: -x, y: -y };
        case 3:
            return { x: -y, y: x };
        default:
            return { x, y };
    }
}

/** Translate3DTo2DWithZ (Viewport.cpp), en unités d'écran au zoom 0. */
function project(x: number, y: number, z: number, rotation: number): { sx: number; sy: number } {
    const r = rotate(x, y, rotation);
    return { sx: r.y - r.x, sy: Math.floor((r.x + r.y) / 2) - z };
}

interface TileSpan {
    x: number;
    y: number;
    zLow: number;
    zHigh: number;
}

function spanOf(x: number, y: number): TileSpan {
    const els = map.getTile(x, y).elements;
    let zLow = Infinity;
    let zHigh = 0;
    for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.isGhost) continue;
        zLow = Math.min(zLow, el.baseZ);
        zHigh = Math.max(zHigh, el.clearanceZ);
        if (el.type === "surface") {
            const s = el as SurfaceElement;
            zHigh = Math.max(zHigh, el.baseZ + 32, s.waterHeight);
        }
    }
    return { x, y, zLow: isFinite(zLow) ? zLow : 0, zHigh };
}

function centerOf(tiles: TileXY[]): { x: number; y: number; z: number } {
    const b = bboxOf(tiles);
    const cx = Math.floor((b.x1 + b.x2) / 2);
    const cy = Math.floor((b.y1 + b.y2) / 2);
    let z = 0;
    const els = map.getTile(cx, cy).elements;
    for (let i = 0; i < els.length; i++) {
        if (els[i].type === "surface") {
            const s = els[i] as SurfaceElement;
            z = surfaceCenterZ(s.baseHeight, s.slope);
            break;
        }
    }
    return { x: cx * 32 + 16, y: cy * 32 + 16, z };
}

/** Taille d'image et zoom pour que la région (sol et plus haut élément) tienne, centrée sur `center`. */
function frame(spans: TileSpan[], center: { x: number; y: number; z: number }, rotation: number): { zoom: number; width: number; height: number } {
    const c = project(center.x, center.y, center.z, rotation);
    let halfW = 64;
    let up = 64;
    let down = 64;
    for (const t of spans) {
        for (const [ox, oy] of [
            [0, 0],
            [32, 0],
            [0, 32],
            [32, 32],
        ]) {
            const hi = project(t.x * 32 + ox, t.y * 32 + oy, t.zHigh, rotation);
            const lo = project(t.x * 32 + ox, t.y * 32 + oy, t.zLow, rotation);
            halfW = Math.max(halfW, Math.abs(hi.sx - c.sx));
            up = Math.max(up, c.sy - hi.sy);
            down = Math.max(down, lo.sy - c.sy);
        }
    }
    const w = 2 * halfW + PADDING;
    const h = 2 * Math.max(up, down) + PADDING;
    let zoom = 0;
    while (zoom < 3 && (w / 2 ** zoom > MAX_WIDTH || h / 2 ** zoom > MAX_HEIGHT)) zoom++;
    const k = 2 ** zoom;
    return { zoom, width: Math.max(64, Math.min(4096, Math.ceil(w / k))), height: Math.max(64, Math.min(4096, Math.ceil(h / k))) };
}

export interface MaskedCaptureOutcome {
    screenshots: StyleScreenshot[];
    hidden: number;
    error?: string;
}

/**
 * Capture la région seule sous les rotations demandées. Synchrone (une frame) : cacher, capturer, rétablir.
 * `name` est un nom de fichier sûr ; les images sont `<name>-r<rotation>.png` dans le dossier screenshot.
 */
export function maskedCapture(tiles: TileXY[], name: string, rotations: number[]): MaskedCaptureOutcome {
    if (typeof context.captureImage !== "function" || typeof ui === "undefined") {
        return { screenshots: [], hidden: 0, error: "captureImage indisponible (jeu sans fenêtre)" };
    }
    if (network.mode !== "none") return { screenshots: [], hidden: 0, error: "masquage impossible en multijoueur (isHidden est une modification directe)" };
    if (tiles.length > STYLE_MAX_TILES) fail("INVALID_PARAMS", `Région trop grande (${tiles.length} tuiles, maximum ${STYLE_MAX_TILES}).`);
    const inRegion: { [k: string]: true } = {};
    for (const t of tiles) inRegion[`${t.x},${t.y}`] = true;
    const spans = tiles.map((t) => spanOf(t.x, t.y));
    // Grandes scénerie de la région : leurs tuiles hors de la région restent visibles (l'objet entier fait partie du style).
    const keepLarge: { [k: string]: true } = {};
    for (const t of tiles) {
        const els = map.getTile(t.x, t.y).elements;
        for (let i = 0; i < els.length; i++) {
            if (els[i].type !== "large_scenery") continue;
            const k = largeKey(els[i] as LargeSceneryElement, t.x, t.y);
            if (k) keepLarge[k] = true;
        }
    }
    const b = bboxOf(tiles);
    // Positions (tuile, index) plutôt que les poignées : le .d.ts prévient qu'écrire isHidden peut invalider
    // les TileElement gardés par le script.
    const hidden: { x: number; y: number; idx: number[] }[] = [];
    let hiddenCount = 0;
    const center = centerOf(tiles);
    const shots: StyleScreenshot[] = [];
    let error: string | undefined;
    try {
        for (let y = b.y1 - MARGIN; y <= b.y2 + MARGIN; y++) {
            for (let x = b.x1 - MARGIN; x <= b.x2 + MARGIN; x++) {
                if (!inMap(x, y) || inRegion[`${x},${y}`]) continue;
                const els = map.getTile(x, y).elements;
                const idx: number[] = [];
                for (let i = 0; i < els.length; i++) {
                    const el = els[i];
                    if (el.isHidden) continue;
                    if (el.type === "large_scenery") {
                        const k = largeKey(el as LargeSceneryElement, x, y);
                        if (k && keepLarge[k]) continue;
                    }
                    idx.push(i);
                }
                if (idx.length === 0) continue;
                // Le tableau est relu avant chaque écriture (poignées fraîches).
                hidden.push({ x, y, idx });
                for (const i of idx) {
                    map.getTile(x, y).getElement(i).isHidden = true;
                    hiddenCount++;
                }
            }
        }
        for (const rotation of rotations) {
            const f = frame(spans, center, rotation);
            const file = `${name}-r${rotation}.png`;
            try {
                context.captureImage({ filename: file, width: f.width, height: f.height, position: { x: center.x, y: center.y }, zoom: f.zoom, rotation, transparent: true });
                shots.push({ rotation, zoom: f.zoom, file, width: f.width, height: f.height, centerX: center.x, centerY: center.y, centerZ: center.z });
            } catch (e) {
                error = `captureImage a échoué : ${e}`;
            }
        }
    } finally {
        for (const h of hidden) {
            for (const i of h.idx) {
                try {
                    map.getTile(h.x, h.y).getElement(i).isHidden = false;
                } catch (e) {
                    log(`isHidden non rétabli en (${h.x},${h.y})#${i} : ${e}`);
                }
            }
        }
    }
    return { screenshots: shots, hidden: hiddenCount, error };
}
