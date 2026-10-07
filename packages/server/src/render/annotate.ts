// Annotation des captures du jeu (SPEC 10.3) et planche-contact multi-angles (SPEC 10.4).
// Limite connue : la grille suit le terrain, pas les structures ; un élément haut masque les tuiles derrière lui.

import { PNG } from "pngjs";
import type { RegionTile } from "@openrct2-claude/protocol";
import { cornerLevels } from "../planners/heightmap.js";
import { Canvas, type RGB } from "./pngmap.js";
import { vertexToPixel, visibleRadius, worldToPixel, type CaptureView } from "./projection.js";

/** Coins (S, E, N, W) → décalage du sommet dans la tuile. */
const CORNER_OFFSETS: readonly [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
];

export interface AnnotateOptions {
    /** Une étiquette « x,y » toutes les `labelStep` tuiles (défaut selon le zoom). */
    labelStep?: number;
    /** Tuile mise en évidence (contour jaune). */
    highlight?: { x: number; y: number }[];
}

export function defaultLabelStep(zoom: number): number {
    return zoom <= 0 ? 2 : zoom === 1 ? 4 : zoom === 2 ? 8 : 16;
}

/** Superpose la grille des tuiles et leurs coordonnées sur une capture. */
export function annotateCapture(buf: Buffer, view: CaptureView, center: { x: number; y: number }, get: (x: number, y: number) => RegionTile | undefined, opts: AnnotateOptions = {}): Buffer {
    const png = PNG.sync.read(buf);
    const cv = Canvas.fromPng(png);
    const radius = Math.min(96, visibleRadius(view));
    const step = opts.labelStep ?? defaultLabelStep(view.zoom);
    const grid: RGB = [255, 255, 255];
    const alpha = view.zoom >= 2 ? 70 : 110;
    const inView = (p: { px: number; py: number }) => p.px > -64 && p.py > -64 && p.px < view.width + 64 && p.py < view.height + 64;
    const labels: { px: number; py: number; s: string }[] = [];
    for (let y = center.y - radius; y <= center.y + radius; y++) {
        for (let x = center.x - radius; x <= center.x + radius; x++) {
            const t = get(x, y);
            if (!t) continue;
            const c = cornerLevels(t);
            const pts = CORNER_OFFSETS.map(([dx, dy], i) => vertexToPixel(view, x + dx, y + dy, c[i]));
            if (!pts.some(inView)) continue;
            // Bords −y (S→E) et −x (W→S) : chaque bord est dessiné une fois par la tuile qui le possède ; les bords +x et +y
            // en bordure de zone sont dessinés par la tuile voisine.
            cv.line(pts[0].px, pts[0].py, pts[1].px, pts[1].py, grid, alpha);
            cv.line(pts[3].px, pts[3].py, pts[0].px, pts[0].py, grid, alpha);
            if (!get(x + 1, y)) cv.line(pts[1].px, pts[1].py, pts[2].px, pts[2].py, grid, alpha);
            if (!get(x, y + 1)) cv.line(pts[2].px, pts[2].py, pts[3].px, pts[3].py, grid, alpha);
            if (x % step === 0 && y % step === 0) {
                const mid = worldToPixel(view, x * 32 + 16, y * 32 + 16, ((c[0] + c[1] + c[2] + c[3]) / 4) * 16);
                labels.push({ px: mid.px, py: mid.py, s: `${x},${y}` });
            }
        }
    }
    for (const h of opts.highlight ?? []) {
        const t = get(h.x, h.y);
        if (!t) continue;
        const c = cornerLevels(t);
        const pts = CORNER_OFFSETS.map(([dx, dy], i) => vertexToPixel(view, h.x + dx, h.y + dy, c[i]));
        for (let i = 0; i < 4; i++) {
            const a = pts[i];
            const b = pts[(i + 1) & 3];
            for (const o of [-1, 0, 1]) cv.line(a.px, a.py + o, b.px, b.py + o, [255, 230, 0]);
        }
    }
    const scale = view.width >= 1600 ? 2 : 1;
    for (const l of labels) cv.label(l.px - (l.s.length * 4 * scale) / 2, l.py - 3 * scale, l.s, scale);
    return PNG.sync.write(cv.png, { colorType: 2 });
}

/** Assemble jusqu'à 4 images en grille 2×2 (ou 1×n), avec le numéro de rotation de chaque vue. */
export function contactSheet(images: { png: Buffer; label: string }[], maxSide = 1568): Buffer {
    const decoded = images.map((i) => ({ img: PNG.sync.read(i.png), label: i.label }));
    const cols = decoded.length <= 2 ? decoded.length : 2;
    const rows = Math.ceil(decoded.length / cols);
    const cw = Math.max(...decoded.map((d) => d.img.width));
    const ch = Math.max(...decoded.map((d) => d.img.height));
    const gap = 4;
    const W = cols * cw + (cols - 1) * gap;
    const H = rows * ch + (rows - 1) * gap;
    const k = Math.max(1, Math.ceil(Math.max(W, H) / maxSide));
    const out = new Canvas(Math.floor(W / k), Math.floor(H / k));
    out.rect(0, 0, out.w, out.h, [20, 20, 20]);
    decoded.forEach((d, n) => {
        const ox = (n % cols) * (cw + gap);
        const oy = Math.floor(n / cols) * (ch + gap);
        // Réduction par boîte k×k directement dans la planche.
        for (let y = 0; y + k <= d.img.height; y += k)
            for (let x = 0; x + k <= d.img.width; x += k) {
                let r = 0,
                    g = 0,
                    b = 0;
                for (let dy = 0; dy < k; dy++)
                    for (let dx = 0; dx < k; dx++) {
                        const i = ((y + dy) * d.img.width + (x + dx)) * 4;
                        r += d.img.data[i];
                        g += d.img.data[i + 1];
                        b += d.img.data[i + 2];
                    }
                const n2 = k * k;
                out.px(Math.floor((ox + x) / k), Math.floor((oy + y) / k), [r / n2, g / n2, b / n2]);
            }
        out.label(Math.floor(ox / k) + 4, Math.floor(oy / k) + 4, d.label, 3);
    });
    return PNG.sync.write(out.png, { colorType: 2 });
}
