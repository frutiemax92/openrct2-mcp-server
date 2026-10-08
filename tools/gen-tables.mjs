#!/usr/bin/env node
// Génère les tables dérivées du code C++ d'OpenRCT2 (lecture seule) :
//  - packages/protocol/src/generated/actionArgs.ts : clés lues par AcceptParameters, par nom d'action (SPEC F5, F6)
//  - packages/protocol/src/generated/rideTypes.ts  : rideType -> nom, catégorie, pièce de départ (SPEC 9.4)
//  - data/ride_start_piece.json                     : même table, au format JSON
//
// Usage : node tools/gen-tables.mjs [chemin du dépôt OpenRCT2]   (défaut : ..)

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repo = resolve(process.argv[2] ?? process.env.OPENRCT2_SRC ?? join(root, ".."));
const src = join(repo, "src", "openrct2");

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

// ---------------------------------------------------------------------------
// 1. Arguments des game actions
// ---------------------------------------------------------------------------

const scriptEngine = readFileSync(join(src, "scripting", "ScriptEngine.cpp"), "utf8");
const nameTable = scriptEngine.slice(scriptEngine.indexOf("ActionNameToType"));
const nameToCommand = new Map();
for (const m of nameTable.matchAll(/\{\s*"(\w+)",\s*GameCommand::(\w+)\s*\}/g)) {
    nameToCommand.set(m[1], m[2]);
}

const actionFiles = walk(join(src, "actions"));
const headers = actionFiles.filter((f) => f.endsWith(".h"));
const sources = actionFiles.filter((f) => f.endsWith(".cpp"));

const commandToClass = new Map();
const classMemberTypes = new Map();
const classScalarTypes = new Map();
for (const h of headers) {
    const text = readFileSync(h, "utf8");
    for (const m of text.matchAll(/class\s+(\w+)\s+final\s*:\s*public\s+GameActionBase<GameCommand::(\w+)>/g)) {
        commandToClass.set(m[2], m[1]);
        const members = {};
        const scalars = {};
        for (const mm of text.matchAll(/\b(bool|std::string|u8string|std::string_view)\s+(_\w+)\s*[;{=]/g)) {
            scalars[mm[2]] = mm[1] === "bool" ? "bool" : "string";
        }
        classScalarTypes.set(m[1], scalars);
        for (const mm of text.matchAll(/\b(CoordsXYZD|CoordsXYZ|CoordsXY|MapRange|TileCoordsXYZD|TileCoordsXYZ|TileCoordsXY)\s+(_\w+)\s*[;{=]/g)) {
            members[mm[2]] = mm[1];
        }
        classMemberTypes.set(m[1], members);
    }
}

const compositeKeys = {
    CoordsXY: ["x", "y"],
    CoordsXYZ: ["x", "y", "z"],
    CoordsXYZD: ["x", "y", "z", "direction"],
    MapRange: ["x1", "y1", "x2", "y2"],
};

const classToKeys = new Map();
for (const s of sources) {
    const text = readFileSync(s, "utf8");
    for (const m of text.matchAll(/void\s+(\w+)::AcceptParameters\s*\(\s*GameActionParameterVisitor&\s*visitor\s*\)\s*\{([\s\S]*?)\n\s{4}\}/g)) {
        const cls = m[1];
        const body = m[2];
        const keys = [];
        for (const v of body.matchAll(/visitor\.Visit\(\s*(?:"(\w+)"\s*,\s*([\w.]+)|(_\w+))/g)) {
            if (v[1]) {
                const type = classScalarTypes.get(cls)?.[v[2]] ?? "int";
                keys.push(type === "int" ? v[1] : `${v[1]}:${type}`);
            } else {
                const type = classMemberTypes.get(cls)?.[v[3]];
                if (!type || !compositeKeys[type]) throw new Error(`Type inconnu pour ${cls}.${v[3]} (${type})`);
                keys.push(...compositeKeys[type]);
            }
        }
        classToKeys.set(cls, keys);
    }
}

const actionArgs = {};
for (const [name, command] of [...nameToCommand.entries()].sort()) {
    const cls = commandToClass.get(command);
    actionArgs[name] = cls ? classToKeys.get(cls) ?? [] : [];
}

// ---------------------------------------------------------------------------
// 2. Types d'attractions et pièce de départ
// ---------------------------------------------------------------------------

const trackElemText = readFileSync(join(src, "ride", "ted", "TrackElemType.h"), "utf8");
const trackElemValue = new Map();
for (const m of trackElemText.matchAll(/^\s+(\w+)\s*=\s*(\d+),/gm)) trackElemValue.set(m[1], Number(m[2]));

const rtdFiles = walk(join(src, "ride", "rtd")).filter((f) => f.endsWith(".h"));
const rtdInfo = new Map();
for (const f of rtdFiles) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/constexpr\s+RideTypeDescriptor\s+(\w+)\s*=\s*\{([\s\S]*?)\n\};/g)) {
        const body = m[2];
        const category = /\.Category\s*=\s*RideCategory::(\w+)/.exec(body)?.[1] ?? null;
        const start = /\.StartTrackPiece\s*=\s*TrackElemType::(\w+)/.exec(body)?.[1] ?? null;
        // Premier TrackDrawerEntry : pièces constructibles (enabled) et pièces dessinables par cheat (extra).
        // trackplace ne vérifie pas les groupes (TrackPlaceAction.cpp) : le serveur doit le faire (SPEC 12.2).
        const groupsOf = (key) => {
            const g = new RegExp(`\\.${key}\\s*=\\s*\\{([^}]*)\\}`).exec(body)?.[1] ?? "";
            return [...g.matchAll(/TrackGroup::(\w+)/g)].map((x) => x[1]);
        };
        rtdInfo.set(m[1], { category, start, enabled: groupsOf("enabledTrackGroups"), extra: groupsOf("extraTrackGroups") });
    }
}

