// Magic Fill (SPEC 13.7) : remplit une région en y recopiant des morceaux de styles relevés par le Style Picker.
//
// Claude choisit les styles (et leur poids) d'après la demande et le voisinage ; ce planificateur, déterministe pour
// une graine donnée, place. Il « tamponne » des patchs entiers : une tuile cible encore libre est prise au hasard,
// on choisit un style (selon les poids), une tuile de ce style et une rotation, et toutes les tuiles du style tombent
// sur les tuiles cibles correspondantes. On garde ainsi ce qui fait un style : bosquets, espacements, empilements
// (Zero Clearances), mélange d'objets, couleurs et orientations, vides compris. Rotation d'un quart de tour : position
// par CoordsXY::Rotate, direction, quadrant et bord de mur + k (même règle que les designs, TrackDesign.cpp).
//
// Hauteurs : relatives à la surface (ou à l'eau) de la tuile, en baseHeight. Un objet posé au sol dans le style est
// posé « au sol » (hauteur automatique du jeu, qui suit pente et eau) ; un objet surélevé ou enterré garde son écart.
// Exception : un objet sous l'eau dans le style garde une hauteur explicite (la hauteur automatique le poserait sur l'eau).
//
// Relief (relief: "copy") : le relief du style (collines, creux, falaises) est recopié avec chaque tampon, ajouté au
// terrain existant, coin de tuile par coin de tuile : coin cible += coin du style − coin le plus bas du style. Les
// falaises du style restent des falaises. Les coins partagés avec une tuile hors remplissage (bord de la région,
// chemin, eau, scénerie gardée) ne bougent pas ; le relief s'adoucit vers eux (pente ≤ 1 niveau par arête). Les
// hauteurs de scénerie sont ensuite calculées sur le terrain remodelé.
//
// Texture (texture: "copy") : chaque tuile remplie prend la surface (herbe, roche…) et la bordure (falaises) de la
// tuile du style qui tombe dessus.
//
// Eau (water: "copy") : une tuile d'eau du style peut tomber sur une tuile sèche ; elle y est remise en eau, au
// niveau du style relatif au point le plus bas du style (× reliefScale), compté depuis le sol d'origine de la tuile où
// le tampon est ancré. Puis confinement : une tuile dont un bord donne sur un sol plus bas que l'eau (voisine sèche,
// ou bord de la région sans relief connu au-delà) déborderait ; elle reste sèche, et on recommence jusqu'à stabilité.
//
// Rivière (river) : les tampons, tirés au hasard, ne font que des mares. Un cours d'eau continu est donc tracé
// d'abord : ligne brisée (donnée, ou zigzag le long du grand axe de la région, de bord à bord), largeur en tuiles,
// lit creusé à plat `depth` niveaux sous l'eau, eau au ras du sol le plus bas du tracé (berges ≥ eau). Les tuiles de
// la rivière deviennent de l'eau avant le tamponnage : matchWater y met l'eau des styles (et leurs plantes d'eau),
// et le relief recopié part de leurs berges. Avec une rivière, l'eau des styles n'est posée que sur l'eau.
//
// Placement des tampons : parmi quelques tirages (style, tuile, rotation), on garde celui qui couvre le plus de
// tuiles libres, pour que les bosquets et les collines du style tombent entiers dans la région.
//
// Bâtiments en terrain (colonnes à bords à pic avec une bordure de façade, gratte-ciel RCT1 : styles/structure.ts) :
// un tampon coupé collerait la colonne au tampon voisin, qui monterait en colline jusqu'au toit, ou la ferait
// descendre en rampe vers un bord fixé. Un tel style n'est donc tamponné qu'entier, sur des tuiles libres, sèches et
// remodelables ; sinon le tirage est écarté (et, si seuls des bâtiments ont été tirés, on retire parmi les autres
// styles). Son relief est recopié à l'échelle 1 (reliefScale ne vaut que pour le relief naturel).
//
// Constructions (styles/structure.ts styleKind : bâtiment en terrain, ou objets empilés comme un château ; choix de
// l'utilisateur prioritaire) : tamponnées comme les bâtiments, entières, et en BLOC RIGIDE. Constat du 12 octobre :
// des tours et des murs de château tamponnés sur une colline flottaient. Chaque élément gardait son écart au sol de SA
// tuile ; sur un terrain en pente les étages d'une même tour glissaient les uns par rapport aux autres, et un tampon
// coupé gardait ses pièces hautes sans leurs appuis. Un bloc rigide a donc UN niveau de base (moyenne du terrain sous
// son emprise, ou `level` donné) : son point le plus bas y tombe, son relief propre est recopié tel quel (sol nivelé,
// coins fixés ; le terrain voisin descend vers eux de 1 niveau par arête), et chaque élément est posé à une hauteur
// explicite, base + (hauteur dans le style − point le plus bas du style). density ne l'éclaircit pas.
//
// Blocs explicites (FillOptions.blocks) : un style posé à une position, une rotation et un niveau donnés, découpé au
// besoin (crop, en coordonnées du style). Posés avant la rivière et les tampons tirés au hasard, ils servent à
// assembler une grande construction à partir de pièces : tours aux coins, rangée de mur répétée entre elles.

import { MAX_LEVEL, MIN_LEVEL, rotateOffset, type StyleElement, type StyleRecord, type TerrainHeightItem, type TileXY } from "@openrct2-claude/protocol";
import { styleKind } from "../styles/structure.js";
import { CORNERS, cornerLevels, tileFromCorners } from "./heightmap.js";

export type FillType = "small_scenery" | "large_scenery" | "wall";

export interface FillTargetTile {
    x: number;
    y: number;
    baseHeight: number;
    slope: number;
    water: number;
    /** Chemin, piste ou entrée sur la tuile. */
    blocked: boolean;
    /** Scénerie déjà présente (petite, grande, mur, bannière). */
    occupied: boolean;
    /** Objets terrain_surface et terrain_edge actuels (texture: "copy" : on saute les tuiles déjà identiques). */
    surface?: string | null;
    edge?: string | null;
}

export interface FillSource {
    record: StyleRecord;
    weight: number;
}

