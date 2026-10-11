// Base de styles sur disque (Style Picker, SPEC 13.7).
//
//   <stylesDir>/styles/<id>/style.json       relevé complet (StyleRecord), positions relatives au coin de la région
//   <stylesDir>/styles/<id>/caption.txt      légende saisie dans le jeu
//   <stylesDir>/styles/<id>/screenshot-r<r>.png  capture masquée de la région seule, rotation r (fond transparent)
//   <stylesDir>/magic-fill/<id>.json         demandes Magic Fill et leur suite (voir inbox.ts)
//
// Les fichiers sont la source de vérité : on peut copier, supprimer ou renommer un dossier de style à la main.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { slugify, type StyleElement, type StyleRecord } from "@openrct2-claude/protocol";
import { log } from "../log.js";
import { maskCapture, type MaskColumn } from "../render/mask.js";
import type { CaptureView } from "../render/projection.js";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

export interface StyleSummary {
    id: string;
    caption: string;
    createdAt: string;
    source: string;
    park: string | null;
    tiles: number;
    size: string;
    counts: Record<string, number>;
    /** Éléments de scénerie (petite, grande, murs) par tuile. */
    density: number;
    /** Objets les plus présents (part des éléments de scénerie). */
    topObjects: { id: string; name: string; n: number }[];
    /** Empilement : hauteur relative maximale (baseHeight) et éléments au-dessus d'un autre sur la même tuile. */
    maxDz: number;
    stacked: number;
    terrain: { surfaces: string[]; waterShare: number; slopedShare: number; heightRange: number };
    rides: string[];
    screenshots: number[];
}

const SCENERY = new Set(["small_scenery", "large_scenery", "wall"]);

export function summarize(r: StyleRecord): StyleSummary {
    const counts: Record<string, number> = {};
    const objects = new Map<string, number>();
    let scenery = 0;
    let maxDz = 0;
    const perTile = new Map<string, number>();
    let stacked = 0;
    for (const e of r.elements) {
        counts[e.t] = (counts[e.t] ?? 0) + 1;
        if (!SCENERY.has(e.t)) continue;
        if (e.t === "large_scenery" && (e.sequence ?? 0) !== 0) continue;
        scenery++;
        if (e.object) objects.set(e.object, (objects.get(e.object) ?? 0) + 1);
        maxDz = Math.max(maxDz, e.dz);
        const k = `${e.dx},${e.dy}`;
        const n = perTile.get(k) ?? 0;
        if (n > 0 && e.dz > 1) stacked++;
        perTile.set(k, n + 1);
    }
    const surf = new Map<string, number>();
    let water = 0;
    let sloped = 0;
    let hMin = Infinity;
    let hMax = -Infinity;
    for (const s of r.surfaces) {
        if (s.surface) surf.set(s.surface, (surf.get(s.surface) ?? 0) + 1);
        if (s.water > s.baseHeight) water++;
        if (s.slope & 0x1f) sloped++;
        hMin = Math.min(hMin, s.baseHeight);
        hMax = Math.max(hMax, s.baseHeight);
    }
    const n = Math.max(1, r.surfaces.length);
    return {
        id: r.id,
        caption: r.caption,
        createdAt: r.createdAt,
        source: r.source,
        park: r.park?.name ?? null,
        tiles: r.tiles.length,
        size: `${r.size.x}×${r.size.y}`,
        counts,
        density: Math.round((scenery / Math.max(1, r.tiles.length)) * 100) / 100,
        topObjects: [...objects.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([id, k]) => ({ id, name: r.objects[id]?.name ?? id, n: k })),
        maxDz,
        stacked,
        terrain: {
            surfaces: [...surf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id),
            waterShare: Math.round((water / n) * 100) / 100,
            slopedShare: Math.round((sloped / n) * 100) / 100,
            heightRange: isFinite(hMin) ? (hMax - hMin) / 2 : 0,
        },
        rides: r.rides.map((x) => x.name),
        screenshots: r.screenshots.map((s) => s.rotation),
    };
}

/** Colonnes (sol → plus haut élément) des tuiles d'un style, en coordonnées de carte absolues, pour le masque. */
export function columnsOf(r: { origin: { x: number; y: number }; tiles: [number, number][]; surfaces: StyleRecord["surfaces"]; elements: StyleElement[] }): MaskColumn[] {
    const cols = new Map<string, MaskColumn>();
    for (const [dx, dy] of r.tiles) cols.set(`${dx},${dy}`, { x: r.origin.x + dx, y: r.origin.y + dy, zLow: Infinity, zHigh: 0 });
    for (const s of r.surfaces) {
        const c = cols.get(`${s.dx},${s.dy}`);
        if (!c) continue;
        c.zLow = Math.min(c.zLow, s.baseHeight * 8);
        c.zHigh = Math.max(c.zHigh, s.baseHeight * 8 + 32, s.water * 8);
    }
    for (const e of r.elements) {
        const c = cols.get(`${e.dx},${e.dy}`);
        if (!c) continue;
        c.zLow = Math.min(c.zLow, e.baseHeight * 8);
        c.zHigh = Math.max(c.zHigh, e.clearanceHeight * 8);
    }
    return [...cols.values()].map((c) => ({ ...c, zLow: isFinite(c.zLow) ? c.zLow : 0 }));
}

function tokens(text: string): string[] {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2);
}

