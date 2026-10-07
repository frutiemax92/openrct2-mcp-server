// Briques réutilisées par plusieurs outils : pose de chemins planifiés, recherche de raccord, résumés d'échecs.

import {
    DIRECTION_DELTA,
    LIMITS,
    directionBetween,
    reverseDirection,
    tileKey,
    type BulkResult,
    type Direction,
    type ObjectInfo,
    type ObjectsListResult,
    type RegionTile,
    type TileOutcome,
    type TileXY,
} from "@openrct2-claude/protocol";
import { edgeLevel, onTerrain, type PlannedPathTile } from "../planners/path.js";
import type { ToolContext } from "./context.js";

/** Regroupe les échecs par code (SPEC 9.5 : « échecs groupés par cause »). */
export function groupFailures(results: TileOutcome[], max = 8): { code: string; count: number; message: string; hint?: string; tiles: TileXY[] }[] {
    const groups = new Map<string, { code: string; count: number; message: string; hint?: string; tiles: TileXY[] }>();
    for (const r of results) {
        if (r.ok) continue;
        const code = r.error?.code ?? "UNKNOWN";
        const g = groups.get(code) ?? { code, count: 0, message: r.error?.message ?? "", hint: r.error?.hint, tiles: [] };
        g.count++;
        if (g.tiles.length < max) g.tiles.push({ x: r.x, y: r.y });
        groups.set(code, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
}

export function mergeBulk(parts: BulkResult[]): BulkResult {
    return {
        dryRun: parts[0]?.dryRun ?? false,
        results: parts.flatMap((p) => p.results),
        placed: parts.reduce((n, p) => n + p.placed, 0),
        failed: parts.reduce((n, p) => n + p.failed, 0),
        totalCost: parts.reduce((n, p) => n + p.totalCost, 0),
    };
}

export function chunks<T>(items: T[], size = LIMITS.maxOpsPerRequest): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

export interface PlacePathOptions {
    object?: string;
    railings?: string;
    queue?: boolean;
    dryRun: boolean;
}

/** Pose des tuiles de chemin planifiées, par lots. */
export async function placePathTiles(ctx: ToolContext, tiles: PlannedPathTile[], opts: PlacePathOptions): Promise<BulkResult> {
    const parts: BulkResult[] = [];
    for (const c of chunks(tiles)) {
        parts.push(
            await ctx.bridge.call("path.place_tiles", {
                tiles: c.map((t) => ({ x: t.x, y: t.y, level: t.level, slopeDirection: t.slopeDirection })),
                object: opts.object,
                railings: opts.railings,
                queue: opts.queue,
                dryRun: opts.dryRun,
            }),
        );
    }
    const merged = parts.length ? mergeBulk(parts) : { dryRun: opts.dryRun, results: [], placed: 0, failed: 0, totalCost: 0 };
    if (!opts.dryRun) ctx.cache.invalidateTiles(tiles);
    return merged;
}

/** Une tuile accepte-t-elle un nouveau chemin posé sur le terrain ? */
export function pathPassable(t: RegionTile | undefined, sandbox: boolean): boolean {
    if (!t) return false;
    if (!(t.o & 1) && !(t.o & 2) && !sandbox) return false;
    if (t.w > t.h) return false;
    if (t.r?.length || t.e?.length || t.lg) return false;
    return onTerrain(t) !== null;
}

/**
 * Plus court chemin (BFS 4-connexe) d'une tuile de départ vers le réseau existant, en respectant la continuité
 * des niveaux. Renvoie les tuiles à poser (départ inclus, tuile de chemin existante exclue) ou null.
 */
export function routeToNetwork(
    start: TileXY,
    get: (x: number, y: number) => RegionTile | undefined,
    opts: { sandbox: boolean; maxDistance?: number; avoid?: Set<string>; startEntry?: Direction; startLevel?: number },
): PlannedPathTile[] | null {
    const maxDistance = opts.maxDistance ?? 40;
    const startTile = get(start.x, start.y);
    if (startTile?.p?.length) return [];
    if (!pathPassable(startTile, opts.sandbox) || opts.avoid?.has(tileKey(start))) return null;
    const placement = (t: TileXY): PlannedPathTile | null => {
        const rt = get(t.x, t.y);
        const p = rt ? onTerrain(rt) : null;
        return p ? { x: t.x, y: t.y, ...p } : null;
    };
    const first = placement(start);
    if (!first) return null;
    if (opts.startLevel !== undefined && first.level !== opts.startLevel) return null;
    const prev = new Map<string, string | null>([[tileKey(start), null]]);
    const info = new Map<string, PlannedPathTile>([[tileKey(start), first]]);
    const queue: { t: TileXY; d: number }[] = [{ t: start, d: 0 }];
    while (queue.length) {
        const { t, d } = queue.shift()!;
        const cur = info.get(tileKey(t))!;
        if (d >= maxDistance) continue;
        for (let dir = 0; dir < 4; dir++) {
            const n = { x: t.x + DIRECTION_DELTA[dir].x, y: t.y + DIRECTION_DELTA[dir].y };
            const k = tileKey(n);
            if (prev.has(k) || opts.avoid?.has(k)) continue;
            const nt = get(n.x, n.y);
            if (!nt) continue;
            const side = dir as Direction;
            const curEdge = edgeLevel(cur, side);
            if (curEdge === null) continue;
            // Chemin existant : raccord si un de ses éléments est au bon niveau.
            const existing = nt.p?.find((p) => {
                const pe = edgeLevel({ level: p.l, slopeDirection: p.sd >= 0 ? (p.sd as Direction) : null }, reverseDirection(side));
                return pe === curEdge && !p.q;
            });
            if (existing) {
                const out: PlannedPathTile[] = [];
                let key: string | null = tileKey(t);
                while (key) {
                    out.unshift(info.get(key)!);
                    key = prev.get(key) ?? null;
                }
                return out;
            }
            if (!pathPassable(nt, opts.sandbox)) continue;
            // Le jeu relie automatiquement un chemin posé aux files voisines : passer le long de la file d'une
            // autre attraction fusionnerait les deux (constaté en jeu, SPIKES S2).
            if (touchesQueue(n, t, get)) continue;
            const np = placement(n)!;
            if (edgeLevel(np, reverseDirection(side)) !== curEdge) continue;
            prev.set(k, tileKey(t));
            info.set(k, np);
            queue.push({ t: n, d: d + 1 });
        }
    }
    return null;
}

/** Une tuile voisine de `t` (autre que celle d'où l'on vient) porte-t-elle une file d'attente ? */
function touchesQueue(t: TileXY, from: TileXY, get: (x: number, y: number) => RegionTile | undefined): boolean {
    for (let dir = 0; dir < 4; dir++) {
        const x = t.x + DIRECTION_DELTA[dir].x;
        const y = t.y + DIRECTION_DELTA[dir].y;
        if (x === from.x && y === from.y) continue;
        if (get(x, y)?.p?.some((p) => p.q)) return true;
    }
    return false;
}

/** Vérifie l'ordre d'une route (tuiles adjacentes). */
export function isContiguous(route: TileXY[]): boolean {
    for (let i = 1; i < route.length; i++) if (directionBetween(route[i - 1], route[i]) === null) return false;
    return true;
}

/** Tous les objets chargés d'un type (pagination du plugin incluse). */
export async function loadedObjects(ctx: ToolContext, type: string): Promise<ObjectInfo[]> {
    const out: ObjectInfo[] = [];
    let cursor: number | null = 0;
    while (cursor !== null && out.length < 2000) {
        const r: ObjectsListResult = await ctx.bridge.call("objects.list", { type, loadedOnly: true, limit: 200, cursor });
        out.push(...r.items);
        cursor = r.nextCursor;
    }
    return out;
}
