// Monde simulé en mémoire : assez fidèle pour tester le serveur sans le jeu (SPEC 15.1, contrats).
// Les règles reprennent celles du jeu quand elles comptent pour le serveur : propriété, hauteur, collisions,
// bords de chemins calculés automatiquement, entrées raccordées côté opposé à la station.

import {
    DIRECTION_DELTA,
    RIDE_TYPES,
    reverseDirection,
    rotateOffset,
    type Direction,
    type RegionEntrance,
    type RegionTile,
} from "@openrct2-claude/protocol";

export interface FakePath {
    l: number;
    q: boolean;
    sd: Direction | null;
    e: number;
    object: string;
    r: number;
    a: string | null;
}

export interface FakeTrack {
    ride: number;
    trackType: number;
    direction: Direction;
    seq: number;
    l: number;
    origin: { x: number; y: number };
}

export interface FakeEntrance {
    k: 0 | 1 | 2;
    d: Direction;
    r: number;
    st: number;
    l: number;
    seq: number;
}

export interface FakeSmall {
    object: string;
    fullTile?: boolean;
    quadrant: number;
    direction: number;
    l: number;
}

export interface FakeTile {
    h: number;
    s: number;
    w: number;
    t: number;
    o: number;
    paths: FakePath[];
    tracks: FakeTrack[];
    entrances: FakeEntrance[];
    small: FakeSmall[];
    large: { object: string; l: number }[];
    walls: { object: string; edge: number; l: number }[];
}

export interface FakeObject {
    identifier: string;
    name: string;
    type: string;
    extra?: Record<string, unknown>;
}

export interface FakeRide {
    id: number;
    name: string;
    type: number;
    object: string;
    classification: "ride" | "stall" | "facility";
    status: "closed" | "open" | "testing" | "simulating";
    price: number[];
    origin: { x: number; y: number; l: number; direction: Direction } | null;
    trackType: number | null;
    entrance: { x: number; y: number; l: number; direction: Direction } | null;
    exit: { x: number; y: number; l: number; direction: Direction } | null;
    excitement: number;
    intensity: number;
    nausea: number;
    settings: Record<number, number>;
}

/** Empreintes des pièces plates (TED.FlatRide.h), en unités monde. */
export const FLAT_FOOTPRINTS: Record<number, [number, number][]> = {
    262: [[0, 0]],
    264: [[0, 0]],
    258: [[0, 0], [0, 32], [32, 0], [32, 32]],
    266: [[0, 0], [-32, -32], [-32, 0], [-32, 32], [0, -32], [0, 32], [32, -32], [32, 32], [32, 0]],
    259: [0, 32, 64, 96].flatMap((x) => [0, 32, 64, 96].map((y) => [x, y] as [number, number])),
    257: [[0, 0], [-64, 0], [-32, 0], [32, 0]],
    263: [[0, 0], [-64, 0], [-32, 0], [32, 0]],
    265: [[0, 0], [-64, 0], [-32, 0], [32, 0]],
    261: [[0, 0], [-64, 0], [-32, 0], [32, 0], [64, 0]],
    260: [[0, 0], [0, 32], [-32, 0], [-32, 32], [32, 0], [32, 32], [64, 0], [64, 32]],
};

/** occupiesFullTile | isTree (SmallSceneryEntry.h). */
const TREE_FLAGS = (1 << 0) | (1 << 28);

