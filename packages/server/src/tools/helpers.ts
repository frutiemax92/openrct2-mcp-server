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
import { edgeLevel, elevatedPlacement, onTerrain, type PlannedPathTile } from "../planners/path.js";
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

/** Une tuile accepte-t-elle un nouveau chemin posé sur le terrain (ou, si `level` est fourni, une passerelle à ce niveau fixe) ? */
export function pathPassable(t: RegionTile | undefined, sandbox: boolean, level?: number): boolean {
    if (!t) return false;
    if (!(t.o & 1) && !(t.o & 2) && !sandbox) return false;
    if (level !== undefined) return elevatedPlacement(t, level) !== null;
    if (t.w > t.h) return false;
    if (t.r?.length || t.e?.length || t.lg) return false;
    return onTerrain(t) !== null;
}

/**
 * Plus court chemin (BFS 4-connexe) d'une tuile de départ vers le réseau existant, en respectant la continuité
 * des niveaux. Renvoie les tuiles à poser (départ inclus, tuile de chemin existante exclue) ou null.
 *
 * Si `startLevel` ne correspond pas au niveau que suivrait un chemin posé sur le terrain (entrée/sortie surélevée,
 * sur une station en hauteur par exemple), la recherche bascule en mode passerelle : la tuile de départ est posée
 * à plat, sur supports, au niveau `startLevel`, et la recherche peut ensuite monter ou descendre d'un niveau par
 * tuile (rampe indépendante du terrain, comme un escalier sur supports) pour redescendre jusqu'au réseau existant.
 */
export function routeToNetwork(
    start: TileXY,
    get: (x: number, y: number) => RegionTile | undefined,
    opts: { sandbox: boolean; maxDistance?: number; avoid?: Set<string>; startEntry?: Direction; startLevel?: number },
): PlannedPathTile[] | null {
    const maxDistance = opts.maxDistance ?? 40;
    const startTile = get(start.x, start.y);
    if (startTile?.p?.length) return [];
    if (opts.avoid?.has(tileKey(start))) return null;
    const groundFirst = startTile ? onTerrain(startTile) : null;
    const elevated = opts.startLevel !== undefined && (!groundFirst || groundFirst.level !== opts.startLevel);
    const bridgeLevel = elevated ? opts.startLevel : undefined;
    if (!pathPassable(startTile, opts.sandbox, bridgeLevel)) return null;
    const first: PlannedPathTile | null =
        bridgeLevel !== undefined
            ? { x: start.x, y: start.y, ...elevatedPlacement(startTile!, bridgeLevel)! }
            : startTile
              ? (() => {
                    const p = onTerrain(startTile);
                    return p ? { x: start.x, y: start.y, ...p } : null;
                })()
              : null;
    if (!first) return null;
    // Chaque nœud de recherche porte sa propre chaîne (parent). En mode terrain, le terrain fixe niveau et pente :
    // un seul passage par tuile, comme un BFS classique. En mode passerelle, une même tuile admet plusieurs poses
    // (plat, rampe montante ou descendante, sous ou au-dessus d'une pièce de piste) : l'état inclut niveau et pente,
    // et quelques chaînes distinctes peuvent atteindre le même état, car une route ne doit jamais repasser sur une
    // de ses propres tuiles (demi-tour en rampe, spirale sous son départ : impossible à poser), si bien que la
    // première chaîne arrivée n'est pas forcément prolongeable.
    const stateKey = (p: PlannedPathTile) => (bridgeLevel !== undefined ? `${tileKey(p)}|${p.level}|${p.slopeDirection ?? -1}` : tileKey(p));
    const maxVisitsPerState = bridgeLevel !== undefined ? 4 : 1;
    const nodes: { tile: PlannedPathTile; parent: number; d: number }[] = [{ tile: first, parent: -1, d: 0 }];
    const visits = new Map<string, number>([[stateKey(first), 1]]);
    const onChain = (node: number, n: TileXY): boolean => {
        for (let i = node; i >= 0; i = nodes[i].parent) if (nodes[i].tile.x === n.x && nodes[i].tile.y === n.y) return true;
        return false;
    };
    for (let head = 0; head < nodes.length; head++) {
        const { tile: cur, d } = nodes[head];
        const t: TileXY = cur;
        if (d >= maxDistance) continue;
        for (let dir = 0; dir < 4; dir++) {
            const n = { x: t.x + DIRECTION_DELTA[dir].x, y: t.y + DIRECTION_DELTA[dir].y };
            const side = dir as Direction;
            const curEdge = edgeLevel(cur, side);
            if (curEdge === null) continue;
            if (opts.avoid?.has(tileKey(n))) continue;
            const nt = get(n.x, n.y);
            if (!nt) continue;
            // Chemin existant : raccord si un de ses éléments est au bon niveau.
            const existing = nt.p?.find((p) => {
                const pe = edgeLevel({ level: p.l, slopeDirection: p.sd >= 0 ? (p.sd as Direction) : null }, reverseDirection(side));
                return pe === curEdge && !p.q;
            });
            if (existing) {
                const out: PlannedPathTile[] = [];
                for (let i = head; i >= 0; i = nodes[i].parent) out.unshift(nodes[i].tile);
                return out;
            }
            // Le jeu relie automatiquement un chemin posé aux files voisines : passer le long de la file d'une
            // autre attraction fusionnerait les deux (constaté en jeu, SPIKES S2).
            if (touchesQueue(n, t, get)) continue;
            if (bridgeLevel !== undefined && onChain(head, n)) continue;
            // Candidats de pose pour la tuile voisine, continuant au même niveau (`curEdge`) du côté d'où l'on
            // vient. En mode terrain, le terrain impose la pente ; en mode passerelle, on peut aussi monter ou
            // descendre d'un niveau indépendamment du terrain (rampe sur supports).
            const owned = (nt.o & 1) !== 0 || (nt.o & 2) !== 0 || opts.sandbox;
            const candidates: PlannedPathTile[] =
                bridgeLevel !== undefined
                    ? !owned
                        ? []
                        : ([
                              { level: curEdge, slopeDirection: null },
                              { level: curEdge, slopeDirection: side },
                              { level: curEdge - 1, slopeDirection: reverseDirection(side) },
                          ] as const)
                              .filter((c) => elevatedPlacement(nt, c.level) !== null && (c.slopeDirection === null || elevatedPlacement(nt, c.level + 1) !== null))
                              .map((c) => ({ x: n.x, y: n.y, ...c }))
                    : (() => {
                          if (!pathPassable(nt, opts.sandbox)) return [];
                          const p = onTerrain(nt);
                          return p ? [{ x: n.x, y: n.y, ...p }] : [];
                      })();
            for (const np of candidates) {
                if (edgeLevel(np, reverseDirection(side)) !== curEdge) continue;
                const k = stateKey(np);
                const v = visits.get(k) ?? 0;
                if (v >= maxVisitsPerState) continue;
                visits.set(k, v + 1);
                nodes.push({ tile: np, parent: head, d: d + 1 });
            }
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