const trackGroupText = readFileSync(join(src, "ride", "ted", "TrackGroup.h"), "utf8");
const trackGroupEnum = /enum class TrackGroup[^{]*\{([\s\S]*?)\};/.exec(trackGroupText)[1];
const trackGroups = {};
for (const line of trackGroupEnum.split("\n")) {
    const m = /^\s*(\w+)\s*(?:=\s*0\s*)?,/.exec(line);
    if (!m || m[1] === "count") continue;
    trackGroups[m[1]] = Object.keys(trackGroups).length;
}
const groupValue = (name) => {
    if (trackGroups[name] === undefined) throw new Error(`TrackGroup inconnu : ${name}`);
    return trackGroups[name];
};

const rideData = readFileSync(join(src, "ride", "RideData.cpp"), "utf8");
const table = rideData.slice(rideData.indexOf("kRideTypeDescriptors[RIDE_TYPE_COUNT] = {"));
const rideTypes = [];
let index = 0;
for (const m of table.matchAll(/\/\*\s*RIDE_TYPE_(\w+)\s*\*\/\s*(\w+),/g)) {
    const info = rtdInfo.get(m[2]);
    if (!info && m[2] !== "kDummyRTD") throw new Error(`RTD introuvable : ${m[2]}`);
    if (!info) { index++; continue; }
    rideTypes.push({
        rideType: index++,
        name: m[1].toLowerCase(),
        category: info.category,
        startTrackPiece: info.start ? trackElemValue.get(info.start) ?? null : null,
        startTrackPieceName: info.start,
        trackGroups: info.enabled.map(groupValue),
        extraTrackGroups: info.extra.map(groupValue),
    });
}

// ---------------------------------------------------------------------------
// 3. CheatType (énumération séquentielle de Cheats.h, SPEC F20)
// ---------------------------------------------------------------------------

const cheatsText = readFileSync(join(src, "Cheats.h"), "utf8");
const cheatEnum = /enum class CheatType[^{]*\{([\s\S]*?)\};/.exec(cheatsText)[1];
const cheatTypes = {};
let cheatIndex = 0;
for (const line of cheatEnum.split("\n")) {
    const m = /^\s*(\w+)\s*,/.exec(line);
    if (!m || m[1] === "count") continue;
    cheatTypes[m[1]] = cheatIndex++;
}

// ---------------------------------------------------------------------------
// 4. Notes des attractions (COASTER_REFERENCE P1) : RatingsData, hauteurs et drapeaux de chaque RideTypeDescriptor
// ---------------------------------------------------------------------------

/** Évalue une constante C++ simple : entiers, hexadécimaux, RideRating::make(a, b), MakeFixed16_2dp(a, b). */
function evalConst(expr) {
    const s = expr
        .trim()
        .replace(/RideRating::make\(\s*(-?\d+)\s*,\s*(\d+)\s*\)/g, (_, a, b) => String(Number(a) * 100 + Number(b)))
        .replace(/MakeFixed16_2dp\(\s*(-?\d+)\s*,\s*(\d+)\s*\)/g, (_, a, b) => String(Number(a) * 100 + Number(b)))
        .replace(/kDynamicRideShelterRating/g, "-1")
        .replace(/\btrue\b/g, "1")
        .replace(/\bfalse\b/g, "0");
    if (!/^[-+*/()\sx0-9a-fA-F]+$/.test(s)) throw new Error(`Constante non évaluable : ${expr}`);
    return Number(Function(`"use strict"; return (${s});`)());
}

/** Découpe le contenu d'accolades au niveau supérieur (virgules hors accolades et parenthèses). */
function splitTop(body) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of body) {
        if (ch === "{" || ch === "(") depth++;
        if (ch === "}" || ch === ")") depth--;
        if (ch === "," && depth === 0) {
            if (cur.trim()) out.push(cur.trim());
            cur = "";
        } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

/** Contenu entre l'accolade ouvrante à `start` et sa fermante. */
function braced(text, start) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}" && --depth === 0) return text.slice(start + 1, i);
    }
    throw new Error("Accolade non fermée");
}