export const DEFAULT_OBJECTS: { loaded: FakeObject[]; installedOnly: FakeObject[] } = {
    loaded: [
        { identifier: "rct2.ride.mgr1", name: "Merry-Go-Round", type: "ride", extra: { rideType: [33] } },
        { identifier: "rct2.ride.burgb", name: "Burger Bar", type: "ride", extra: { rideType: [28] } },
        { identifier: "rct2.ride.drnks", name: "Drinks Stall", type: "ride", extra: { rideType: [30] } },
        { identifier: "rct2.ride.tlt1", name: "Toilets", type: "ride", extra: { rideType: [36] } },
        { identifier: "rct2.ride.twist1", name: "Twist", type: "ride", extra: { rideType: [46] } },
        { identifier: "rct2.ride.spcring", name: "Space Rings", type: "ride", extra: { rideType: [41] } },
        { identifier: "rct2.scenery_small.tcf", name: "Caucasian Fir Tree", type: "small_scenery", extra: { height: 64, price: 10, flags: TREE_FLAGS } },
        { identifier: "rct2.scenery_small.tsp", name: "Scots Pine Tree", type: "small_scenery", extra: { height: 64, price: 10, flags: TREE_FLAGS } },
        { identifier: "rct2.scenery_small.tl0", name: "Oak Tree", type: "small_scenery", extra: { height: 64, price: 10, flags: TREE_FLAGS } },
        { identifier: "rct2.scenery_small.bush", name: "Bush", type: "small_scenery", extra: { height: 16, price: 5, flags: 0 } },
        { identifier: "rct2.scenery_small.brock1", name: "Rock", type: "small_scenery", extra: { height: 16, price: 5, flags: 0 } },
        { identifier: "rct2.scenery_small.fbbl", name: "Flowers", type: "small_scenery", extra: { height: 8, price: 3, flags: 0 } },
        { identifier: "rct2.footpath_surface.tarmac", name: "Tarmac Footpath", type: "footpath_surface", extra: { flags: 0 } },
        { identifier: "rct2.footpath_surface.queue_blue", name: "Blue Queue", type: "footpath_surface", extra: { flags: 8 } },
        { identifier: "rct2.footpath_railings.wood", name: "Wooden Railings", type: "footpath_railings" },
        { identifier: "rct2.footpath_item.bench1", name: "Bench", type: "footpath_addition" },
        { identifier: "rct2.footpath_item.litter1", name: "Litter Bin", type: "footpath_addition" },
        { identifier: "rct2.footpath_item.lamp1", name: "Lamp", type: "footpath_addition" },
        { identifier: "rct2.park_entrance.pkent1", name: "Park Entrance", type: "park_entrance" },
        { identifier: "rct2.station.plain", name: "Plain Station", type: "station" },
        { identifier: "rct2.terrain_surface.grass", name: "Grass", type: "terrain_surface" },
        { identifier: "rct2.terrain_surface.sand", name: "Sand", type: "terrain_surface" },
        { identifier: "rct2.terrain_edge.rock", name: "Rock", type: "terrain_edge" },
    ],
    installedOnly: [
        { identifier: "rct2.ride.chpsh", name: "Chips Shop", type: "ride", extra: { rideType: [28] } },
        { identifier: "rct2.scenery_small.tmp", name: "Palm Tree", type: "small_scenery", extra: { height: 64, price: 12, flags: TREE_FLAGS } },
        { identifier: "rct2.ride.rct1.wooden", name: "Wooden Roller Coaster", type: "ride", extra: { rideType: [52] } },
    ],
};

export class World {
    tiles: FakeTile[];
    loaded: Map<string, FakeObject[]> = new Map();
    installed: FakeObject[];
    rides: FakeRide[] = [];
    cheats: Record<string, boolean | number> = { sandboxMode: false, buildInPauseMode: false, ignoreResearchStatus: false, disableClearanceChecks: false, disableSupportLimits: false };
    paused = false;
    gameSpeed = 1;
    ticks = 0;
    cash = 100_000;
    parkName = "Parc de test";
    entranceFee = 0;
    loan = 50_000;
    parkOpen = false;
    nextRideId = 0;
    spawns: { x: number; y: number; l: number; d: number }[] = [];
    staff: { id: number; type: string; orders: number; patrolTiles: number }[] = [];

    constructor(
        public readonly sizeX = 64,
        public readonly sizeY = 64,
        baseLevel = 7,
    ) {
        this.tiles = Array.from({ length: sizeX * sizeY }, (_, i) => {
            const x = i % sizeX;
            const y = Math.floor(i / sizeX);
            const edge = x === 0 || y === 0 || x === sizeX - 1 || y === sizeY - 1;
            return { h: baseLevel, s: 0, w: 0, t: 0, o: edge ? 0 : 1, paths: [], tracks: [], entrances: [], small: [], large: [], walls: [] };
        });
        for (const o of DEFAULT_OBJECTS.loaded) {
            const list = this.loaded.get(o.type) ?? [];
            list.push(o);
            this.loaded.set(o.type, list);
        }
        this.installed = [...DEFAULT_OBJECTS.loaded, ...DEFAULT_OBJECTS.installedOnly];
    }

    inMap(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.sizeX && y < this.sizeY;
    }

    tile(x: number, y: number): FakeTile {
        if (!this.inMap(x, y)) throw new Error(`hors carte ${x},${y}`);
        return this.tiles[y * this.sizeX + x];
    }

    // -- objets -------------------------------------------------------------

    loadedIndex(type: string, ref: string | number): number | null {
        const list = this.loaded.get(type) ?? [];
        if (typeof ref === "number") return ref >= 0 && ref < list.length ? ref : null;
        const i = list.findIndex((o) => o.identifier === ref);
        return i >= 0 ? i : null;
    }

    loadedObject(type: string, ref: string | number): FakeObject | null {
        const i = this.loadedIndex(type, ref);
        return i === null ? null : (this.loaded.get(type) ?? [])[i];
    }

