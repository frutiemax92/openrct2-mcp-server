// Carte schématique PNG (SPEC 10.2) : vue de dessus exacte, grille étiquetée, ombrage par hauteur.

import { PNG } from "pngjs";
import type { RegionTile, RideSummary, TileRect } from "@openrct2-claude/protocol";

export type RGB = [number, number, number];

const COLORS = {
    grass: [96, 160, 72] as RGB,
    unowned: [70, 90, 60] as RGB,
    water: [64, 112, 200] as RGB,
    path: [190, 190, 180] as RGB,
    queue: [200, 160, 110] as RGB,
    small: [34, 100, 40] as RGB,
    large: [80, 90, 40] as RGB,
    wall: [120, 100, 80] as RGB,
    parkEntrance: [250, 220, 60] as RGB,
    rideEntrance: [255, 255, 255] as RGB,
    rideExit: [20, 20, 20] as RGB,
    grid: [0, 0, 0] as RGB,
    label: [255, 255, 255] as RGB,
    margin: [30, 30, 30] as RGB,
    diff: [255, 40, 40] as RGB,
};

// Police 3×5 pour les chiffres des étiquettes de grille.
const DIGITS: Record<string, string[]> = {
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
    "#": ["101", "111", "101", "111", "101"],
    ",": ["000", "000", "000", "010", "100"],
    "-": ["000", "000", "111", "000", "000"],
    R: ["110", "101", "110", "101", "101"],
};

function rideColor(id: number): RGB {
    const h = (id * 137.508) % 360;
    const s = 0.65;
    const l = 0.55;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export class Canvas {
    png: PNG;
    constructor(
        public w: number,
        public h: number,
        png?: PNG,
    ) {
        this.png = png ?? new PNG({ width: w, height: h });
    }

    static fromPng(png: PNG): Canvas {
        return new Canvas(png.width, png.height, png);
    }

    /** Segment (Bresenham), avec transparence. */
    line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255): void {
        x0 = Math.round(x0);
        y0 = Math.round(y0);
        x1 = Math.round(x1);
        y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0);
        const dy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (let guard = 0; guard < 10000; guard++) {
            this.px(x0, y0, c, a);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) {
                err += dy;
                x0 += sx;
            }
            if (e2 <= dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    /** Étiquette lisible : texte clair sur fond sombre. */
    label(x: number, y: number, s: string, scale = 1): void {
        const w = s.length * 4 * scale + scale;
        this.rect(Math.round(x), Math.round(y), w, 7 * scale, [0, 0, 0], 170);
        this.text(Math.round(x) + scale, Math.round(y) + scale, s, [255, 255, 255], scale);
    }
    px(x: number, y: number, c: RGB, a = 255): void {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = (y * this.w + x) * 4;
        const d = this.png.data;
        if (a === 255) {
            d[i] = c[0];
            d[i + 1] = c[1];
            d[i + 2] = c[2];
        } else {
            d[i] = (d[i] * (255 - a) + c[0] * a) / 255;
            d[i + 1] = (d[i + 1] * (255 - a) + c[1] * a) / 255;
            d[i + 2] = (d[i + 2] * (255 - a) + c[2] * a) / 255;
        }
        d[i + 3] = 255;
    }
    rect(x: number, y: number, w: number, h: number, c: RGB, a = 255): void {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c, a);
    }
    text(x: number, y: number, s: string, c: RGB, scale = 1): void {
        let cx = x;
        for (const ch of s) {
            const g = DIGITS[ch];
            if (g) {
                for (let gy = 0; gy < 5; gy++)
                    for (let gx = 0; gx < 3; gx++) if (g[gy][gx] === "1") this.rect(cx + gx * scale, y + gy * scale, scale, scale, c);
            }
            cx += 4 * scale;
        }
    }
}

function shade(c: RGB, factor: number): RGB {
    return [Math.min(255, c[0] * factor), Math.min(255, c[1] * factor), Math.min(255, c[2] * factor)].map(Math.round) as RGB;
}

export type MarkColor = "red" | "orange" | "magenta" | "cyan" | "blue";

export const MARK_COLORS: Record<MarkColor, RGB> = {
    red: [255, 40, 40],
    orange: [255, 150, 0],
    magenta: [255, 0, 255],
    cyan: [0, 230, 255],
    blue: [60, 110, 255],
};