export interface FillOptions {
    seed: number;
    /** Part des éléments du style gardés (0-1]. */
    density: number;
    rotate: boolean;
    occupied: "skip" | "add" | "replace";
    avoidPaths: boolean;
    include: FillType[];
    /** Ne pose une tuile de style sur l'eau que si elle était sur l'eau (et inversement). */
    matchWater: boolean;
    /** copy : recopie le relief des styles sur les tuiles remplies ; keep : le terrain ne bouge pas. */
    relief?: "copy" | "keep";
    /** Multiplie la hauteur du relief recopié (2 : collines deux fois plus hautes ; 0,5 : moitié). Défaut 1. */
    reliefScale?: number;
    /** copy : recopie la surface et la bordure des tuiles du style ; keep : textures inchangées. */
    texture?: "copy" | "keep";
    /** copy : les tuiles d'eau du style sont remises en eau sur la cible (voir l'en-tête) ; keep : eau inchangée. */
    water?: "copy" | "keep";
    /** Cours d'eau continu tracé avant le tamponnage (voir l'en-tête). */
    river?: FillRiver;
    /** Blocs posés à une place donnée, avant tout le reste (voir l'en-tête). */
    blocks?: FillBlock[];
}

export interface FillBlock {
    record: StyleRecord;
    /** Coin (x, y minimaux) de l'emprise du bloc sur la carte, après rotation et découpe. */
    x: number;
    y: number;
    /** Quarts de tour (même règle que les patchs). */
    rotation: number;
    /** Niveau où tombe le point le plus bas du style ; absent : moyenne du terrain sous l'emprise. */
    level?: number;
    /** Part du style gardée, en coordonnées du style (avant rotation), bornes comprises. */
    crop?: { x1: number; y1: number; x2: number; y2: number };
}

export interface FillBlockResult {
    index: number;
    style: string;
    /** placed : tuiles du bloc et niveau retenu ; sinon la raison du refus. */
    placed: boolean;
    tiles: number;
    level?: number;
    bbox?: { x1: number; y1: number; x2: number; y2: number };
    reason?: string;
}

export interface FillRiver {
    /** Ligne brisée en tuiles ; absente : zigzag automatique le long du grand axe de la région. */
    path?: TileXY[];
    /** Largeur en tuiles. */
    width: number;
    /** Profondeur du lit sous l'eau, en niveaux. */
    depth: number;
    /** Zigzag automatique : nombre de virages. */
    bends: number;
}

export interface FillWater {
    x: number;
    y: number;
    /** Niveau de la surface de l'eau. */
    level: number;
}

export interface FillTexture {
    x: number;
    y: number;
    /** null : inchangé. */
    surface: string | null;
    edge: string | null;
}

export interface FillSmall {
    object: string;
    x: number;
    y: number;
    baseHeight: number | null;
    quadrant: number;
    direction: number;
    colours: [number, number, number];
    style: string;
}

export interface FillLarge {
    object: string;
    x: number;
    y: number;
    baseHeight: number;
    direction: number;
    colours: [number, number, number];
    style: string;
}

export interface FillWall {
    object: string;
    x: number;
    y: number;
    baseHeight: number | null;
    edge: number;
    colours: [number, number, number];
    style: string;
}

