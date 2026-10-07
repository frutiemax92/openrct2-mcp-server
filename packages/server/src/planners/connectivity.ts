// Analyse du réseau de chemins (SPEC 9.3, path_check_connectivity) à partir des bords calculés par le jeu.
// Un bit de bord d'un chemin vers une tuile d'entrée/sortie ou de boutique indique un raccord effectif.

import { DIRECTION_DELTA, type RegionTile, type RideSummary, type TileRect } from "@openrct2-claude/protocol";

interface Node {
    id: number;
    x: number;
    y: number;
    level: number;
    edges: number;
    queue: boolean;
}

export interface ConnectivityReport {
    pathTiles: number;
    components: { id: number; size: number; touchesParkEntrance: boolean; sample: { x: number; y: number } }[];
    parkEntrances: { x: number; y: number; connected: boolean }[];
    deadEnds: { x: number; y: number }[];
    isolated: { x: number; y: number }[];
    /** Tuiles de chemin d'un réseau qui ne touche pas l'entrée du parc (vide s'il n'y a pas d'entrée dans la zone). */
    disconnected: { x: number; y: number }[];
    rides: {
        id: number;
        name: string;
        classification: string;
        entranceConnected: boolean | null;
        exitConnected: boolean | null;
        reachableFromParkEntrance: boolean;
        problems: string[];
    }[];
}

class UnionFind {
    parent: number[] = [];
    add(): number {
        this.parent.push(this.parent.length);
        return this.parent.length - 1;
    }
    find(a: number): number {
        while (this.parent[a] !== a) {
            this.parent[a] = this.parent[this.parent[a]];
            a = this.parent[a];
        }
        return a;
    }
    union(a: number, b: number): void {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb) this.parent[rb] = ra;
    }
}

const popcount = (n: number) => ((n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1));

