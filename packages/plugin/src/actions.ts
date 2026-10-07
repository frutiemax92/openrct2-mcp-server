// Appel des game actions : try/catch systématique (exception synchrone si une clé manque, SPEC F5)
// et attente du callback (synchrone pour queryAction ; supposé possiblement asynchrone pour executeAction).

import { checkActionArgs, gameErrorToBridgeError, type ActionOutcome, type BridgeError } from "@openrct2-claude/protocol";
import type { Wait } from "./queue";

export interface RawResult {
    error: number;
    errorTitle?: string;
    errorMessage?: string;
    cost?: number;
    position?: CoordsXYZ;
    ride?: number;
    peep?: number;
    bannerIndex?: number;
    [key: string]: unknown;
}

export interface ActResult {
    ok: boolean;
    cost: number;
    raw: RawResult | null;
    error?: BridgeError;
}

function invalidParams(action: string, args: Record<string, unknown>, e: unknown): BridgeError {
    const check = checkActionArgs(action, args);
    const message = String(e instanceof Error ? e.message : e);
    if (/Unknown action/i.test(message)) {
        return { code: "INVALID_PARAMS", message: `Action inconnue : ${action}.` };
    }
    return {
        code: "INVALID_PARAMS",
        message: `${action} : ${message}`,
        details: { action, missing: check.missing, wrongType: check.wrongType, expected: check.expected },
        hint: "Toutes les clés listées dans 'expected' sont obligatoires, avec le type exact.",
    };
}

/**
 * Lance une action (query si dryRun) et rend la main jusqu'au callback.
 * À utiliser avec `yield*` dans un job.
 */
export function* act(action: string, args: Record<string, unknown>, dryRun: boolean, extra?: Record<string, unknown>): Generator<Wait, ActResult, unknown> {
    const box: { done: boolean; result: RawResult | null } = { done: false, result: null };
    const callback = (r: GameActionResult) => {
        box.done = true;
        box.result = r as unknown as RawResult;
    };
    try {
        if (dryRun) context.queryAction(action, args, callback);
        else context.executeAction(action, args, callback);
    } catch (e) {
        return { ok: false, cost: 0, raw: null, error: invalidParams(action, args, e) };
    }
    while (!box.done) {
        yield { wait: box };
    }
    const r = box.result as RawResult;
    if (!r || r.error !== 0) {
        return { ok: false, cost: 0, raw: r, error: gameErrorToBridgeError(action, r ?? { error: -1 }, extra) };
    }
    return { ok: true, cost: typeof r.cost === "number" ? r.cost : 0, raw: r };
}

export function outcome(r: ActResult): ActionOutcome {
    return r.ok ? { ok: true, cost: r.cost } : { ok: false, cost: 0, error: r.error };
}