export interface FillPlan {
    small: FillSmall[];
    large: FillLarge[];
    walls: FillWall[];
    /** Tuiles à vider avant la pose (occupied: "replace"). */
    clear: TileXY[];
    stamps: Record<string, number>;
    tiles: { target: number; filled: number; empty: number; skippedBlocked: number; skippedOccupied: number; waterMismatch: number };
    /** Relief recopié (relief: "copy") : hauteurs et pentes à poser avant la scénerie, et l'état d'avant. */
    terrain: TerrainHeightItem[];
    terrainBefore: TerrainHeightItem[];
    /** cliffs : bords de tuile en falaise après remodelage ; invalid : tuiles laissées telles quelles (forme impossible). */
    relief: { tiles: number; maxRise: number; cliffs: number; invalid: number };
    /**
     * Constructions (bâtiments en terrain, objets empilés) : tampons posés entiers en bloc rigide, tirages écartés
     * faute de place entière, blocs explicites et leur sort, et blocs posés sans terrain nivelé (relief: keep).
     */
    structures: { stamps: number; misses: number; blocks: FillBlockResult[]; unlevelled: number };
    /** Textures recopiées (texture: "copy"), et l'état d'avant. */
    textures: FillTexture[];
    texturesBefore: FillTexture[];
    /** Tuiles remises en eau (après le relief). */
    water: FillWater[];
    /** river : tuiles du tracé, niveau d'eau et du lit, tracé suivi ; leaked : tuiles d'eau laissées sèches (débordement). */
    waterInfo: { fromStyles: number; leaked: number; river: { tiles: number; level: number; bed: number; path: TileXY[] } | null };
    /** Éléments du style que Magic Fill ne pose pas (chemins, pistes, entrées, bannières) ou hors de la région. */
    notPlaced: Record<string, number>;
    objects: string[];
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Prepared {
    id: string;
    weight: number;
    tiles: [number, number][];
    water: Map<string, boolean>;
    surface: Map<string, { baseHeight: number; slope: number; water: number; surface: string | null; edge: string | null }>;
    /** Niveaux des coins (S, E, N, W) de chaque tuile du style, et le plus bas. */
    corners: Map<string, [number, number, number, number]>;
    vmin: number;
    byTile: Map<string, StyleElement[]>;
    large: { origin: { dx: number; dy: number; baseHeight: number }; object: string; direction: number; colours: [number, number, number]; footprint: [number, number][] }[];
    record: StyleRecord;
    /** Construction (styleKind) : tamponnée entière ou pas du tout, en bloc rigide (voir l'en-tête). */
    atomic: boolean;
}

const key = (x: number, y: number) => `${x},${y}`;

function cropTiles(tiles: [number, number][], crop: FillBlock["crop"]): [number, number][] {
    if (!crop) return tiles;
    const [x1, x2] = [Math.min(crop.x1, crop.x2), Math.max(crop.x1, crop.x2)];
    const [y1, y2] = [Math.min(crop.y1, crop.y2), Math.max(crop.y1, crop.y2)];
    return tiles.filter(([x, y]) => x >= x1 && x <= x2 && y >= y1 && y <= y2);
}

/** Bloc découpé : seules les tuiles de `crop` restent ; vmin reste celui du style entier (même base pour toutes les découpes). */
function cropPrepared(s: Prepared, crop: FillBlock["crop"]): Prepared {
    return crop ? { ...s, tiles: cropTiles(s.tiles, crop) } : s;
}

/** Tuile de carte de chaque tuile (découpée) du style d'un bloc : emprise tournée, son coin (x, y minimaux) en (x, y). */
export function blockFootprint(b: Pick<FillBlock, "record" | "x" | "y" | "rotation" | "crop">): { q: [number, number]; at: TileXY }[] {
    const tiles = cropTiles(b.record.tiles, b.crop);
    if (tiles.length === 0) return [];
    const k = ((b.rotation % 4) + 4) % 4;
    const rot = tiles.map((q) => rotateOffset({ x: q[0], y: q[1] }, k));
    const mx = Math.min(...rot.map((o) => o.x));
    const my = Math.min(...rot.map((o) => o.y));
    return tiles.map((q, n) => ({ q, at: { x: b.x + rot[n].x - mx, y: b.y + rot[n].y - my } }));
}

function prepare(src: FillSource, notPlaced: Record<string, number>): Prepared {
    const r = src.record;
    const surface: Prepared["surface"] = new Map();
    const water = new Map<string, boolean>();
    const corners = new Map<string, [number, number, number, number]>();
    let vmin = Infinity;
    for (const s of r.surfaces) {
        surface.set(key(s.dx, s.dy), { baseHeight: s.baseHeight, slope: s.slope, water: s.water, surface: s.surface, edge: s.edge });
        water.set(key(s.dx, s.dy), s.water > s.baseHeight);
        const c = cornerLevels({ h: s.baseHeight / 2, s: s.slope });
        corners.set(key(s.dx, s.dy), c);
        vmin = Math.min(vmin, ...c);
    }
    const byTile = new Map<string, StyleElement[]>();
    const large = new Map<string, Prepared["large"][number]>();
    for (const e of r.elements) {
        if (e.t === "small_scenery" || e.t === "wall") {
            const k = key(e.dx, e.dy);
            const list = byTile.get(k) ?? [];
            list.push(e);
            byTile.set(k, list);
        } else if (e.t === "large_scenery") {
            if (!e.origin || !e.object) {
                notPlaced.large_scenery_unknown_origin = (notPlaced.large_scenery_unknown_origin ?? 0) + 1;
                continue;
            }
            const k = `${e.object}:${e.origin.dx}:${e.origin.dy}:${e.origin.baseHeight}:${e.direction}`;
            let g = large.get(k);
            if (!g) {
                const tiles = r.objects[e.object]?.tiles;
                const footprint: [number, number][] = tiles
                    ? tiles.map((t) => {
                          const o = rotateOffset({ x: t.x, y: t.y }, e.direction ?? 0);
                          return [Math.round(o.x / 32), Math.round(o.y / 32)] as [number, number];
                      })
                    : [];
                g = { origin: e.origin, object: e.object, direction: e.direction ?? 0, colours: e.colours ?? [0, 0, 0], footprint };
                large.set(k, g);
            }
            if (!r.objects[e.object]?.tiles) g.footprint.push([e.dx - e.origin.dx, e.dy - e.origin.dy]);
        } else {
            notPlaced[e.t] = (notPlaced[e.t] ?? 0) + 1;
        }
    }
    const atomic = styleKind(r).kind === "structure";
    return { id: r.id, weight: Math.max(0, src.weight), tiles: r.tiles, water, surface, corners, vmin, byTile, large: [...large.values()], record: r, atomic };
}

function pickWeighted<T extends { weight: number }>(items: T[], rnd: () => number): T {
    const total = items.reduce((n, i) => n + i.weight, 0);
    let v = rnd() * total;
    for (const i of items) {
        v -= i.weight;
        if (v <= 0) return i;
    }
    return items[items.length - 1];
}

/**
 * Recopie le relief des tampons sur les tuiles remplies (voir l'en-tête), met à jour `tgt` (hauteurs et pentes
 * après remodelage) pour que la scénerie soit posée sur le nouveau terrain, et remplit plan.terrain.
 *
 * Travail par coin de tuile, pas par sommet partagé : une falaise du style (coins voisins à des hauteurs
 * différentes) reste une falaise. Deux coins voisins sont « collés » (même hauteur) sauf s'ils étaient déjà séparés
 * avant (falaise existante) ou s'ils viennent du même tampon et que le style les sépare. Les coins touchant une
 * tuile non remodelée gardent leur hauteur ; le relief y descend de 1 niveau par arête, et ne descend que là
 * (les falaises du style arrêtent cette descente : leur sommet garde sa hauteur).
 */
function copyRelief(
    plan: FillPlan,
    tgt: Map<string, FillTargetTile>,
    assigned: Map<string, { s: Prepared; q: [number, number]; k: number; stamp: number }>,
    stamps: Stamp[],
    opts: FillOptions,
): void {
    // Tuiles remodelables : remplies, hors de l'eau, sans scénerie gardée (landsetheight retire la petite scénerie).
    const shapeable: string[] = [];
    for (const [tk] of assigned) {
        const t = tgt.get(tk)!;
        if (t.water > t.baseHeight || t.blocked) continue;
        if (t.occupied && opts.occupied !== "replace") continue;
        shapeable.push(tk);
    }
    if (shapeable.length === 0) return;
    const index = new Map(shapeable.map((tk, n) => [tk, n]));
    const scale = opts.reliefScale ?? 1;
    const N = shapeable.length;
    const ex: number[][] = [];
    const c: number[][] = [];
    const sc: (number | undefined)[][] = [];
    const pin: boolean[][] = [];
    const stampOf: number[] = [];
    const byVertex = new Map<string, [number, number][]>();
    const rigidTile = new Set(
        shapeable.filter((tk) => {
            const st = stamps[assigned.get(tk)!.stamp];
            return st.rigid && st.level !== undefined;
        }),
    );
    for (let n = 0; n < N; n++) {
        const t = tgt.get(shapeable[n])!;
        const a = assigned.get(shapeable[n])!;
        const st = stamps[a.stamp];
        const qc = st.s.corners.get(key(a.q[0], a.q[1]));
        ex.push(cornerLevels({ h: t.baseHeight / 2, s: t.slope }));
        stampOf.push(a.stamp);
        sc.push([]);
        pin.push([]);
        c.push([]);
        CORNERS.forEach((o, i) => {
            const T = { x: t.x + o.dx, y: t.y + o.dy };
            // Coin du style qui tombe sur ce coin (même règle que mapTile, autour du centre des tuiles).
            const back = rotateOffset({ x: T.x - st.u.x - 0.5, y: T.y - st.u.y - 0.5 }, (4 - st.k) & 3);
            const vx = Math.round(st.p[0] + 0.5 + back.x) - a.q[0];
            const vy = Math.round(st.p[1] + 0.5 + back.y) - a.q[1];
            const j = CORNERS.findIndex((q) => q.dx === vx && q.dy === vy);
            const v = qc && j >= 0 ? qc[j] : undefined;
            sc[n][i] = v;
            if (rigidTile.has(shapeable[n]) && v !== undefined) {
                // Bloc rigide : sol nivelé sur sa base, son relief propre tel quel, coins fixés.
                pin[n][i] = true;
                c[n][i] = st.level! + (v - st.s.vmin);
            } else {
                // Coin touchant une tuile non remodelée (bord, chemin, eau, scénerie gardée) ou un bloc rigide : fixé
                // au sol d'origine. Le bord du bloc devient une falaise de terrasse, sans rampe qui monterait vers lui.
                pin[n][i] = !CORNERS.every((q) => {
                    const nk = key(T.x - q.dx, T.y - q.dy);
                    return index.has(nk) && !rigidTile.has(nk);
                });
                c[n][i] = pin[n][i] || v === undefined ? ex[n][i] : ex[n][i] + Math.round((v - st.s.vmin) * scale);
            }
            const vk = key(T.x, T.y);
            const list = byVertex.get(vk) ?? [];
            list.push([n, i]);
            byVertex.set(vk, list);
        });
    }
    // Coins collés entre tuiles voisines.
    const glue: [number, number, number, number][] = [];
    for (const list of byVertex.values())
        for (let x = 0; x < list.length; x++)
            for (let y = x + 1; y < list.length; y++) {
                const [a, i] = list[x];
                const [b, j] = list[y];
                if (ex[a][i] !== ex[b][j]) continue;
                if (stampOf[a] === stampOf[b] && sc[a][i] !== sc[b][j]) continue;
                // Bloc rigide : ses coins sont fixés, ceux du voisin aussi (sol d'origine) : rien à coller.
                if (rigidTile.has(shapeable[a]) || rigidTile.has(shapeable[b])) continue;
                glue.push([a, i, b, j]);
            }
    const limit = 4 * Math.ceil(Math.sqrt(N)) + 64;
    // 1. Coutures entre tampons : le côté bas monte (une colline coupée par un autre tampon descend en pente).
    for (let pass = 0, changed = true; changed && pass < limit; pass++) {
        changed = false;
        for (const [a, i, b, j] of glue) {
            if (pin[a][i] || pin[b][j] || c[a][i] === c[b][j]) continue;
            const m = Math.max(c[a][i], c[b][j]);
            c[a][i] = c[b][j] = m;
            changed = true;
        }
        for (let n = 0; n < N; n++)
            for (let i = 0; i < 4; i++) {
                const j = (i + 1) & 3;
                if (!pin[n][i] && c[n][i] < c[n][j] - 1) ((c[n][i] = c[n][j] - 1), (changed = true));
                if (!pin[n][j] && c[n][j] < c[n][i] - 1) ((c[n][j] = c[n][i] - 1), (changed = true));
            }
    }
    // 2. Vers les coins fixés : le relief descend de 1 niveau par arête (coutures et intérieur des tuiles).
    for (let pass = 0, changed = true; changed && pass < limit; pass++) {
        changed = false;
        for (const [a, i, b, j] of glue) {
            if (c[a][i] === c[b][j]) continue;
            if (pin[a][i] && pin[b][j]) continue;
            const m = pin[a][i] ? c[a][i] : pin[b][j] ? c[b][j] : Math.min(c[a][i], c[b][j]);
            c[a][i] = c[b][j] = m;
            changed = true;
        }
        for (let n = 0; n < N; n++)
            for (let i = 0; i < 4; i++) {
                const j = (i + 1) & 3;
                for (const [hi, lo] of [
                    [i, j],
                    [j, i],
                ]) {
                    if (c[n][hi] <= c[n][lo] + 1) continue;
                    if (!pin[n][hi]) c[n][hi] = c[n][lo] + 1;
                    else if (!pin[n][lo]) c[n][lo] = c[n][hi] - 1;
                    else continue;
                    changed = true;
                }
            }
    }
    const done = new Set<number>();
    for (let n = 0; n < N; n++) {
        const corners = c[n].map((v) => Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(v))));
        const tile = tileFromCorners(corners);
        if (!tile) {
            plan.relief.invalid++;
            continue;
        }
        done.add(n);
        c[n] = corners;
        for (let i = 0; i < 4; i++) plan.relief.maxRise = Math.max(plan.relief.maxRise, corners[i] - ex[n][i]);
        const t = tgt.get(shapeable[n])!;
        const cur = tileFromCorners(ex[n]);
        if (cur && cur.level === tile.level && cur.slope === tile.slope) continue;
        plan.terrain.push({ x: t.x, y: t.y, level: tile.level, slope: tile.slope });
        plan.terrainBefore.push({ x: t.x, y: t.y, level: t.baseHeight / 2, slope: t.slope });
        t.baseHeight = tile.level * 2;
        t.slope = tile.slope;
    }
    plan.relief.tiles = plan.terrain.length;
    // Falaises : bords de tuile partagés dont les coins ne se rejoignent pas.
    for (const n of done) {
        const t = tgt.get(shapeable[n])!;
        for (const [dx, dy, pairs] of [
            [1, 0, [[1, 0], [2, 3]]],
            [0, 1, [[3, 0], [2, 1]]],
        ] as [number, number, [number, number][]][]) {
            const m = index.get(key(t.x + dx, t.y + dy));
            if (m === undefined || !done.has(m)) continue;
            if (pairs.some(([i, j]) => c[n][i] !== c[m][j])) plan.relief.cliffs++;
        }
    }
}

