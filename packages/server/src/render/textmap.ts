// Carte texte (SPEC 10.1, 3) : une lettre par tuile, très économe en tokens.

import type { RegionTile, RideSummary, TileRect } from "@openrct2-claude/protocol";

export type TextLayer = "overview" | "height" | "owner";

const RIDE_LETTERS = "ABCDFGHJKMNPQRSUVWXYZbdfghjkmnpqsuvwyz";
const HEIGHT_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export interface TextMapResult {
    text: string;
    legend: string[];
}

export function rideLetters(rides: RideSummary[]): Map<number, string> {
    const m = new Map<number, string>();
    rides.forEach((r, i) => m.set(r.id, RIDE_LETTERS[i % RIDE_LETTERS.length]));
    return m;
}

function overviewChar(t: RegionTile, letters: Map<number, string>): string {
    if (t.e?.length) {
        const e = t.e[0];
        return e.k === 2 ? "E" : e.k === 0 ? "i" : "o";
    }
    if (t.r?.length) return letters.get(t.r[0]) ?? "R";
    if (t.p?.length) {
        const p = t.p[0];
        if (p.q) return "=";
        return p.sd >= 0 ? "/" : "#";
    }
    if (t.lg) return "L";
    if (t.sc) return "T";
    if (t.wl) return "|";
    if (t.w > t.h) return "~";
    if (!(t.o & 1)) return t.o & 2 ? "c" : ",";
    return t.s ? "^" : ".";
}

export function renderTextMap(rect: TileRect, get: (x: number, y: number) => RegionTile | undefined, layer: TextLayer, rides: RideSummary[]): TextMapResult {
    const letters = rideLetters(rides);
    let minH = Infinity;
    if (layer === "height") {
        for (let y = rect.y1; y <= rect.y2; y++) for (let x = rect.x1; x <= rect.x2; x++) minH = Math.min(minH, get(x, y)?.h ?? Infinity);
    }
    const width = rect.x2 - rect.x1 + 1;
    const pad = Math.max(3, String(rect.y2).length);
    // Règle des x : un repère tous les 8, aligné sur des multiples de 8.
    const ruler = Array.from({ length: width }, () => " ");
    for (let x = rect.x1; x <= rect.x2; x++) {
        if (x % 8 === 0) {
            const label = String(x);
            for (let i = 0; i < label.length && x - rect.x1 + i < width; i++) ruler[x - rect.x1 + i] = label[i];
        }
    }
    const lines = [`${"y\\x".padStart(pad)} ${ruler.join("")}`];
    for (let y = rect.y1; y <= rect.y2; y++) {
        let row = "";
        for (let x = rect.x1; x <= rect.x2; x++) {
            const t = get(x, y);
            if (!t) {
                row += " ";
                continue;
            }
            if (layer === "overview") row += overviewChar(t, letters);
            else if (layer === "height") row += t.w > t.h ? "~" : HEIGHT_CHARS[Math.min(HEIGHT_CHARS.length - 1, t.h - minH)] ?? "?";
            else row += t.o & 1 ? "." : t.o & 2 ? "c" : "x";
        }
        lines.push(`${String(y).padStart(pad)} ${row}`);
    }
    const legend: string[] = [];
    if (layer === "overview") {
        legend.push(". terrain possédé, ^ en pente, , non possédé, c droits de construction, ~ eau");
        legend.push("# chemin, / rampe, = file d'attente, T petite scénerie, L grande scénerie, | mur");
        legend.push("E entrée du parc, i entrée d'attraction, o sortie");
        const used = rides.filter((r) => {
            for (let y = rect.y1; y <= rect.y2; y++) for (let x = rect.x1; x <= rect.x2; x++) if (get(x, y)?.r?.includes(r.id)) return true;
            return false;
        });
        if (used.length) legend.push("Attractions : " + used.map((r) => `${letters.get(r.id)}=${r.name} (#${r.id})`).join(", "));
    } else if (layer === "height") {
        legend.push(`Niveau du terrain = ${minH === Infinity ? 0 : minH} + valeur (0-9, puis a-z, A-Z) ; ~ eau. 1 niveau = 1 marche.`);
    } else {
        legend.push(". possédé, c droits de construction seulement, x non possédé");
    }
    return { text: lines.join("\n"), legend };
}
