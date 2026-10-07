// Couche sémantique de zones (SPEC 11.2) : type de zone par tuile, peint par Claude, lu par le générateur de
// scénerie. Stockée à la tuile (plus précis qu'une grille 4×4, et la mémoire reste faible), sauvegardée avec les
// checkpoints.

import { normalizeRect, type TileRect, type TileXY } from "@openrct2-claude/protocol";
import type { ZoneTile } from "../planners/scatter.js";

export const ZONE_TYPES = [
    "forest_dense",
    "forest_edge",
    "meadow",
    "flower_bed",
    "lakeshore",
    "plaza",
    "queue_screening",
    "path_border",
    "under_coaster",
] as const;

export type ZoneType = (typeof ZONE_TYPES)[number];

/** Lettre de chaque type pour la carte texte de zones_get. */
export const ZONE_LETTERS: Record<ZoneType, string> = {
    forest_dense: "F",
    forest_edge: "f",
    meadow: "m",
    flower_bed: "*",
    lakeshore: "l",
    plaza: "p",
    queue_screening: "q",
    path_border: "b",
    under_coaster: "u",
};

/** Point dans un polygone (règle pair-impair), en coordonnées continues. */
export function pointInPolygon(px: number, py: number, poly: TileXY[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

export class ZoneMap {
    private tiles = new Map<string, ZoneType>();

    get size(): number {
        return this.tiles.size;
    }

    /** Peint un rectangle ou un polygone (sommets en tuiles ; une tuile est dedans si son centre l'est). null efface. */
    paint(shape: { rect?: TileRect; polygon?: TileXY[] }, type: ZoneType | null): number {
        let n = 0;
        const apply = (x: number, y: number) => {
            const k = `${x},${y}`;
            if (type === null) {
                if (this.tiles.delete(k)) n++;
            } else {
                this.tiles.set(k, type);
                n++;
            }
        };
        if (shape.rect) {
            const r = normalizeRect(shape.rect);
            for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) apply(x, y);
        } else if (shape.polygon && shape.polygon.length >= 3) {
            // Polygone en coordonnées de sommets de tuiles : (x, y) = coin −x −y de la tuile (x, y).
            const xs = shape.polygon.map((p) => p.x);
            const ys = shape.polygon.map((p) => p.y);
            for (let y = Math.min(...ys); y <= Math.max(...ys); y++)
                for (let x = Math.min(...xs); x <= Math.max(...xs); x++) if (pointInPolygon(x + 0.5, y + 0.5, shape.polygon)) apply(x, y);
        }
        return n;
    }

    get(x: number, y: number): ZoneType | undefined {
        return this.tiles.get(`${x},${y}`);
    }

    /** Tuiles peintes, filtrées par rectangle et/ou type. */
    list(rect?: TileRect, type?: ZoneType): ZoneTile[] {
        const out: ZoneTile[] = [];
        const r = rect ? normalizeRect(rect) : null;
        for (const [k, zone] of this.tiles) {
            if (type && zone !== type) continue;
            const [x, y] = k.split(",").map(Number);
            if (r && (x < r.x1 || x > r.x2 || y < r.y1 || y > r.y2)) continue;
            out.push({ x, y, zone });
        }
        return out.sort((a, b) => a.y - b.y || a.x - b.x);
    }

    /** Résumé par type : nombre de tuiles et rectangle englobant. */
    summary(): { type: ZoneType; tiles: number; bbox: TileRect }[] {
        const by = new Map<ZoneType, { tiles: number; bbox: TileRect }>();
        for (const [k, zone] of this.tiles) {
            const [x, y] = k.split(",").map(Number);
            const s = by.get(zone);
            if (!s) by.set(zone, { tiles: 1, bbox: { x1: x, y1: y, x2: x, y2: y } });
            else {
                s.tiles++;
                s.bbox = { x1: Math.min(s.bbox.x1, x), y1: Math.min(s.bbox.y1, y), x2: Math.max(s.bbox.x2, x), y2: Math.max(s.bbox.y2, y) };
            }
        }
        return [...by.entries()].map(([type, s]) => ({ type, ...s })).sort((a, b) => b.tiles - a.tiles);
    }

    clear(): void {
        this.tiles.clear();
    }

    toJSON(): [string, ZoneType][] {
        return [...this.tiles.entries()];
    }

    load(entries: [string, ZoneType][] | undefined): void {
        this.tiles = new Map((entries ?? []).filter(([, t]) => (ZONE_TYPES as readonly string[]).includes(t)));
    }
}