interface Stamp {
    s: Prepared;
    p: [number, number];
    u: TileXY;
    k: number;
    /** Sol d'origine (coin le plus bas, en niveaux) de la tuile d'ancrage : référence de l'eau recopiée. */
    ground: number;
    /** Bloc rigide (construction, ou bloc explicite) : niveau où tombe le point le plus bas du style (vmin). */
    level?: number;
    rigid: boolean;
}

/** Zigzag de bord à bord le long du grand axe des tuiles cibles, prolongé d'une tuile au-delà. */
export function zigzagPath(tiles: TileXY[], bends: number, rnd: () => number): TileXY[] {
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const alongX = x2 - x1 >= y2 - y1;
    const [a1, a2, c1, c2] = alongX ? [x1, x2, y1, y2] : [y1, y2, x1, x2];
    const mid = (c1 + c2) / 2;
    const amp = Math.max(1, (c2 - c1) * 0.3);
    const n = Math.max(0, Math.round(bends));
    const sign = rnd() < 0.5 ? 1 : -1;
    const out: TileXY[] = [];
    for (let i = 0; i <= n + 1; i++) {
        const a = a1 - 1 + ((a2 - a1 + 2) * i) / (n + 1);
        // Extrémités au milieu ; virages alternés, amplitude et position un peu variées.
        const c = i === 0 || i === n + 1 ? mid : mid + sign * (i % 2 ? 1 : -1) * amp * (0.7 + 0.3 * rnd());
        const jitter = i === 0 || i === n + 1 ? 0 : ((rnd() - 0.5) * (a2 - a1)) / (n + 1) / 3;
        const p = { a: Math.round(a + jitter), c: Math.round(c) };
        out.push(alongX ? { x: p.a, y: p.c } : { x: p.c, y: p.a });
    }
    return out;
}