function enumRanks(text, name) {
    const body = new RegExp(`enum class ${name}\\b[^{]*\\{([\\s\\S]*?)\\};`).exec(text)?.[1];
    if (!body) throw new Error(`enum ${name} introuvable`);
    const ranks = {};
    let i = 0;
    for (const line of body.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")) {
        const m = /^\s*(\w+)\s*(?:=\s*(\d+))?\s*,?\s*(?:\/\/.*)?$/.exec(line);
        if (!m) continue;
        if (m[2] !== undefined) i = Number(m[2]);
        ranks[m[1]] = i++;
    }
    return ranks;
}

const rideDataH = readFileSync(join(src, "ride", "RideData.h"), "utf8");
// Ensembles nommés de drapeaux RTD (kRtdFlagsCommonCoaster…), pour savoir quels types ont hasAirTime.
const rtdFlagSets = new Map();
for (const m of rideDataH.matchAll(/constexpr\s+RtdFlags\s+(\w+)\s*=\s*\{([\s\S]*?)\};/g)) {
    rtdFlagSets.set(m[1], new Set([...m[2].matchAll(/RtdFlag::(\w+)/g)].map((x) => x[1])));
}
const modifierTypes = enumRanks(rideDataH, "RatingsModifierType");
const calcTypes = enumRanks(rideDataH, "RatingsCalculationType");

