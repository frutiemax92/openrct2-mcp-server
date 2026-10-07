// Validation des arguments de game actions à partir de la table générée depuis le C++ (SPEC F5, F6).

import { ACTION_ARGS } from "./generated/actionArgs.js";

export interface ActionArgSpec {
    name: string;
    type: "int" | "bool" | "string";
}

export function actionArgSpecs(action: string): ActionArgSpec[] | null {
    const raw = ACTION_ARGS[action];
    if (!raw) return null;
    return raw.map((k) => {
        const [name, type] = k.split(":");
        return { name, type: (type ?? "int") as ActionArgSpec["type"] };
    });
}

export interface ActionArgsCheck {
    known: boolean;
    missing: string[];
    wrongType: string[];
    expected: string[];
}

/** Toutes les clés sont obligatoires ; le jeu lève « Invalid action parameters. » sinon. */
export function checkActionArgs(action: string, args: Record<string, unknown>): ActionArgsCheck {
    const specs = actionArgSpecs(action);
    if (!specs) return { known: false, missing: [], wrongType: [], expected: [] };
    const missing: string[] = [];
    const wrongType: string[] = [];
    for (const s of specs) {
        const v = args[s.name];
        if (v === undefined || v === null) {
            missing.push(s.name);
            continue;
        }
        const ok =
            s.type === "bool" ? typeof v === "boolean" : s.type === "string" ? typeof v === "string" : typeof v === "number" && Number.isFinite(v);
        if (!ok) wrongType.push(`${s.name} (${s.type})`);
    }
    return { known: true, missing, wrongType, expected: specs.map((s) => `${s.name}:${s.type}`) };
}
