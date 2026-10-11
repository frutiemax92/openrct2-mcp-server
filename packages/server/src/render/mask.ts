// Masque d'une capture à l'emprise projetée d'une région (Style Picker, Magic Fill ; SPEC 13.7).
//
// Le plugin cache déjà les éléments de tuile hors de la région (isHidden), mais pas les entités (visiteurs, véhicules)
// ni un élément très haut posé loin devant. Ici, chaque tuile de la région devient une colonne : l'enveloppe convexe
// des 4 coins de la tuile au plus bas (sol, eau) et au plus haut (élément le plus haut). Tout pixel hors de l'union des
// colonnes devient transparent.

import { PNG } from "pngjs";
import { worldToPixel, type CaptureView } from "./projection.js";

export interface MaskColumn {
    x: number;
    y: number;
    /** Hauteurs en unités monde. */
    zLow: number;
    zHigh: number;
}

type Pt = { px: number; py: number };

function hull(points: Pt[]): Pt[] {
    const p = points.slice().sort((a, b) => a.px - b.px || a.py - b.py);
    const cross = (o: Pt, a: Pt, b: Pt) => (a.px - o.px) * (b.py - o.py) - (a.py - o.py) * (b.px - o.px);
    const lower: Pt[] = [];
    for (const q of p) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
        lower.push(q);
    }
    const upper: Pt[] = [];
    for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
        upper.push(q);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Remplit un polygone convexe dans un masque binaire (balayage par lignes). */
function fillConvex(mask: Uint8Array, w: number, h: number, poly: Pt[]): void {
    if (poly.length < 3) return;
    const ys = poly.map((p) => p.py);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
        const yc = y + 0.5;
        let xMin = Infinity;
        let xMax = -Infinity;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            if ((a.py <= yc && b.py >= yc) || (b.py <= yc && a.py >= yc)) {
                const x = a.py === b.py ? Math.min(a.px, b.px) : a.px + ((yc - a.py) * (b.px - a.px)) / (b.py - a.py);
                const x2 = a.py === b.py ? Math.max(a.px, b.px) : x;
                xMin = Math.min(xMin, x, x2);
                xMax = Math.max(xMax, x, x2);
            }
        }
        if (!isFinite(xMin)) continue;
        const from = Math.max(0, Math.floor(xMin) - 1);
        const to = Math.min(w - 1, Math.ceil(xMax) + 1);
        for (let x = from; x <= to; x++) mask[y * w + x] = 1;
    }
}

/** Masque binaire (1 = dans l'emprise de la région) d'une vue de capture. */
export function regionMask(view: CaptureView, columns: MaskColumn[]): Uint8Array {
    const mask = new Uint8Array(view.width * view.height);
    for (const c of columns) {
        const pts: Pt[] = [];
        for (const [ox, oy] of [
            [0, 0],
            [32, 0],
            [0, 32],
            [32, 32],
        ]) {
            pts.push(worldToPixel(view, c.x * 32 + ox, c.y * 32 + oy, c.zLow));
            // Marge d'un demi-niveau au-dessus : les feuillages dépassent un peu de leur dégagement.
            pts.push(worldToPixel(view, c.x * 32 + ox, c.y * 32 + oy, c.zHigh + 8));
        }
        fillConvex(mask, view.width, view.height, hull(pts));
    }
    return mask;
}

/** Rend transparent tout pixel hors de l'emprise de la région. Renvoie l'image d'origine si elle est illisible. */
export function maskCapture(png: Buffer, view: CaptureView, columns: MaskColumn[]): { png: Buffer; kept: number } {
    const img = PNG.sync.read(png);
    const v = { ...view, width: img.width, height: img.height };
    const mask = regionMask(v, columns);
    let kept = 0;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) {
            if (img.data[i * 4 + 3] > 0) kept++;
            continue;
        }
        img.data[i * 4] = 0;
        img.data[i * 4 + 1] = 0;
        img.data[i * 4 + 2] = 0;
        img.data[i * 4 + 3] = 0;
    }
    return { png: PNG.sync.write(img), kept };
}