export interface PngMapOptions {
    tilePx?: number;
    maxSide?: number;
    changed?: Set<string>;
    /** Tuiles signalées (analyse, audit) : contour épais de la couleur donnée. */
    marks?: { x: number; y: number; color: MarkColor }[];
    /** Rectangles signalés (zones vides…) : contour pointillé. */
    rects?: { rect: TileRect; color: MarkColor }[];
}

export function renderPngMap(rect: TileRect, get: (x: number, y: number) => RegionTile | undefined, rides: RideSummary[], opts: PngMapOptions = {}): Buffer {
    const tw = rect.x2 - rect.x1 + 1;
    const th = rect.y2 - rect.y1 + 1;
    const maxSide = opts.maxSide ?? 1568;
    const margin = 16;
    const tilePx = Math.max(3, Math.min(opts.tilePx ?? 16, Math.floor((maxSide - margin) / Math.max(tw, th))));
    const cv = new Canvas(margin + tw * tilePx, margin + th * tilePx);
    cv.rect(0, 0, cv.w, cv.h, COLORS.margin);

    let minH = Infinity;
    let maxH = -Infinity;
    for (let y = rect.y1; y <= rect.y2; y++)
        for (let x = rect.x1; x <= rect.x2; x++) {
            const t = get(x, y);
            if (t) {
                minH = Math.min(minH, t.h);
                maxH = Math.max(maxH, t.h);
            }
        }
    const span = Math.max(1, maxH - minH);
    const rideIds = new Set(rides.map((r) => r.id));

    for (let y = rect.y1; y <= rect.y2; y++) {
        for (let x = rect.x1; x <= rect.x2; x++) {
            const t = get(x, y);
            const px = margin + (x - rect.x1) * tilePx;
            const py = margin + (y - rect.y1) * tilePx;
            if (!t) continue;
            const heightFactor = 0.75 + 0.5 * ((t.h - minH) / span);
            let base = t.o & 1 ? COLORS.grass : COLORS.unowned;
            if (t.w > t.h) base = COLORS.water;
            cv.rect(px, py, tilePx, tilePx, shade(base, t.w > t.h ? 1 : heightFactor));
            if (t.s && t.w <= t.h) {
                // marqueur de pente : demi-tuile éclaircie
                cv.rect(px, py, tilePx, Math.max(1, tilePx >> 2), shade(base, heightFactor * 1.25), 160);
            }
            if (!(t.o & 1) && t.w <= t.h) {
                for (let i = 0; i < tilePx; i += 3) cv.px(px + i, py + i, [40, 40, 40]);
            }
            if (t.r?.length) {
                const id = t.r[0];
                cv.rect(px, py, tilePx, tilePx, rideIds.has(id) ? rideColor(id) : [200, 60, 200]);
            }
            if (t.p?.length) {
                const p = t.p[0];
                const c = p.q ? COLORS.queue : COLORS.path;
                const inset = Math.max(1, Math.floor(tilePx / 4));
                cv.rect(px + inset, py + inset, tilePx - 2 * inset, tilePx - 2 * inset, c);
                // bras vers les bords connectés
                const mid = Math.floor(tilePx / 2);
                const half = Math.max(1, Math.floor((tilePx - 2 * inset) / 2));
                if (p.e & 1) cv.rect(px, py + mid - half, inset, 2 * half, c); // −x
                if (p.e & 2) cv.rect(px + mid - half, py + tilePx - inset, 2 * half, inset, c); // +y
                if (p.e & 4) cv.rect(px + tilePx - inset, py + mid - half, inset, 2 * half, c); // +x
                if (p.e & 8) cv.rect(px + mid - half, py, 2 * half, inset, c); // −y
            }
            if (t.lg) cv.rect(px + 1, py + 1, tilePx - 2, tilePx - 2, COLORS.large, 200);
            else if (t.sc) {
                const s = Math.max(2, Math.floor(tilePx / 2));
                cv.rect(px + ((tilePx - s) >> 1), py + ((tilePx - s) >> 1), s, s, COLORS.small);
            }
            if (t.wl) cv.rect(px, py, tilePx, 1, COLORS.wall);
            for (const e of t.e ?? []) {
                const c = e.k === 2 ? COLORS.parkEntrance : e.k === 0 ? COLORS.rideEntrance : COLORS.rideExit;
                const s = Math.max(2, Math.floor(tilePx * 0.6));
                cv.rect(px + ((tilePx - s) >> 1), py + ((tilePx - s) >> 1), s, s, c);
            }
            if (opts.changed?.has(`${x},${y}`)) {
                cv.rect(px, py, tilePx, 1, COLORS.diff);
                cv.rect(px, py + tilePx - 1, tilePx, 1, COLORS.diff);
                cv.rect(px, py, 1, tilePx, COLORS.diff);
                cv.rect(px + tilePx - 1, py, 1, tilePx, COLORS.diff);
            }
        }
    }

    const outline = (px: number, py: number, w: number, h: number, c: RGB, t: number, dashed = false) => {
        for (let k = 0; k < t; k++) {
            for (let i = 0; i < w; i++) {
                if (dashed && (i >> 2) % 2) continue;
                cv.px(px + i, py + k, c);
                cv.px(px + i, py + h - 1 - k, c);
            }
            for (let i = 0; i < h; i++) {
                if (dashed && (i >> 2) % 2) continue;
                cv.px(px + k, py + i, c);
                cv.px(px + w - 1 - k, py + i, c);
            }
        }
    };
    for (const r of opts.rects ?? []) {
        const x1 = Math.max(r.rect.x1, rect.x1);
        const y1 = Math.max(r.rect.y1, rect.y1);
        const x2 = Math.min(r.rect.x2, rect.x2);
        const y2 = Math.min(r.rect.y2, rect.y2);
        if (x1 > x2 || y1 > y2) continue;
        outline(margin + (x1 - rect.x1) * tilePx, margin + (y1 - rect.y1) * tilePx, (x2 - x1 + 1) * tilePx, (y2 - y1 + 1) * tilePx, MARK_COLORS[r.color], 2, true);
    }
    for (const m of opts.marks ?? []) {
        if (m.x < rect.x1 || m.y < rect.y1 || m.x > rect.x2 || m.y > rect.y2) continue;
        outline(margin + (m.x - rect.x1) * tilePx, margin + (m.y - rect.y1) * tilePx, tilePx, tilePx, MARK_COLORS[m.color], Math.max(1, tilePx >> 3));
    }

    // Grille tous les 8 (ou 16 si dense) et étiquettes.
    const step = tilePx >= 8 ? 8 : 16;
    for (let x = rect.x1; x <= rect.x2 + 1; x++) {
        if (x % step !== 0) continue;
        const px = margin + (x - rect.x1) * tilePx;
        for (let yy = margin; yy < cv.h; yy++) cv.px(px, yy, COLORS.grid, 110);
        if (x <= rect.x2) cv.text(px + 1, 2, String(x), COLORS.label);
    }
    for (let y = rect.y1; y <= rect.y2 + 1; y++) {
        if (y % step !== 0) continue;
        const py = margin + (y - rect.y1) * tilePx;
        for (let xx = margin; xx < cv.w; xx++) cv.px(xx, py, COLORS.grid, 110);
        if (y <= rect.y2) cv.text(1, py + 2, String(y).slice(-3), COLORS.label);
    }
    return PNG.sync.write(cv.png, { colorType: 2 });
}

/** Réduit une image PNG pour que son côté long soit ≤ maxSide (filtre boîte). */
export function downscalePng(buf: Buffer, maxSide: number): { data: Buffer; width: number; height: number } {
    const src = PNG.sync.read(buf);
    const longSide = Math.max(src.width, src.height);
    if (longSide <= maxSide) return { data: buf, width: src.width, height: src.height };
    const k = Math.ceil(longSide / maxSide);
    const w = Math.floor(src.width / k);
    const h = Math.floor(src.height / k);
    const dst = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0,
                g = 0,
                b = 0,
                a = 0;
            for (let dy = 0; dy < k; dy++)
                for (let dx = 0; dx < k; dx++) {
                    const i = ((y * k + dy) * src.width + (x * k + dx)) * 4;
                    r += src.data[i];
                    g += src.data[i + 1];
                    b += src.data[i + 2];
                    a += src.data[i + 3];
                }
            const n = k * k;
            const o = (y * w + x) * 4;
            dst.data[o] = r / n;
            dst.data[o + 1] = g / n;
            dst.data[o + 2] = b / n;
            dst.data[o + 3] = a / n;
        }
    }
    return { data: PNG.sync.write(dst), width: w, height: h };
}
