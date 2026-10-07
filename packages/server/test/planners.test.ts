import { describe, expect, it } from "vitest";
import type { RegionTile } from "@openrct2-claude/protocol";
import { analyzeConnectivity } from "../src/planners/connectivity.js";
import { edgeLevel, elevatedPlacement, expandPolyline, onTerrain, planPath } from "../src/planners/path.js";
import { routeToNetwork } from "../src/tools/helpers.js";

const flat = (h = 7, extra: Partial<RegionTile> = {}): RegionTile => ({ h, s: 0, w: 0, t: 0, o: 1, ...extra });

describe("expandPolyline", () => {
    it("remplit les segments en L, sans doublons", () => {
        const r = expandPolyline([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]);
        expect(r).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }]);
    });
    it("gère les diagonales en passant d'abord par x", () => {
        expect(expandPolyline([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    });
});

describe("onTerrain (kDefaultPathSlope)", () => {
    it("plat → plat", () => expect(onTerrain(flat(5))).toEqual({ level: 5, slopeDirection: null }));
    it("N|E relevés → rampe direction 2", () => expect(onTerrain(flat(5, { s: 3 }))).toEqual({ level: 5, slopeDirection: 2 }));
    it("S|W relevés → rampe direction 0", () => expect(onTerrain(flat(5, { s: 12 }))).toEqual({ level: 5, slopeDirection: 0 }));
    it("trois coins → plat un niveau au-dessus", () => expect(onTerrain(flat(5, { s: 7 }))).toEqual({ level: 6, slopeDirection: null }));
    it("un seul coin → irrégulier", () => expect(onTerrain(flat(5, { s: 1 }))).toBeNull());
    it("diagonale → irrégulier", () => expect(onTerrain(flat(5, { s: 16 | 5 }))).toBeNull());
});

describe("edgeLevel", () => {
    it("rampe : haut du côté de la montée, bas à l'opposé, rien sur les côtés", () => {
        const p = { level: 3, slopeDirection: 2 as const };
        expect(edgeLevel(p, 2)).toBe(4);
        expect(edgeLevel(p, 0)).toBe(3);
        expect(edgeLevel(p, 1)).toBeNull();
    });
});

describe("planPath", () => {
    it("signale les ruptures de niveau et les pentes irrégulières", () => {
        const tiles: Record<string, RegionTile> = { "0,0": flat(5), "1,0": flat(7), "2,0": flat(7, { s: 1 }) };
        const plan = planPath(expandPolyline([{ x: 0, y: 0 }, { x: 2, y: 0 }]), (x, y) => tiles[`${x},${y}`]);
        expect(plan.problems.map((p) => p.code).sort()).toEqual(["BAD_SLOPE", "LEVEL_BREAK"]);
    });
    it("accepte une rampe entre deux niveaux", () => {
        const tiles: Record<string, RegionTile> = { "0,0": flat(5), "1,0": flat(5, { s: 3 }), "2,0": flat(6) };
        const plan = planPath(expandPolyline([{ x: 0, y: 0 }, { x: 2, y: 0 }]), (x, y) => tiles[`${x},${y}`]);
        expect(plan.problems).toEqual([]);
        expect(plan.slopes).toHaveLength(1);
    });
});

describe("analyzeConnectivity", () => {
    it("compte les composantes, impasses et raccords d'attraction", () => {
        const tiles: Record<string, RegionTile> = {
            "0,0": flat(7, { e: [{ k: 2, d: 2, r: 0, st: 0, l: 7, seq: 0 }] }),
            "1,0": flat(7, { p: [{ l: 7, q: 0, e: 0b0101, sd: -1, r: -1, a: -1 }] }),
            "2,0": flat(7, { p: [{ l: 7, q: 0, e: 0b0001, sd: -1, r: -1, a: -1 }] }),
            "5,5": flat(7, { p: [{ l: 7, q: 0, e: 0, sd: -1, r: -1, a: -1 }] }),
        };
        const rep = analyzeConnectivity({ x1: 0, y1: 0, x2: 6, y2: 6 }, (x, y) => tiles[`${x},${y}`] ?? flat(), []);
        expect(rep.pathTiles).toBe(3);
        expect(rep.components).toHaveLength(2);
        expect(rep.parkEntrances[0].connected).toBe(true);
        expect(rep.deadEnds).toEqual([{ x: 2, y: 0 }]);
        expect(rep.isolated).toEqual([{ x: 5, y: 5 }]);
    });
});

describe("elevatedPlacement", () => {
    it("trouve un créneau libre entre deux pièces d'attraction à des hauteurs différentes", () => {
        // Un circuit qui se croise lui-même : une pièce basse [10,11.5) et une pièce haute [14,16) sur la même
        // tuile (cas réel observé en jeu). Une passerelle au niveau 12 (dégagement [12,14), PATH_CLEARANCE=2)
        // passe tout juste entre les deux, mais pas au niveau 10 (chevauche la pièce basse) ni au niveau 13
        // (dégagement [13,15) chevauche la pièce haute).
        const t = flat(7, { r: [0], rh: 16, ri: [[10, 11.5], [14, 16]] });
        expect(elevatedPlacement(t, 12)).toEqual({ level: 12, slopeDirection: null });
        expect(elevatedPlacement(t, 10)).toBeNull();
        expect(elevatedPlacement(t, 13)).toBeNull();
    });
});

describe("routeToNetwork", () => {
    const path = (q = 0) => ({ p: [{ l: 7, q, e: 0, sd: -1, r: -1, a: -1 }] });
    it("ne longe pas la file d'attente d'une autre attraction (fusion automatique par le jeu)", () => {
        // Réseau en y = 0. Départ en (0,3). File existante en (1,1) : la colonne x = 0 la touche en (0,1).
        const tiles: Record<string, RegionTile> = {};
        for (let x = -3; x <= 3; x++) tiles[`${x},0`] = flat(7, path());
        tiles["1,1"] = flat(7, path(1));
        const get = (x: number, y: number) => tiles[`${x},${y}`] ?? flat();
        const route = routeToNetwork({ x: 0, y: 3 }, get, { sandbox: false, startLevel: 7 })!;
        expect(route).not.toBeNull();
        expect(route.some((t) => t.x === 0 && t.y === 1)).toBe(false);
        expect(route.some((t) => t.x === 2 && t.y === 1)).toBe(false);
    });

    it("pose une passerelle quand l'entrée est surélevée au-dessus d'un terrain plat", () => {
        // Entrée à (0,0), niveau 12 (station surélevée), terrain plat au niveau 7 tout autour.
        // Réseau existant : une autre passerelle déjà posée au niveau 12 en (3,0).
        const tiles: Record<string, RegionTile> = {};
        for (let x = 0; x <= 3; x++) tiles[`${x},0`] = flat(7);
        tiles["3,0"] = flat(7, { p: [{ l: 12, q: 0, e: 0, sd: -1, r: -1, a: -1 }] });
        const get = (x: number, y: number) => tiles[`${x},${y}`] ?? flat(7);
        const route = routeToNetwork({ x: 0, y: 0 }, get, { sandbox: false, startLevel: 12 });
        expect(route).not.toBeNull();
        expect(route!.every((t) => t.level === 12 && t.slopeDirection === null)).toBe(true);
        expect(route!.map((t) => `${t.x},${t.y}`)).toEqual(["0,0", "1,0", "2,0"]);
    });

    it("la passerelle ne traverse pas une attraction qui dépasse son niveau", () => {
        const tiles: Record<string, RegionTile> = {};
        for (let x = 0; x <= 3; x++) tiles[`${x},0`] = flat(7);
        tiles["1,0"] = flat(7, { r: [1], rh: 12 });
        tiles["3,0"] = flat(7, { p: [{ l: 12, q: 0, e: 0, sd: -1, r: -1, a: -1 }] });
        const get = (x: number, y: number) => tiles[`${x},${y}`];
        const route = routeToNetwork({ x: 0, y: 0 }, get, { sandbox: false, startLevel: 12 });
        expect(route).toBeNull();
    });

    it("ne repasse jamais sur une de ses propres tuiles (pas de demi-tour en rampe sous son départ)", () => {
        // Départ (0,0) niveau 12, sous une pièce de piste [10,11.5) sur toute la rangée y=0 : pour descendre il faut
        // aller vers l'est (x=1..5 libres), puis revenir vers l'ouest. Le réseau au sol (niveau 7) est en (-6,0).
        const tiles: Record<string, RegionTile> = {};
        const track = { r: [0], rh: 11.5, ri: [[10, 11.5]] as [number, number][] };
        for (let x = -5; x <= 0; x++) tiles[`${x},0`] = flat(7, track);
        for (let x = 1; x <= 6; x++) tiles[`${x},0`] = flat(7);
        for (let x = -5; x <= 6; x++) tiles[`${x},1`] = flat(7, x <= 0 ? track : {});
        tiles["-6,0"] = flat(7, path());
        const get = (x: number, y: number) => tiles[`${x},${y}`];
        const route = routeToNetwork({ x: 0, y: 0 }, get, { sandbox: false, startLevel: 12 });
        expect(route).not.toBeNull();
        const keys = route!.map((t) => `${t.x},${t.y}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("descend en rampe depuis une entrée surélevée jusqu'au réseau au sol", () => {
        // Entrée à (0,0), niveau 12. Terrain plat au niveau 7. Réseau au sol (niveau 7) en (6,0).
        // Écart de 5 niveaux : exactement 5 tuiles en rampe (x=1..5) pour redescendre, sans marge.
        const tiles: Record<string, RegionTile> = {};
        for (let x = 0; x <= 5; x++) tiles[`${x},0`] = flat(7);
        tiles["6,0"] = flat(7, path());
        const get = (x: number, y: number) => tiles[`${x},${y}`];
        const route = routeToNetwork({ x: 0, y: 0 }, get, { sandbox: false, startLevel: 12 });
        expect(route).not.toBeNull();
        expect(route!.map((t) => t.level)).toEqual([12, 11, 10, 9, 8, 7]);
        expect(route!.slice(1).every((t) => t.slopeDirection === 0)).toBe(true);
    });
});