const ratingsByRtd = new Map();
for (const f of rtdFiles) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/constexpr\s+RideTypeDescriptor\s+(\w+)\s*=\s*\{([\s\S]*?)\n\};/g)) {
        const body = m[2].replace(/\/\/[^\n]*/g, "");
        const at = body.indexOf(".RatingsData =");
        if (at < 0) continue;
        const parts = splitTop(braced(body, body.indexOf("{", at)));
        const [type, base, unreliability, shelter, relax, mods] = parts;
        const baseVals = splitTop(base.slice(1, -1)).map(evalConst);
        const modifiers = splitTop(mods.slice(1, -1)).map((mm) => {
            const [kind, threshold, e, i, n] = splitTop(mm.slice(1, -1));
            const k = /RatingsModifierType::(\w+)/.exec(kind)[1];
            if (modifierTypes[k] === undefined) throw new Error(`Modificateur inconnu : ${k}`);
            return { type: k, threshold: evalConst(threshold), excitement: evalConst(e), intensity: evalConst(i), nausea: evalConst(n) };
        });
        const flagsExpr = /\.flags\s*=\s*([\s\S]*?),\n\s*\./.exec(body)?.[1] ?? "";
        const flags = new Set([...flagsExpr.matchAll(/RtdFlag::(\w+)/g)].map((x) => x[1]));
        for (const name of flagsExpr.match(/kRtdFlags\w+/g) ?? []) for (const fl of rtdFlagSets.get(name) ?? []) flags.add(fl);
        const heights = /\.Heights\s*=\s*\{([^}]*)\}/.exec(body)?.[1];
        // Boutiques : hauteurs nommées (kDefault…Height), inutiles ici.
        const heightVals = heights && splitTop(heights).every((h) => /^-?(0x)?[0-9a-fA-F]+$/.test(h)) ? splitTop(heights).map(evalConst) : null;
        const [maxHeight, clearanceHeight, vehicleZOffset, platformHeight] = heightVals ?? [];
        const calc = /RatingsCalculationType::(\w+)/.exec(type)[1];
        if (calcTypes[calc] === undefined) throw new Error(`Type de calcul inconnu : ${calc}`);
        ratingsByRtd.set(m[1], {
            calculation: calc,
            base: { excitement: baseVals[0], intensity: baseVals[1], nausea: baseVals[2] },
            unreliability: evalConst(unreliability),
            rideShelter: evalConst(shelter),
            relaxRequirementsIfInversions: evalConst(relax) === 1,
            modifiers,
            hasAirTime: flags.has("hasAirTime"),
            hasGForces: flags.has("hasGForces"),
            heights: heightVals ? { maxHeight, clearanceHeight, vehicleZOffset, platformHeight } : null,
        });
    }
}

const rideRatings = {};
{
    let idx = 0;
    for (const m of table.matchAll(/\/\*\s*RIDE_TYPE_(\w+)\s*\*\/\s*(\w+),/g)) {
        const r = ratingsByRtd.get(m[2]);
        if (r) rideRatings[idx] = { name: m[1].toLowerCase(), ...r };
        idx++;
    }
}

const rideH = readFileSync(join(src, "ride", "Ride.h"), "utf8");
const rideEntryH = readFileSync(join(src, "ride", "RideEntry.h"), "utf8");
const ratingFlags = {
    /** Rang des drapeaux de Ride.flags (FlagHolder : 1 << rang). */
    rideFlag: enumRanks(rideH, "RideFlag"),
    /** Rang des drapeaux de RideObject.flags. */
    rideEntryFlag: enumRanks(rideEntryH, "RideEntryFlag"),
};

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

const banner = `// Fichier généré par tools/gen-tables.mjs à partir de ${repo.replace(process.env.HOME ?? "", "~")}. Ne pas modifier à la main.\n`;
const genDir = join(root, "packages", "protocol", "src", "generated");
mkdirSync(genDir, { recursive: true });

writeFileSync(
    join(genDir, "actionArgs.ts"),
    banner +
        "/**\n * Clés lues par AcceptParameters (toutes obligatoires, sauf `flags`). Le C++ fait foi (SPEC F6).\n * Suffixe `:bool` / `:string` : le jeu exige ce type JS exact ; sinon un nombre.\n */\n" +
        "export const ACTION_ARGS: Readonly<Record<string, readonly string[]>> = " +
        JSON.stringify(actionArgs, null, 4) +
        ";\n",
);

