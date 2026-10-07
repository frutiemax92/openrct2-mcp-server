// Table identifiant ↔ index des objets chargés (SPEC 6.6), reconstruite à chaque changement de carte.

import { FOOTPATH_SURFACE_FLAGS, type ObjectRef } from "@openrct2-claude/protocol";
import { fail } from "./util";

let cache: { [type: string]: { [identifier: string]: number } } = {};

export function invalidateObjects(): void {
    cache = {};
}

function table(type: ObjectType): { [identifier: string]: number } {
    let t = cache[type];
    if (!t) {
        t = {};
        const all = objectManager.getAllObjects(type);
        for (let i = 0; i < all.length; i++) {
            const o = all[i];
            if (!o) continue;
            t[o.identifier] = o.index;
            const legacy = o.legacyIdentifier;
            if (legacy) t[legacy.trim()] = o.index;
        }
        cache[type] = t;
    }
    return t;
}

export interface Resolved {
    type: ObjectType;
    index: number;
}

/** Résout une référence d'objet parmi un ou plusieurs types, ou null. */
export function findLoaded(types: ObjectType[], ref: ObjectRef): Resolved | null {
    for (const type of types) {
        if (typeof ref === "number") {
            if (objectManager.getObject(type, ref)) return { type, index: ref };
            continue;
        }
        const idx = table(type)[ref] ?? table(type)[ref.trim()];
        if (idx !== undefined) return { type, index: idx };
    }
    return null;
}

/** Comme findLoaded, mais lève OBJECT_NOT_LOADED avec un hint. */
export function resolveLoaded(types: ObjectType[], ref: ObjectRef): Resolved {
    const r = findLoaded(types, ref);
    if (r) return r;
    const installed = typeof ref === "string" ? objectManager.getInstalledObject(ref) : null;
    fail("OBJECT_NOT_LOADED", `Objet ${JSON.stringify(ref)} non chargé dans le parc (types : ${types.join(", ")}).`, {
        details: { object: ref, installed: !!installed },
        hint: installed ? "Charge-le avec load_objects." : "Identifiant inconnu : cherche-le avec list_objects.",
    });
}

export function firstLoaded(type: ObjectType, predicate?: (o: LoadedObject) => boolean): LoadedObject | null {
    const all = objectManager.getAllObjects(type);
    for (let i = 0; i < all.length; i++) {
        const o = all[i];
        if (o && (!predicate || predicate(o))) return o;
    }
    return null;
}

export interface PathObjects {
    object: number;
    railings: number;
    legacy: boolean;
}

/** Choisit les objets de chemin : surface (NSF) + garde-corps, ou chemin legacy. */
export function resolvePath(ref: ObjectRef | undefined, railingsRef: ObjectRef | undefined, queue: boolean): PathObjects {
    let surface: Resolved | null = null;
    if (ref !== undefined) {
        surface = resolveLoaded(["footpath_surface", "footpath"], ref);
    } else {
        const wantQueue = queue ? FOOTPATH_SURFACE_FLAGS.isQueue : 0;
        const o = firstLoaded("footpath_surface", (obj) => {
            const flags = (obj as FootpathSurfaceObject).flags;
            return (flags & FOOTPATH_SURFACE_FLAGS.isQueue) === wantQueue && (flags & FOOTPATH_SURFACE_FLAGS.editorOnly) === 0;
        });
        if (o) surface = { type: "footpath_surface", index: o.index };
        else {
            const legacy = firstLoaded("footpath");
            if (legacy) surface = { type: "footpath", index: legacy.index };
        }
    }
    if (!surface) {
        fail("OBJECT_NOT_LOADED", "Aucun objet de chemin chargé.", { hint: "Charge un objet footpath_surface (list_objects type footpath_surface)." });
    }
    if (surface.type === "footpath") return { object: surface.index, railings: 0, legacy: true };
    let railings = 0;
    if (railingsRef !== undefined) railings = resolveLoaded(["footpath_railings"], railingsRef).index;
    else {
        const r = firstLoaded("footpath_railings");
        if (r) railings = r.index;
    }
    return { object: surface.index, railings, legacy: false };
}