    load(identifier: string): { ok: boolean; index: number | null; type: string | null; error?: string } {
        const inst = this.installed.find((o) => o.identifier === identifier);
        if (!inst) return { ok: false, index: null, type: null, error: "objet non installé" };
        const list = this.loaded.get(inst.type) ?? [];
        const existing = list.findIndex((o) => o.identifier === identifier);
        if (existing >= 0) return { ok: true, index: existing, type: inst.type };
        list.push(inst);
        this.loaded.set(inst.type, list);
        return { ok: true, index: list.length - 1, type: inst.type };
    }

    // -- lecture ------------------------------------------------------------

    regionTile(x: number, y: number): RegionTile {
        const t = this.tile(x, y);
        const out: RegionTile = { h: t.h, s: t.s, w: t.w, t: t.t, o: t.o };
        if (t.paths.length) out.p = t.paths.map((p) => ({ l: p.l, q: p.q ? 1 : 0, e: p.e, sd: p.sd ?? -1, r: p.r, a: p.a ? (this.loadedIndex("footpath_addition", p.a) ?? -1) : -1 }));
        if (t.tracks.length) {
            out.r = [...new Set(t.tracks.map((k) => k.ride))];
            out.rh = Math.max(...t.tracks.map((k) => k.l + 2));
        }
        if (t.entrances.length) out.e = t.entrances.map((e): RegionEntrance => ({ ...e }));
        if (t.small.length) out.sc = t.small.length;
        if (t.large.length) out.lg = t.large.length;
        if (t.walls.length) out.wl = t.walls.length;
        if (t.small.length || t.large.length) out.sh = Math.max(...t.small.map((s) => s.l + 4), ...t.large.map((s) => s.l + 4));
        return out;
    }

    // -- chemins : bords automatiques ---------------------------------------

    /** Hauteur (niveau) du bord d'un chemin du côté `side`, ou null. */
    static pathEdgeLevel(p: { l: number; sd: Direction | null }, side: Direction): number | null {
        if (p.sd === null) return p.l;
        if (side === p.sd) return p.l + 1;
        if (side === reverseDirection(p.sd)) return p.l;
        return null;
    }

    private connectable(x: number, y: number, p: FakePath, side: Direction): boolean {
        const lvl = World.pathEdgeLevel(p, side);
        if (lvl === null) return false;
        const nx = x + DIRECTION_DELTA[side].x;
        const ny = y + DIRECTION_DELTA[side].y;
        if (!this.inMap(nx, ny)) return false;
        const n = this.tile(nx, ny);
        const back = reverseDirection(side);
        // Autre chemin au même niveau de bord. Une file d'attente ne se raccorde qu'à un seul autre chemin
        // par extrémité, mais on reste simple ici.
        if (n.paths.some((q) => World.pathEdgeLevel(q, back) === lvl)) return true;
        // Entrée/sortie d'attraction : raccord du côté opposé à la station.
        if (n.entrances.some((e) => (e.k === 0 || e.k === 1) && e.l === lvl && reverseDirection(e.d) === back)) return true;
        // Entrée du parc : raccord devant et derrière (axe de la direction).
        if (n.entrances.some((e) => e.k === 2 && e.seq === 0 && e.l === lvl && (e.d === side || e.d === back))) return true;
        // Boutique : face avant (direction de la pièce).
        if (n.tracks.some((k) => k.l === lvl && this.isShop(k.ride) && k.direction === back)) return true;
        return false;
    }

    private isShop(rideId: number): boolean {
        const r = this.rides.find((r) => r.id === rideId);
        return !!r && r.classification !== "ride";
    }

    recomputeEdges(x: number, y: number): void {
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const tx = x + dx;
            const ty = y + dy;
            if (!this.inMap(tx, ty)) continue;
            for (const p of this.tile(tx, ty).paths) {
                let e = 0;
                for (let d = 0; d < 4; d++) if (this.connectable(tx, ty, p, d as Direction)) e |= 1 << d;
                p.e = e;
            }
        }
    }

    // -- attractions --------------------------------------------------------

    footprint(trackType: number, x: number, y: number, direction: number): { x: number; y: number }[] {
        const fp = FLAT_FOOTPRINTS[trackType];
        if (!fp) return [{ x, y }];
        return fp.map(([ox, oy]) => {
            const r = rotateOffset({ x: ox, y: oy }, direction);
            return { x: x + Math.floor(r.x / 32), y: y + Math.floor(r.y / 32) };
        });
    }

    rideClassification(rideType: number): FakeRide["classification"] {
        const info = RIDE_TYPES.find((r) => r.rideType === rideType);
        if (info?.category !== "shop") return "ride";
        return /toilet|information|first_aid|cash_machine/.test(info.name) ? "facility" : "stall";
    }
}
