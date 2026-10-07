// Cache de carte côté serveur (SPEC 8.6) : alimenté par map.region par blocs, invalidé après écriture
// et sur map_changed.

import { normalizeRect, type RegionTile, type TileRect, type TileXY } from "@openrct2-claude/protocol";
import type { BridgeLike } from "../bridge.js";

const BLOCK = 64;

export class MapCache {
    private tiles = new Map<number, RegionTile>();
    private size: TileXY | null = null;
    private generation = 0;

    constructor(private readonly bridge: BridgeLike) {
        bridge.on("event:map_changed", () => this.invalidateAll());
        bridge.on("connected", () => this.invalidateAll());
    }

    invalidateAll(): void {
        this.tiles.clear();
        this.size = null;
        this.generation++;
    }

    invalidate(rect: TileRect, margin = 1): void {
        const r = normalizeRect(rect);
        for (let y = r.y1 - margin; y <= r.y2 + margin; y++) {
            for (let x = r.x1 - margin; x <= r.x2 + margin; x++) this.tiles.delete(this.key(x, y));
        }
    }

    invalidateTiles(tiles: TileXY[], margin = 1): void {
        for (const t of tiles) this.invalidate({ x1: t.x, y1: t.y, x2: t.x, y2: t.y }, margin);
    }

    private key(x: number, y: number): number {
        return y * 4096 + x;
    }

    async mapSize(): Promise<TileXY> {
        if (!this.size) this.size = await this.bridge.call("map.size", {});
        return this.size;
    }

    /** Restreint un rectangle à la carte. */
    async clamp(rect: TileRect): Promise<TileRect> {
        const s = await this.mapSize();
        const r = normalizeRect(rect);
        return { x1: Math.max(0, r.x1), y1: Math.max(0, r.y1), x2: Math.min(s.x - 1, r.x2), y2: Math.min(s.y - 1, r.y2) };
    }

    /** Garantit que toutes les tuiles du rectangle sont en cache, par blocs alignés de 64×64. */
    async ensure(rect: TileRect): Promise<void> {
        const r = await this.clamp(rect);
        if (r.x1 > r.x2 || r.y1 > r.y2) return;
        for (let by = Math.floor(r.y1 / BLOCK) * BLOCK; by <= r.y2; by += BLOCK) {
            for (let bx = Math.floor(r.x1 / BLOCK) * BLOCK; bx <= r.x2; bx += BLOCK) {
                const block = { x1: Math.max(bx, r.x1), y1: Math.max(by, r.y1), x2: Math.min(bx + BLOCK - 1, r.x2), y2: Math.min(by + BLOCK - 1, r.y2) };
                if (this.isComplete(block)) continue;
                const gen = this.generation;
                const res = await this.bridge.call("map.region", block);
                if (gen !== this.generation) return;
                let i = 0;
                for (let y = res.rect.y1; y <= res.rect.y2; y++) {
                    for (let x = res.rect.x1; x <= res.rect.x2; x++) this.tiles.set(this.key(x, y), res.tiles[i++]);
                }
            }
        }
    }

    private isComplete(r: TileRect): boolean {
        for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) if (!this.tiles.has(this.key(x, y))) return false;
        return true;
    }

    get(x: number, y: number): RegionTile | undefined {
        return this.tiles.get(this.key(x, y));
    }

    /** Lit un rectangle (après ensure). Les tuiles hors carte valent undefined. */
    async region(rect: TileRect): Promise<{ rect: TileRect; get: (x: number, y: number) => RegionTile | undefined }> {
        const r = await this.clamp(rect);
        await this.ensure(r);
        return { rect: r, get: (x, y) => this.get(x, y) };
    }

    snapshot(rect: TileRect): Map<number, RegionTile> {
        const r = normalizeRect(rect);
        const out = new Map<number, RegionTile>();
        for (let y = r.y1; y <= r.y2; y++)
            for (let x = r.x1; x <= r.x2; x++) {
                const t = this.get(x, y);
                if (t) out.set(this.key(x, y), t);
            }
        return out;
    }

    static keyOf(x: number, y: number): number {
        return y * 4096 + x;
    }
}