writeFileSync(
    join(genDir, "rideTypes.ts"),
    banner +
        "export interface RideTypeInfo {\n    rideType: number;\n    name: string;\n    category: string | null;\n    startTrackPiece: number | null;\n    startTrackPieceName: string | null;\n    /** Groupes de pièces constructibles (TrackGroup). */\n    trackGroups: number[];\n    /** Groupes dessinables seulement avec le cheat enableAllDrawableTrackPieces. */\n    extraTrackGroups: number[];\n}\n\n" +
        "export const RIDE_TYPES: readonly RideTypeInfo[] = " +
        JSON.stringify(rideTypes, null, 4) +
        ";\n\n/** Valeurs de `TrackGroup` (ride/ted/TrackGroup.h). */\nexport const TRACK_GROUPS = " +
        JSON.stringify(trackGroups, null, 4) +
        " as const;\n",
);

writeFileSync(
    join(genDir, "cheatTypes.ts"),
    banner + "/** Valeurs de `CheatType` pour l'action `cheatset`. */\n" +
        "export const CHEAT_TYPES = " + JSON.stringify(cheatTypes, null, 4) + " as const;\n\n" +
        "export type CheatName = keyof typeof CHEAT_TYPES;\n",
);

const trackElemTypes = Object.fromEntries([...trackElemValue.entries()].filter(([, v]) => v < 350).sort((a, b) => a[1] - b[1]));
writeFileSync(
    join(genDir, "trackElemTypes.ts"),
    banner + "/** Valeurs de `TrackElemType` (ride/ted/TrackElemType.h), hors alias legacy. */\n" +
        "export const TRACK_ELEM_TYPES = " + JSON.stringify(trackElemTypes, null, 4) + " as const;\n\n" +
        "export type TrackElemName = keyof typeof TRACK_ELEM_TYPES;\n",
);

writeFileSync(
    join(genDir, "rideRatings.ts"),
    banner +
        "/** Modificateur de note (RatingsModifier, ride/RideData.h) : seuil et coefficients bruts du C++. */\n" +
        "export interface RatingsModifierData {\n    type: string;\n    threshold: number;\n    excitement: number;\n    intensity: number;\n    nausea: number;\n}\n\n" +
        "/** RideTypeDescriptor.RatingsData et ce qui sert au calcul des notes (RideRatings.cpp). Notes en centièmes. */\n" +
        "export interface RideRatingsData {\n    name: string;\n    calculation: string;\n    base: { excitement: number; intensity: number; nausea: number };\n" +
        "    unreliability: number;\n    /** -1 : abri calculé (kDynamicRideShelterRating). */\n    rideShelter: number;\n    relaxRequirementsIfInversions: boolean;\n" +
        "    modifiers: RatingsModifierData[];\n    hasAirTime: boolean;\n    hasGForces: boolean;\n" +
        "    /** RideHeights, en unités monde (8 par demi-niveau). */\n    heights: { maxHeight: number; clearanceHeight: number; vehicleZOffset: number; platformHeight: number } | null;\n}\n\n" +
        "/** Par type d'attraction (rideType). */\n" +
        "export const RIDE_RATINGS: Readonly<Record<number, RideRatingsData>> = " +
        JSON.stringify(rideRatings, null, 4) +
        ";\n\n/** Rangs des énumérations de drapeaux utiles au calcul (FlagHolder : bit = 1 << rang). */\nexport const RATING_FLAGS = " +
        JSON.stringify(ratingFlags, null, 4) +
        " as const;\n",
);

mkdirSync(join(root, "data"), { recursive: true });
writeFileSync(join(root, "data", "ride_start_piece.json"), JSON.stringify(rideTypes, null, 2) + "\n");

console.log(`${Object.keys(actionArgs).length} actions, ${rideTypes.length} types d'attractions.`);