/**
 * Tuiles d'une ligne brisée de largeur `width`. Largeur impaire : ligne par les centres des tuiles ; paire : par
 * les coins. Seuil width / 2 + 0,25 : une diagonale reste reliée par les bords (l'eau ne passe pas par un coin).
 */
export function rasterizePath(path: TileXY[], width: number): TileXY[] {
    const shift = width % 2 ? 0.5 : 0;
    const r = width / 2 + 0.25;
    const out = new Map<string, TileXY>();
    const pts = path.map((p) => ({ x: p.x + shift, y: p.y + shift }));
    if (pts.length === 1) pts.push(pts[0]);
    for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        for (let y = Math.floor(Math.min(a.y, b.y) - r - 1); y <= Math.ceil(Math.max(a.y, b.y) + r + 1); y++)
            for (let x = Math.floor(Math.min(a.x, b.x) - r - 1); x <= Math.ceil(Math.max(a.x, b.x) + r + 1); x++) {
                const cx = x + 0.5;
                const cy = y + 0.5;
                const t = len2 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / len2)) : 0;
                if (Math.hypot(cx - a.x - t * dx, cy - a.y - t * dy) <= r) out.set(key(x, y), { x, y });
            }
    }
    return [...out.values()];
}

/** Coins (S, E, N, W) d'une tuile cible sur son bord vers le voisin (dx, dy), et ceux du voisin sur ce bord. */
const EDGES: { dx: number; dy: number; own: [number, number]; other: [number, number] }[] = [
    { dx: 1, dy: 0, own: [1, 2], other: [0, 3] },
    { dx: -1, dy: 0, own: [0, 3], other: [1, 2] },
    { dx: 0, dy: 1, own: [2, 3], other: [1, 0] },
    { dx: 0, dy: -1, own: [0, 1], other: [3, 2] },
];

/**
 * Tuiles d'eau confinées : sous l'eau (un coin au moins sous la surface), et chaque bord tient l'eau (voisin en eau
 * au même niveau ou plus, ou bord du voisin au niveau de l'eau ou plus). Hors de la région, le voisin est supposé
 * au niveau d'origine du bord de la tuile (`ground`, avant rivière et relief). Renvoie les tuiles gardées et le
 * nombre de tuiles retirées.
 */
function containWater(
    want: Map<string, number>,
    tgt: Map<string, FillTargetTile>,
    ground: Map<string, [number, number, number, number]>,
): { kept: Map<string, number>; leaked: number } {
    const corners = (t: FillTargetTile) => cornerLevels({ h: t.baseHeight / 2, s: t.slope });
    const kept = new Map(want);
    for (const [tk, level] of want) {
        const t = tgt.get(tk)!;
        if (Math.min(...corners(t)) >= level) kept.delete(tk);
    }
    for (let changed = true; changed; ) {
        changed = false;
        for (const [tk, level] of kept) {
            const t = tgt.get(tk)!;
            const own = ground.get(tk)!;
            const leaks = EDGES.some((e) => {
                const nk = key(t.x + e.dx, t.y + e.dy);
                const w = kept.get(nk);
                if (w !== undefined && w >= level) return false;
                const n = tgt.get(nk);
                if (n && n.water > n.baseHeight && n.water / 2 >= level && !want.has(nk)) return false;
                const edge = n ? e.other.map((i) => corners(n)[i]) : e.own.map((i) => own[i]);
                return Math.min(...edge) < level;
            });
            if (leaks) {
                kept.delete(tk);
                changed = true;
            }
        }
    }
    return { kept, leaked: want.size - kept.size };
}

/**
 * Trace la rivière sur les tuiles libres : lit à plat, eau au ras du sol le plus bas du tracé. Met à jour `tgt`
 * (les tuiles deviennent de l'eau pour le tamponnage et le relief) ; renvoie les tuiles et leur niveau d'eau.
 */
function carveRiver(plan: FillPlan, tgt: Map<string, FillTargetTile>, free: Set<string>, river: FillRiver, rnd: () => number): Map<string, number> {
    const out = new Map<string, number>();
    const all = [...tgt.values()];
    if (all.length === 0) return out;
    const path = river.path?.length ? river.path : zigzagPath(all, river.bends, rnd);
    const tiles = rasterizePath(path, Math.max(1, Math.round(river.width)))
        .map((t) => key(t.x, t.y))
        .filter((tk) => free.has(tk) && !(tgt.get(tk)!.water > tgt.get(tk)!.baseHeight));
    if (tiles.length === 0) return out;
    const level = Math.min(...tiles.map((tk) => Math.min(...cornerLevels({ h: tgt.get(tk)!.baseHeight / 2, s: tgt.get(tk)!.slope }))));
    const bed = Math.max(MIN_LEVEL, level - Math.max(1, Math.round(river.depth)));
    for (const tk of tiles) {
        const t = tgt.get(tk)!;
        plan.terrain.push({ x: t.x, y: t.y, level: bed, slope: 0 });
        plan.terrainBefore.push({ x: t.x, y: t.y, level: t.baseHeight / 2, slope: t.slope });
        t.baseHeight = bed * 2;
        t.slope = 0;
        t.water = level * 2;
        out.set(tk, level);
    }
    plan.waterInfo.river = { tiles: tiles.length, level, bed, path };
    return out;
}

