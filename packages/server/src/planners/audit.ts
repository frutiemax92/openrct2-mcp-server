// Audit paysager et fonctionnel (SPEC 9.5 landscape_audit, 10.5, critère « Vision » de 1.3) : détecte les défauts
// qu'un humain verrait sur la carte, chacun avec des tuiles d'exemple et une correction suggérée.

import { DIRECTION_DELTA, type RegionTile, type RideSummary, type TileRect, type TileXY } from "@openrct2-claude/protocol";
import { analyzeConnectivity } from "./connectivity.js";
import { distanceField } from "./scatter.js";

export type Severity = "high" | "medium" | "low";

export interface AuditIssue {
    type: string;
    severity: Severity;
    count: number;
    message: string;
    tiles?: TileXY[];
    rects?: TileRect[];
    hint: string;
}

export interface AuditInput {
    rect: TileRect;
    get: (x: number, y: number) => RegionTile | undefined;
    rides: RideSummary[];
    /** Rôle de l'addition de chemin d'index donné (bench, bin, lamp_post…). */
    additionRole: (index: number) => string | null;
    checks?: string[];
}

export interface AuditReport {
    issues: AuditIssue[];
    stats: { pathTiles: number; sceneryTiles: number; ownedTiles: number; emptyOwnedTiles: number };
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
export const AUDIT_CHECKS = ["connectivity", "rides", "empty", "furniture", "shade", "regularity"] as const;

const sample = (tiles: TileXY[], n = 8) => tiles.slice(0, n);
const rectStr = (r: TileRect) => `x1: ${r.x1}, y1: ${r.y1}, x2: ${r.x2}, y2: ${r.y2}`;

/** Grands carrés vides (terrain possédé sans rien dessus), par ordre de taille décroissante, sans chevauchement. */
export function emptyAreas(rect: TileRect, isEmpty: (x: number, y: number) => boolean, minSide: number, max = 6): TileRect[] {
    const w = rect.x2 - rect.x1 + 1;
    const h = rect.y2 - rect.y1 + 1;
    const used = new Uint8Array(w * h);
    const out: TileRect[] = [];
    for (let round = 0; round < max; round++) {
        // Plus grand carré vide (programmation dynamique), en ignorant les tuiles déjà couvertes.
        const dp = new Uint16Array(w * h);
        let best = 0;
        let bestAt = -1;
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (used[i] || !isEmpty(rect.x1 + x, rect.y1 + y)) continue;
                dp[i] = x && y ? 1 + Math.min(dp[i - 1], dp[i - w], dp[i - w - 1]) : 1;
                if (dp[i] > best) {
                    best = dp[i];
                    bestAt = i;
                }
            }
        if (best < minSide) break;
        const bx = bestAt % w;
        const by = (bestAt / w) | 0;
        // Étend le carré en rectangle tant que les lignes et colonnes voisines restent vides.
        let r = { x1: bx - best + 1, y1: by - best + 1, x2: bx, y2: by };
        const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !used[y * w + x] && isEmpty(rect.x1 + x, rect.y1 + y);
        const colFree = (x: number) => Array.from({ length: r.y2 - r.y1 + 1 }, (_, k) => r.y1 + k).every((y) => free(x, y));
        const rowFree = (y: number) => Array.from({ length: r.x2 - r.x1 + 1 }, (_, k) => r.x1 + k).every((x) => free(x, y));
        for (let grew = true; grew; ) {
            grew = false;
            if (colFree(r.x2 + 1)) (r = { ...r, x2: r.x2 + 1 }), (grew = true);
            if (rowFree(r.y2 + 1)) (r = { ...r, y2: r.y2 + 1 }), (grew = true);
            if (colFree(r.x1 - 1)) (r = { ...r, x1: r.x1 - 1 }), (grew = true);
            if (rowFree(r.y1 - 1)) (r = { ...r, y1: r.y1 - 1 }), (grew = true);
        }
        for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) used[y * w + x] = 1;
        out.push({ x1: rect.x1 + r.x1, y1: rect.y1 + r.y1, x2: rect.x1 + r.x2, y2: rect.y1 + r.y2 });
    }
    return out;
}

/**
 * Une impasse dont le couloir (tuiles à exactement deux raccords) aboutit à une entrée du parc : c'est l'allée
 * extérieure vers le point d'apparition, pas un défaut.
 */