export function analyzeConnectivity(rect: TileRect, get: (x: number, y: number) => RegionTile | undefined, rides: RideSummary[]): ConnectivityReport {
    const nodes: Node[] = [];
    const byTile = new Map<string, Node[]>();
    const uf = new UnionFind();
    for (let y = rect.y1; y <= rect.y2; y++) {
        for (let x = rect.x1; x <= rect.x2; x++) {
            const t = get(x, y);
            if (!t?.p) continue;
            for (const p of t.p) {
                const n: Node = { id: uf.add(), x, y, level: p.l, edges: p.e, queue: p.q === 1 };
                nodes.push(n);
                const k = `${x},${y}`;
                (byTile.get(k) ?? byTile.set(k, []).get(k)!).push(n);
            }
        }
    }

    // Arêtes chemin-chemin : bit de bord des deux côtés, niveaux compatibles (±1 pour les rampes).
    const parkEntranceNodes = new Set<number>();
    const byParkEntrance = new Map<string, number[]>(); // tuile centrale d'une entrée de parc → nœuds raccordés
    const touchesRideEntrance = new Map<number, number[]>(); // ride → nœuds
    const touchesRideExit = new Map<number, number[]>();
    const touchesRideTrack = new Map<number, number[]>();
    for (const n of nodes) {
        for (let d = 0; d < 4; d++) {
            if (!(n.edges & (1 << d))) continue;
            const nx = n.x + DIRECTION_DELTA[d].x;
            const ny = n.y + DIRECTION_DELTA[d].y;
            const back = (d + 2) & 3;
            for (const m of byTile.get(`${nx},${ny}`) ?? []) {
                if (m.edges & (1 << back) && Math.abs(m.level - n.level) <= 1) uf.union(n.id, m.id);
            }
            const t = get(nx, ny);
            if (!t) continue;
            for (const e of t.e ?? []) {
                if (e.k === 2) {
                    parkEntranceNodes.add(n.id);
                    if (e.seq === 0) {
                        const k = `${nx},${ny}`;
                        (byParkEntrance.get(k) ?? byParkEntrance.set(k, []).get(k)!).push(n.id);
                    }
                }
                else if (e.k === 0) (touchesRideEntrance.get(e.r) ?? touchesRideEntrance.set(e.r, []).get(e.r)!).push(n.id);
                else if (e.k === 1) (touchesRideExit.get(e.r) ?? touchesRideExit.set(e.r, []).get(e.r)!).push(n.id);
            }
            for (const r of t.r ?? []) (touchesRideTrack.get(r) ?? touchesRideTrack.set(r, []).get(r)!).push(n.id);
        }
    }

    // Les visiteurs traversent l'entrée du parc : l'allée extérieure (vers le point d'apparition) et l'allée
    // intérieure forment un seul réseau.
    for (const ids of byParkEntrance.values()) for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);

    const compSize = new Map<number, number>();
    const compSample = new Map<number, Node>();
    for (const n of nodes) {
        const r = uf.find(n.id);
        compSize.set(r, (compSize.get(r) ?? 0) + 1);
        if (!compSample.has(r)) compSample.set(r, n);
    }
    const entranceComps = new Set([...parkEntranceNodes].map((id) => uf.find(id)));
    const components = [...compSize.entries()]
        .map(([id, size]) => ({ id, size, touchesParkEntrance: entranceComps.has(id), sample: { x: compSample.get(id)!.x, y: compSample.get(id)!.y } }))
        .sort((a, b) => b.size - a.size);

    const parkEntrances: ConnectivityReport["parkEntrances"] = [];
    for (let y = rect.y1; y <= rect.y2; y++) {
        for (let x = rect.x1; x <= rect.x2; x++) {
            const t = get(x, y);
            for (const e of t?.e ?? []) {
                if (e.k === 2 && e.seq === 0) {
                    const connected = nodes.some(
                        (n) => parkEntranceNodes.has(n.id) && Math.abs(n.x - x) + Math.abs(n.y - y) <= 2,
                    );
                    parkEntrances.push({ x, y, connected });
                }
            }
        }
    }

    const deadEnds: { x: number; y: number }[] = [];
    const isolated: { x: number; y: number }[] = [];
    for (const n of nodes) {
        const c = popcount(n.edges);
        if (c === 0) isolated.push({ x: n.x, y: n.y });
        else if (c === 1 && !n.queue && !parkEntranceNodes.has(n.id)) deadEnds.push({ x: n.x, y: n.y });
    }

    const reach = (ids: number[] | undefined) => (ids ?? []).some((id) => entranceComps.has(uf.find(id)));
    const ridesReport = rides.map((r) => {
        const problems: string[] = [];
        const st = r.stations[0];
        let entranceConnected: boolean | null = null;
        let exitConnected: boolean | null = null;
        let reachable = false;
        if (r.classification === "ride") {
            if (!st?.entrance) problems.push("pas d'entrée");
            else {
                entranceConnected = (touchesRideEntrance.get(r.id)?.length ?? 0) > 0;
                if (!entranceConnected) problems.push(`entrée (${st.entrance.x},${st.entrance.y}) non raccordée à un chemin`);
            }
            if (!st?.exit) problems.push("pas de sortie");
            else {
                exitConnected = (touchesRideExit.get(r.id)?.length ?? 0) > 0;
                if (!exitConnected) problems.push(`sortie (${st.exit.x},${st.exit.y}) non raccordée à un chemin`);
            }
            reachable = reach(touchesRideEntrance.get(r.id));
        } else {
            entranceConnected = (touchesRideTrack.get(r.id)?.length ?? 0) > 0;
            if (!entranceConnected) problems.push("boutique/équipement non raccordé : un chemin doit toucher sa face avant");
            reachable = reach(touchesRideTrack.get(r.id));
        }
        if (entranceComps.size > 0 && !reachable && problems.length === 0) problems.push("non atteignable depuis l'entrée du parc");
        return {
            id: r.id,
            name: r.name,
            classification: r.classification,
            entranceConnected,
            exitConnected,
            reachableFromParkEntrance: reachable,
            problems,
        };
    });

    const disconnected = entranceComps.size > 0 ? nodes.filter((n) => !entranceComps.has(uf.find(n.id))).map((n) => ({ x: n.x, y: n.y })) : [];
    return { pathTiles: nodes.length, components, parkEntrances, deadEnds, isolated, disconnected, rides: ridesReport };
}