/** Recouvrement des mots (légende × 3, noms d'objets × 1), avec une tolérance pour les pluriels. */
export function relevance(query: string, r: StyleRecord): number {
    const q = tokens(query);
    if (q.length === 0) return 0;
    const caption = tokens(r.caption);
    const names = Object.values(r.objects).flatMap((o) => tokens(o.name));
    const match = (t: string, words: string[]) => words.some((w) => w === t || (t.length > 3 && (w.startsWith(t) || t.startsWith(w)) && Math.abs(w.length - t.length) <= 2));
    let score = 0;
    for (const t of q) {
        if (match(t, caption)) score += 3;
        if (match(t, names)) score += 1;
    }
    return score / q.length;
}

export class StyleStore {
    private cache = new Map<string, { mtime: number; record: StyleRecord }>();

    constructor(readonly root: string) {}

    get stylesDir(): string {
        return join(this.root, "styles");
    }

    dirOf(id: string): string {
        if (!SAFE_ID.test(id)) throw new Error(`identifiant de style invalide : ${id}`);
        return join(this.stylesDir, id);
    }

    ids(): string[] {
        if (!existsSync(this.stylesDir)) return [];
        return readdirSync(this.stylesDir).filter((d) => SAFE_ID.test(d) && existsSync(join(this.stylesDir, d, "style.json")));
    }

    get(id: string): StyleRecord | null {
        if (!SAFE_ID.test(id)) return null;
        const file = join(this.stylesDir, id, "style.json");
        if (!existsSync(file)) return null;
        const mtime = statSync(file).mtimeMs;
        const hit = this.cache.get(id);
        if (hit && hit.mtime === mtime) return hit.record;
        try {
            const record = JSON.parse(readFileSync(file, "utf8")) as StyleRecord;
            // La légende éditée à la main dans caption.txt l'emporte.
            const cap = join(this.stylesDir, id, "caption.txt");
            if (existsSync(cap)) record.caption = readFileSync(cap, "utf8").trim();
            this.cache.set(id, { mtime, record });
            return record;
        } catch (e) {
            log.warn("style illisible", { id, message: e instanceof Error ? e.message : String(e) });
            return null;
        }
    }

    all(): StyleRecord[] {
        return this.ids()
            .map((id) => this.get(id))
            .filter((r): r is StyleRecord => r !== null)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /**
     * Range un style reçu du plugin : style.json, caption.txt, et ses captures déplacées du dossier screenshot du jeu,
     * masquées à l'emprise de la région. Idempotent (un style déjà rangé est remplacé).
     */
    save(record: StyleRecord, screenshotDir: string): { dir: string; screenshots: number } {
        const dir = this.dirOf(record.id);
        mkdirSync(dir, { recursive: true });
        const columns = columnsOf(record);
        const shots: StyleRecord["screenshots"] = [];
        for (const s of record.screenshots) {
            const src = join(screenshotDir, s.file);
            const dest = `screenshot-r${s.rotation}.png`;
            if (!existsSync(src)) {
                if (existsSync(join(dir, dest))) shots.push({ ...s, file: dest });
                continue;
            }
            try {
                const view: CaptureView = { centerX: s.centerX, centerY: s.centerY, centerZ: s.centerZ, zoom: s.zoom, rotation: s.rotation, width: s.width, height: s.height };
                const masked = maskCapture(readFileSync(src), view, columns);
                writeFileSync(join(dir, dest), masked.png);
                unlinkSync(src);
            } catch (e) {
                log.warn("capture de style non masquée", { id: record.id, message: e instanceof Error ? e.message : String(e) });
                try {
                    renameSync(src, join(dir, dest));
                } catch {
                    copyFileSync(src, join(dir, dest));
                }
            }
            shots.push({ ...s, file: dest });
        }
        const stored: StyleRecord = { ...record, screenshots: shots };
        writeFileSync(join(dir, "style.json"), JSON.stringify(stored));
        writeFileSync(join(dir, "caption.txt"), record.caption + "\n");
        this.cache.delete(record.id);
        return { dir, screenshots: shots.length };
    }

    screenshot(id: string, rotation: number): Buffer | null {
        const r = this.get(id);
        const s = r?.screenshots.find((x) => x.rotation === rotation) ?? r?.screenshots[0];
        if (!r || !s) return null;
        const file = join(this.stylesDir, id, s.file);
        return existsSync(file) ? readFileSync(file) : null;
    }

    delete(id: string): boolean {
        const dir = this.dirOf(id);
        if (!existsSync(dir)) return false;
        rmSync(dir, { recursive: true, force: true });
        this.cache.delete(id);
        return true;
    }

    /** Vide la base (bouton « Clear all stored styles », style_delete { all }). Rend le nombre de styles supprimés. */
    clearAll(): number {
        let n = 0;
        for (const id of this.ids()) if (this.delete(id)) n++;
        return n;
    }

    /** Styles classés par pertinence pour un texte libre (prompt Magic Fill, recherche), puis du plus récent au plus ancien. */
    search(query: string | undefined): { record: StyleRecord; score: number }[] {
        const all = this.all().map((record) => ({ record, score: query ? relevance(query, record) : 0 }));
        if (query) all.sort((a, b) => b.score - a.score);
        return all;
    }

    static idFor(caption: string, id: string): string {
        return `${id}-${slugify(caption, 24)}`.replace(/-+$/, "");
    }
}