const clampBH = (v: number) => Math.max(2, Math.min(254, Math.round(v)));

export function planMagicFill(target: FillTargetTile[], sources: FillSource[], opts: FillOptions): FillPlan {
    const notPlaced: Record<string, number> = {};
    const styles = sources.map((s) => prepare(s, notPlaced)).filter((s) => s.weight > 0 && s.tiles.length > 0);
    const plan: FillPlan = {
        small: [],
        large: [],
        walls: [],
        clear: [],
        stamps: {},
        tiles: { target: target.length, filled: 0, empty: 0, skippedBlocked: 0, skippedOccupied: 0, waterMismatch: 0 },
        terrain: [],
        terrainBefore: [],
        relief: { tiles: 0, maxRise: 0, cliffs: 0, invalid: 0 },
        structures: { stamps: 0, misses: 0, blocks: [], unlevelled: 0 },
        textures: [],
        texturesBefore: [],
        water: [],
        waterInfo: { fromStyles: 0, leaked: 0, river: null },
        notPlaced,
        objects: [],
    };
    const blocks = opts.blocks ?? [];
    if (styles.length === 0 && blocks.length === 0) return plan;
    const rnd = mulberry32(opts.seed);
    const tgt = new Map<string, FillTargetTile>();
    const free = new Set<string>();
    for (const t of target) {
        const k = key(t.x, t.y);
        tgt.set(k, t);
        if (t.blocked && opts.avoidPaths) {
            plan.tiles.skippedBlocked++;
            continue;
        }
        if (t.occupied && opts.occupied === "skip") {
            plan.tiles.skippedOccupied++;
            continue;
        }
        free.add(k);
        if (t.occupied && opts.occupied === "replace") plan.clear.push({ x: t.x, y: t.y });
    }
    const isWater = (t: FillTargetTile) => t.water > t.baseHeight;
    const ground = new Map([...tgt].map(([tk, t]) => [tk, cornerLevels({ h: t.baseHeight / 2, s: t.slope })]));
    // Eau du style sur une tuile sèche : permise si elle y sera remise en eau (water: copy, sans rivière).
    const copyWater = opts.water === "copy" && !opts.river;
    const fits = (styleWater: boolean, t: FillTargetTile) => !opts.matchWater || styleWater === isWater(t) || (copyWater && styleWater);
    // Tuile cible → (style, tuile du style, rotation, tampon).
    const assigned = new Map<string, { s: Prepared; q: [number, number]; k: number; stamp: number }>();
    const stamps: Stamp[] = [];
    let river = new Map<string, number>();
    const mapTile = (p: [number, number], u: TileXY, k: number, q: [number, number]): TileXY => {
        const o = rotateOffset({ x: q[0] - p[0], y: q[1] - p[1] }, k);
        return { x: u.x + o.x, y: u.y + o.y };
    };
    /** Pourquoi une tuile du style ne peut pas recevoir un tampon entier (null : elle peut). */
    const unfit = (s: Prepared, q: [number, number], tk: string): string | null => {
        const t = tgt.get(tk);
        if (!t) return "hors de la région";
        if (assigned.has(tk)) return "déjà prise par un autre bloc";
        if (river.has(tk)) return "rivière";
        if (t.blocked) return "chemin, piste ou entrée";
        // add : posé par-dessus (raccord d'une construction déjà posée) ; le sol n'y est pas nivelé (copyRelief).
        if (t.occupied && opts.occupied === "skip") return "scénerie déjà là (occupied: 'add' pour poser par-dessus, 'replace' pour la remplacer)";
        if (!free.has(tk)) return "tuile écartée";
        const styleWater = s.water.get(key(q[0], q[1])) ?? false;
        if (!fits(styleWater, t) || (!styleWater && isWater(t))) return "eau";
        return null;
    };
    /** Toutes les tuiles du style tombent sur des tuiles libres, d'accord pour l'eau, et remodelables (voir copyRelief). */
    const wholeFits = (s: Prepared, p: [number, number], k: number, u: TileXY): boolean =>
        s.tiles.every((q) => {
            const m = mapTile(p, u, k, q);
            return unfit(s, q, key(m.x, m.y)) === null;
        });
    const claim = (s: Prepared, p: [number, number], u: TileXY, k: number, rigid: boolean, level?: number): number => {
        const stamp = stamps.length;
        stamps.push({ s, p, u, k, ground: Math.min(...cornerLevels({ h: (tgt.get(key(u.x, u.y))?.baseHeight ?? 2) / 2, s: tgt.get(key(u.x, u.y))?.slope ?? 0 })), rigid, level });
        for (const q of s.tiles) {
            const t = mapTile(p, u, k, q);
            const tk = key(t.x, t.y);
            if (!free.has(tk) || assigned.has(tk)) continue;
            if (!fits(s.water.get(key(q[0], q[1])) ?? false, tgt.get(tk)!)) continue;
            assigned.set(tk, { s, q, k, stamp });
        }
        return stamp;
    };

    // Blocs explicites d'abord : ils ont la place qu'on leur donne, ou sont refusés avec la raison.
    const preparedById = new Map(styles.map((s) => [s.id, s]));
    const blockStamp = new Map<FillBlockResult, number>();
    blocks.forEach((b, index) => {
        let full = preparedById.get(b.record.id);
        if (!full) {
            full = prepare({ record: b.record, weight: 0 }, notPlaced);
            preparedById.set(full.id, full);
        }
        const s = cropPrepared(full, b.crop);
        const k = ((b.rotation % 4) + 4) % 4;
        const res: FillBlockResult = { index, style: full.id, placed: false, tiles: s.tiles.length };
        plan.structures.blocks.push(res);
        if (s.tiles.length === 0) {
            res.reason = "découpe vide (crop hors du style)";
            return;
        }
        // Emprise tournée ; son coin (x, y minimaux) tombe sur (b.x, b.y) : u = où tombe la tuile (0, 0) du style.
        const foot = blockFootprint({ ...b, record: full.record }).map((f) => f.at);
        const r0 = rotateOffset({ x: s.tiles[0][0], y: s.tiles[0][1] }, k);
        const u = { x: foot[0].x - r0.x, y: foot[0].y - r0.y };
        for (const [n, q] of s.tiles.entries()) {
            const why = unfit(s, q, key(foot[n].x, foot[n].y));
            if (why) {
                res.reason = `tuile (${foot[n].x}, ${foot[n].y}) : ${why}`;
                return;
            }
        }
        blockStamp.set(res, claim(s, [0, 0], u, k, true, b.level));
        res.placed = true;
        res.bbox = { x1: Math.min(...foot.map((t) => t.x)), y1: Math.min(...foot.map((t) => t.y)), x2: Math.max(...foot.map((t) => t.x)), y2: Math.max(...foot.map((t) => t.y)) };
        plan.stamps[full.id] = (plan.stamps[full.id] ?? 0) + 1;
    });

    if (opts.river) river = carveRiver(plan, tgt, new Set([...free].filter((tk) => !assigned.has(tk))), opts.river, rnd);
    const order = [...free];
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    // Sans style à tirer (blocs seuls), le reste de la région ne change pas.
    for (const uk of styles.length ? order : []) {
        if (assigned.has(uk) || !free.has(uk)) continue;
        const u = tgt.get(uk)!;
        // Parmi quelques tirages valides, celui qui couvre le plus de tuiles libres (patch le moins coupé).
        let chosen: { s: Prepared; p: [number, number]; k: number } | null = null;
        let best = -1;
        let pool = styles;
        let waterRejected = false;
        for (let attempt = 0, valid = 0; attempt < 12 && valid < 6; attempt++) {
            const s = pickWeighted(pool, rnd);
            const p = s.tiles[Math.floor(rnd() * s.tiles.length)];
            if (!fits(s.water.get(key(p[0], p[1])) ?? false, u)) {
                waterRejected = true;
                continue;
            }
            const k = opts.rotate ? Math.floor(rnd() * 4) : 0;
            // Construction : entière, sinon tirage écarté ; si seules des constructions sortent, on retire parmi les autres styles.
            if (s.atomic) {
                if (!wholeFits(s, p, k, u)) {
                    plan.structures.misses++;
                    if (attempt >= 5 && !chosen) {
                        const rest = styles.filter((x) => !x.atomic);
                        if (rest.length && pool !== rest) pool = rest;
                    }
                    continue;
                }
                // Entier : tirage parfait (la couverture favoriserait sinon toujours les grands patchs de forêt).
                chosen = { s, p, k };
                break;
            }
            valid++;
            let cover = 0;
            for (const q of s.tiles) {
                const m = mapTile(p, u, k, q);
                const tk = key(m.x, m.y);
                if (free.has(tk) && !assigned.has(tk)) cover++;
            }
            if (cover > best) {
                best = cover;
                chosen = { s, p, k };
            }
        }
        if (!chosen) {
            // Sinon : seules des constructions sans place entière ont été tirées ; la tuile reste vide (tiles.empty).
            if (waterRejected) plan.tiles.waterMismatch++;
            free.delete(uk);
            continue;
        }
        claim(chosen.s, chosen.p, u, chosen.k, chosen.s.atomic);
        plan.stamps[chosen.s.id] = (plan.stamps[chosen.s.id] ?? 0) + 1;
        if (chosen.s.atomic) plan.structures.stamps++;
    }
    // Blocs rigides sans niveau donné : moyenne des coins du terrain sous l'emprise (avant tout remodelage, rivière
    // comprise : un bloc n'est jamais posé sur la rivière). Leur sol d'eau recopiée part de ce niveau.
    const footprint = new Map<number, string[]>();
    for (const [tk, a] of assigned) {
        if (!stamps[a.stamp].rigid) continue;
        const list = footprint.get(a.stamp) ?? [];
        list.push(tk);
        footprint.set(a.stamp, list);
    }
    for (const [index, tks] of footprint) {
        const st = stamps[index];
        if (st.level === undefined) {
            const corners = tks.flatMap((tk) => cornerLevels({ h: tgt.get(tk)!.baseHeight / 2, s: tgt.get(tk)!.slope }));
            st.level = Math.round(corners.reduce((n, v) => n + v, 0) / corners.length);
        }
        const top = Math.max(...st.s.tiles.map((q) => Math.max(...(st.s.corners.get(key(q[0], q[1])) ?? [st.s.vmin])))) - st.s.vmin;
        st.level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL - top, st.level));
        st.ground = st.level;
        if (opts.relief !== "copy") plan.structures.unlevelled++;
    }
    for (const [res, index] of blockStamp) res.level = stamps[index].level;
    if (opts.relief === "copy") copyRelief(plan, tgt, assigned, stamps, opts);
    // Eau : rivière, puis eau des styles tombée sur des tuiles sèches ; confinée sur le terrain remodelé.
    const want = new Map(river);
    if (copyWater) {
        const scale = opts.reliefScale ?? 1;
        for (const [tk, a] of assigned) {
            const t = tgt.get(tk)!;
            const qs = a.s.surface.get(key(a.q[0], a.q[1]));
            if (!qs || qs.water <= qs.baseHeight || isWater(t)) continue;
            const level = stamps[a.stamp].ground + Math.round((qs.water / 2 - a.s.vmin) * (stamps[a.stamp].rigid ? 1 : scale));
            want.set(tk, Math.max(MIN_LEVEL + 1, Math.min(MAX_LEVEL, level)));
        }
    }
    if (want.size) {
        const { kept, leaked } = containWater(want, tgt, ground);
        plan.waterInfo.leaked = leaked;
        for (const [tk, level] of kept) {
            const t = tgt.get(tk)!;
            plan.water.push({ x: t.x, y: t.y, level });
            t.water = level * 2;
            if (!river.has(tk)) plan.waterInfo.fromStyles++;
        }
        // Rivière retirée par confinement : lit rebouché (sol d'origine), la tuile n'est plus de l'eau pour la scénerie.
        const refill = new Set([...river.keys()].filter((tk) => !kept.has(tk)));
        if (refill.size) {
            const back = new Map(plan.terrainBefore.map((b) => [key(b.x, b.y), b]));
            const keepCarve = (i: { x: number; y: number }) => !refill.has(key(i.x, i.y));
            plan.terrain = plan.terrain.filter(keepCarve);
            plan.terrainBefore = plan.terrainBefore.filter(keepCarve);
            for (const tk of refill) {
                const t = tgt.get(tk)!;
                const b = back.get(tk)!;
                Object.assign(t, { baseHeight: b.level * 2, slope: b.slope, water: 0 });
            }
        }
        if (plan.waterInfo.river) plan.waterInfo.river.tiles = [...river.keys()].filter((tk) => kept.has(tk)).length;
    }
    const include = new Set(opts.include);
    const objects = new Set<string>();
    for (const [tk, a] of assigned) {
        const t = tgt.get(tk)!;
        const qs = a.s.surface.get(key(a.q[0], a.q[1]));
        const elements = a.s.byTile.get(key(a.q[0], a.q[1])) ?? [];
        let placedHere = 0;
        for (const e of elements) {
            if (!e.object || !include.has(e.t as FillType)) continue;
            const st = stamps[a.stamp];
            const colours = (e.colours ?? [0, 0, 0]) as [number, number, number];
            if (st.rigid) {
                // Bloc rigide : jamais éclairci (une pièce retirée laisserait flotter celles du dessus), hauteur explicite
                // depuis la base du bloc, la même pour toutes ses tuiles.
                const baseHeight = clampBH(st.level! * 2 + (e.baseHeight - st.s.vmin * 2));
                if (e.t === "small_scenery")
                    plan.small.push({ object: e.object, x: t.x, y: t.y, baseHeight, quadrant: ((e.quadrant ?? 0) + a.k) & 3, direction: ((e.direction ?? 0) + a.k) & 3, colours, style: a.s.id });
                else plan.walls.push({ object: e.object, x: t.x, y: t.y, baseHeight, edge: ((e.direction ?? 0) + a.k) & 3, colours, style: a.s.id });
                objects.add(e.object);
                placedHere++;
                continue;
            }
            if (rnd() >= opts.density) continue;
            const onWater = !!qs && qs.water > qs.baseHeight && e.baseHeight >= qs.water;
            const ref = qs ? (onWater ? qs.water : qs.baseHeight) : e.baseHeight - e.dz;
            const tgtRef = onWater && isWater(t) ? t.water : t.baseHeight;
            const rel = e.baseHeight - ref;
            // Posé au sol dans le style (hauteur automatique, pente comprise) : idem ici.
            const ground = rel === 0 || (!!qs && (qs.slope & 0x1f) !== 0 && rel > 0 && rel <= 2);
            // Sous l'eau dans le style, sur une tuile d'eau ici : la hauteur automatique du jeu poserait l'objet sur
            // l'eau (SmallSceneryPlaceAction) ; hauteur explicite depuis le lit, sommet gardé sous la surface.
            const submerged = !onWater && !!qs && qs.water > qs.baseHeight && isWater(t);
            let baseHeight = ground && !submerged ? null : clampBH(tgtRef + (ground ? 0 : rel));
            if (submerged) baseHeight = clampBH(Math.max(t.baseHeight + Math.min(0, rel), Math.min(baseHeight!, t.water - (e.clearanceHeight - e.baseHeight))));
            if (e.t === "small_scenery") {
                plan.small.push({ object: e.object, x: t.x, y: t.y, baseHeight, quadrant: ((e.quadrant ?? 0) + a.k) & 3, direction: ((e.direction ?? 0) + a.k) & 3, colours, style: a.s.id });
            } else {
                plan.walls.push({ object: e.object, x: t.x, y: t.y, baseHeight, edge: ((e.direction ?? 0) + a.k) & 3, colours, style: a.s.id });
            }
            objects.add(e.object);
            placedHere++;
        }
        if (placedHere) plan.tiles.filled++;
        else plan.tiles.empty++;
        if (opts.texture === "copy" && qs) {
            const surface = qs.surface && qs.surface !== t.surface ? qs.surface : null;
            const edge = qs.edge && qs.edge !== t.edge ? qs.edge : null;
            if (surface || edge) {
                plan.textures.push({ x: t.x, y: t.y, surface, edge });
                plan.texturesBefore.push({ x: t.x, y: t.y, surface: surface ? (t.surface ?? null) : null, edge: edge ? (t.edge ?? null) : null });
            }
        }
    }
    // Grandes scénerie : posées si toute leur emprise tombe sur des tuiles du même tampon.
    if (include.has("large_scenery")) {
        stamps.forEach((st, index) => {
            for (const g of st.s.large) {
                const tiles = g.footprint.map(([fx, fy]) => mapTile(st.p, st.u, st.k, [g.origin.dx + fx, g.origin.dy + fy]));
                const ok = tiles.length > 0 && tiles.every((t) => assigned.get(key(t.x, t.y))?.stamp === index);
                if (!ok) {
                    // Hors de ce tampon : comptée une fois par tampon dont l'origine tombe dans la région.
                    continue;
                }
                const origin = mapTile(st.p, st.u, st.k, [g.origin.dx, g.origin.dy]);
                if (st.rigid) {
                    plan.large.push({ object: g.object, x: origin.x, y: origin.y, baseHeight: clampBH(st.level! * 2 + (g.origin.baseHeight - st.s.vmin * 2)), direction: (g.direction + st.k) & 3, colours: g.colours, style: st.s.id });
                    objects.add(g.object);
                    continue;
                }
                if (rnd() >= opts.density) continue;
                const styleRef = Math.max(
                    ...g.footprint.map(([fx, fy]) => st.s.surface.get(key(g.origin.dx + fx, g.origin.dy + fy))?.baseHeight ?? -Infinity),
                );
                const tgtRef = Math.max(...tiles.map((t) => tgt.get(key(t.x, t.y))!.baseHeight));
                const rel = isFinite(styleRef) ? g.origin.baseHeight - styleRef : 0;
                plan.large.push({ object: g.object, x: origin.x, y: origin.y, baseHeight: clampBH(tgtRef + rel), direction: (g.direction + st.k) & 3, colours: g.colours, style: st.s.id });
                objects.add(g.object);
            }
        });
    }
    for (const x of plan.textures) {
        if (x.surface) objects.add(x.surface);
        if (x.edge) objects.add(x.edge);
    }
    plan.objects = [...objects];
    return plan;
}
