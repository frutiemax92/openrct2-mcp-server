// Utilitaires partagés du plugin.

import { BridgeException, type BridgeError, type ErrorCode } from "@openrct2-claude/protocol";

export function fail(code: ErrorCode, message: string, extra?: { details?: Record<string, unknown>; hint?: string }): never {
    throw new BridgeException({ code, message, ...extra });
}

export function toBridgeError(e: unknown): BridgeError {
    if (e instanceof BridgeException) return e.error;
    if (e && typeof e === "object" && "error" in e && (e as { error?: BridgeError }).error?.code) {
        return (e as { error: BridgeError }).error;
    }
    return { code: "INTERNAL", message: String(e instanceof Error ? e.message : e) };
}

export function log(message: string): void {
    console.log(`[claude-bridge] ${message}`);
}

export function isInt(v: unknown): v is number {
    return typeof v === "number" && Number.isInteger(v);
}

export function requireInt(params: Record<string, unknown>, key: string, min?: number, max?: number): number {
    const v = params[key];
    if (!isInt(v)) fail("INVALID_PARAMS", `Paramètre '${key}' : entier attendu.`);
    if ((min !== undefined && v < min) || (max !== undefined && v > max)) {
        fail("INVALID_PARAMS", `Paramètre '${key}' hors bornes [${min ?? "-∞"}, ${max ?? "+∞"}] : ${v}.`);
    }
    return v;
}

export function requireArray<T = unknown>(params: Record<string, unknown>, key: string, maxLength: number): T[] {
    const v = params[key];
    if (!Array.isArray(v)) fail("INVALID_PARAMS", `Paramètre '${key}' : tableau attendu.`);
    if (v.length > maxLength) fail("INVALID_PARAMS", `Paramètre '${key}' : ${v.length} éléments, maximum ${maxLength}.`);
    return v as T[];
}

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Noms de fichiers reçus : jamais de chemin arbitraire (SPEC 6.11). */
export function requireSafeName(params: Record<string, unknown>, key: string): string {
    const v = params[key];
    if (typeof v !== "string" || !NAME_RE.test(v)) {
        fail("INVALID_PARAMS", `Paramètre '${key}' : nom attendu ([a-zA-Z0-9_-], 64 caractères max).`);
    }
    return v;
}

export function inMap(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < map.size.x && y < map.size.y;
}

export function requireTileInMap(x: number, y: number): void {
    if (!inMap(x, y)) fail("INVALID_PARAMS", `Tuile (${x},${y}) hors de la carte (${map.size.x}×${map.size.y}).`, { details: { tile: { x, y } } });
}

export function requireParkLoaded(): void {
    if (context.mode !== "normal" && context.mode !== "scenario_editor") {
        fail("NOT_SUPPORTED_IN_MODE", `Aucun parc chargé (mode « ${context.mode} »).`, {
            hint: "Charge un parc dans le jeu, ou utilise checkpoint_restore.",
        });
    }
}

export function requireSinglePlayer(what: string): void {
    if (network.mode !== "none") {
        fail("NOT_SUPPORTED_IN_MODE", `${what} : modification directe impossible en multijoueur (mode réseau « ${network.mode} »).`);
    }
}

export function now(): number {
    return Date.now();
}

export function surfaceOf(tile: Tile): SurfaceElement | null {
    const els = tile.elements;
    for (let i = 0; i < els.length; i++) {
        if (els[i].type === "surface") return els[i] as SurfaceElement;
    }
    return null;
}