export function leadsToParkEntrance(start: TileXY, get: (x: number, y: number) => RegionTile | undefined, maxSteps = 64): boolean {
    let cur = start;
    let from: TileXY | null = null;
    for (let step = 0; step < maxSteps; step++) {
        const p = get(cur.x, cur.y)?.p?.[0];
        if (!p) return false;
        const next: TileXY[] = [];
        for (let d = 0; d < 4; d++) {
            if (!(p.e & (1 << d))) continue;
            const n = { x: cur.x + DIRECTION_DELTA[d].x, y: cur.y + DIRECTION_DELTA[d].y };
            if (get(n.x, n.y)?.e?.some((e) => e.k === 2)) return true;
            if (!from || n.x !== from.x || n.y !== from.y) next.push(n);
        }
        if (next.length !== 1) return false;
        from = cur;
        cur = next[0];
    }
    return false;
}

export function auditLandscape(input: AuditInput): AuditReport {
    const { rect, get, rides } = input;
    const on = (c: string) => !input.checks || input.checks.includes(c);
    const issues: AuditIssue[] = [];
    const pathTiles: TileXY[] = [];
    let sceneryTiles = 0;
    let ownedTiles = 0;
    const isEmpty = (x: number, y: number) => {
        const t = get(x, y);
        return !!t && !!(t.o & 1) && t.w <= t.h && !t.p?.length && !t.r?.length && !t.e?.length && !t.sc && !t.lg && !t.wl;
    };
    let emptyOwned = 0;
    for (let y = rect.y1; y <= rect.y2; y++)
        for (let x = rect.x1; x <= rect.x2; x++) {
            const t = get(x, y);
            if (!t) continue;
            if (t.o & 1) ownedTiles++;
            if (t.p?.some((p) => !p.q)) pathTiles.push({ x, y });
            if (t.sc || t.lg) sceneryTiles++;
            if (isEmpty(x, y)) emptyOwned++;
        }

    // 1. Réseau de chemins et raccordement des attractions.
    const conn = analyzeConnectivity(rect, get, rides);
    if (on("connectivity")) {
        const badRides = conn.rides.filter((r) => r.problems.length);
        if (badRides.length) {
            issues.push({
                type: "ride_unconnected",
                severity: "high",
                count: badRides.length,
                message: badRides
                    .slice(0, 4)
                    .map((r) => `${r.name} (#${r.id}) : ${r.problems.join(", ")}`)
                    .join(" ; "),
                tiles: sample(badRides.flatMap((r) => rides.find((x) => x.id === r.id)?.stations[0]?.entrance ?? rides.find((x) => x.id === r.id)?.stations[0]?.start ?? [])),
                hint: "Raccorde avec path_build depuis la tuile devant l'entrée/la sortie (ou la face avant d'une boutique) jusqu'au réseau.",
            });
        }
        if (conn.parkEntrances.length && conn.disconnected.length) {
            issues.push({
                type: "path_disconnected",
                severity: "high",
                count: conn.disconnected.length,
                message: `${conn.disconnected.length} tuile(s) de chemin hors du réseau relié à l'entrée du parc.`,
                tiles: sample(conn.disconnected),
                hint: "Relie ces tronçons au réseau principal avec path_build, ou retire-les (path_remove).",
            });
        }
        // L'allée qui mène de l'entrée du parc au point d'apparition des visiteurs se termine normalement en impasse.
        const deadEnds = conn.deadEnds.filter((t) => (get(t.x, t.y)?.o ?? 0) & 1 && !leadsToParkEntrance(t, get));
        if (deadEnds.length) {
            issues.push({
                type: "path_dead_end",
                severity: "medium",
                count: deadEnds.length,
                message: `${deadEnds.length} impasse(s) : les visiteurs font demi-tour, la circulation se dégrade.`,
                tiles: sample(deadEnds),
                hint: "Prolonge l'impasse jusqu'à un autre chemin (boucle) ou retire la tuile terminale avec path_remove.",
            });
        }
        if (conn.isolated.length) {
            issues.push({
                type: "path_isolated",
                severity: "medium",
                count: conn.isolated.length,
                message: `${conn.isolated.length} tuile(s) de chemin sans aucun raccord.`,
                tiles: sample(conn.isolated),
                hint: "path_remove sur ces tuiles, ou raccorde-les.",
            });
        }
    }

    // 2. Attractions fermées ou en panne.
    if (on("rides")) {
        const closed = rides.filter((r) => r.status !== "open");
        if (closed.length) {
            issues.push({
                type: "ride_not_open",
                severity: "medium",
                count: closed.length,
                message: closed
                    .slice(0, 6)
                    .map((r) => `${r.name} (#${r.id}) : ${r.status}`)
                    .join(", "),
                tiles: sample(closed.flatMap((r) => r.stations[0]?.start ?? [])),
                hint: "ride_set_status { status: 'open' } une fois l'attraction raccordée et testée.",
            });
        }
    }

    // 3. Zones vides (terrain possédé sans rien).
    if (on("empty")) {
        const areas = emptyAreas(rect, isEmpty, 6);
        if (areas.length) {
            const total = areas.reduce((n, r) => n + (r.x2 - r.x1 + 1) * (r.y2 - r.y1 + 1), 0);
            issues.push({
                type: "empty_area",
                severity: total > 400 ? "medium" : "low",
                count: areas.length,
                message: `${areas.length} grande(s) zone(s) vide(s), ${total} tuiles au total (la plus grande : ${rectStr(areas[0])}).`,
                rects: areas,
                hint: `Remplis avec scenery_scatter_zone { zoneType: 'meadow' ou 'forest_dense', ${rectStr(areas[0])} } ou réserve-la pour une attraction.`,
            });
        }
    }

    // 4. Mobilier de chemin : distance (Manhattan) au banc, à la poubelle, au lampadaire le plus proche.
    if (on("furniture") && pathTiles.length >= 10) {
        const kinds: { role: string; label: string; max: number }[] = [
            { role: "bin", label: "poubelle", max: 8 },
            { role: "bench", label: "banc", max: 10 },
            { role: "lamp_post", label: "lampadaire", max: 8 },
        ];
        for (const k of kinds) {
            const d = distanceField(rect, (x, y) => !!get(x, y)?.p?.some((p) => p.a >= 0 && input.additionRole(p.a) === k.role), 32);
            const far = pathTiles.filter((t) => d(t.x, t.y) > k.max);
            if (far.length / pathTiles.length > 0.2) {
                issues.push({
                    type: `missing_${k.role}`,
                    severity: k.role === "bin" ? "medium" : "low",
                    count: far.length,
                    message: `${far.length}/${pathTiles.length} tuiles de chemin à plus de ${k.max} tuiles d'un(e) ${k.label}.`,
                    tiles: sample(far),
                    hint: `path_add_furniture { kinds: ['${k.role === "lamp_post" ? "lamp" : k.role}'], <rectangle> }.`,
                });
            }
        }
    }

    // 5. Ombrage : chemins sans arbre ni scénerie à 3 tuiles.
    if (on("shade") && pathTiles.length >= 10) {
        const d = distanceField(rect, (x, y) => {
            const t = get(x, y);
            return !!(t?.sc || t?.lg);
        });
        const bare = pathTiles.filter((t) => d(t.x, t.y) > 3);
        if (bare.length / pathTiles.length > 0.4) {
            issues.push({
                type: "bare_paths",
                severity: "low",
                count: bare.length,
                message: `${bare.length}/${pathTiles.length} tuiles de chemin sans végétation ni décor à moins de 3 tuiles.`,
                tiles: sample(bare),
                hint: "scenery_scatter_zone { zoneType: 'path_border', <rectangle> } le long des allées.",
            });
        }
    }

    // 6. Répétition trop régulière : la scénerie tombe sur une seule classe (x mod k, y mod k).
    if (on("regularity")) {
        const items: TileXY[] = [];
        for (let y = rect.y1; y <= rect.y2; y++) for (let x = rect.x1; x <= rect.x2; x++) if (get(x, y)?.sc) items.push({ x, y });
        if (items.length >= 20) {
            for (const k of [2, 3, 4]) {
                const counts = new Map<string, number>();
                for (const t of items) {
                    const key = `${t.x % k},${t.y % k}`;
                    counts.set(key, (counts.get(key) ?? 0) + 1);
                }
                const top = Math.max(...counts.values());
                if (top / items.length >= 0.8) {
                    issues.push({
                        type: "regular_grid",
                        severity: "low",
                        count: top,
                        message: `${Math.round((100 * top) / items.length)} % de la scénerie suit une grille de pas ${k} : rendu artificiel.`,
                        tiles: sample(items),
                        hint: "Retire et régénère avec scenery_scatter_zone (placement Poisson-disc), ou varie les positions.",
                    });
                    break;
                }
            }
        }
    }

    issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
    return { issues, stats: { pathTiles: pathTiles.length, sceneryTiles, ownedTiles, emptyOwnedTiles: emptyOwned } };
}
