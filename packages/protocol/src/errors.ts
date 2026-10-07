// Erreurs normalisées (SPEC 6.9).

export const ERROR_CODES = [
    "INVALID_PARAMS",
    "NOT_FOUND",
    "OBJECT_NOT_LOADED",
    "NOT_OWNED",
    "OBSTRUCTED",
    "BAD_SLOPE",
    "INSUFFICIENT_FUNDS",
    "GAME_ACTION_FAILED",
    "NOT_SUPPORTED_IN_MODE",
    "NOT_CONNECTED",
    "BUSY",
    "TIMEOUT",
    "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface BridgeError {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    /** Écrit par nous, pas par le jeu : guide vers la correction. */
    hint?: string;
}

/** `GameActions::Status` (actions/GameActionResult.h). */
export const GAME_STATUS = {
    ok: 0,
    invalidParameters: 1,
    disallowed: 2,
    gamePaused: 3,
    insufficientFunds: 4,
    notInEditorMode: 5,
    notOwned: 6,
    tooLow: 7,
    tooHigh: 8,
    noClearance: 9,
    itemAlreadyPlaced: 10,
    notClosed: 11,
    broken: 12,
    noFreeElements: 13,
} as const;

export interface GameErrorInfo {
    error: number;
    errorTitle?: string;
    errorMessage?: string;
}

// Les messages du jeu sont localisés : les mots-clés ne sont qu'un repli quand le statut est trop générique.
const OWNERSHIP_WORDS = /own|possé|propri/i;
const SLOPE_WORDS = /slope|pente|steep|raide|level|niveau/i;
const CLEARANCE_WORDS = /in the way|gêne|bloque|occup|already/i;

/** Traduit un résultat d'action du jeu en erreur normalisée, avec un hint. */
export function gameErrorToBridgeError(action: string, r: GameErrorInfo, extra?: Record<string, unknown>): BridgeError {
    const text = `${r.errorTitle ?? ""} ${r.errorMessage ?? ""}`.trim();
    const details: Record<string, unknown> = {
        action,
        gameError: r.error,
        gameTitle: r.errorTitle,
        gameMessage: r.errorMessage,
        ...extra,
    };
    const message = text || `L'action ${action} a échoué (code ${r.error}).`;
    switch (r.error) {
        case GAME_STATUS.invalidParameters:
            return { code: "INVALID_PARAMS", message, details, hint: "Vérifie les paramètres (objet chargé, identifiant d'attraction, coordonnées dans la carte)." };
        case GAME_STATUS.insufficientFunds:
            return { code: "INSUFFICIENT_FUNDS", message, details, hint: "Augmente le prêt (park_configure) ou passe en mode sandbox (session_set_mode)." };
        case GAME_STATUS.notOwned:
            return { code: "NOT_OWNED", message, details, hint: "Utilise land_set_ownership sur la zone, ou active le mode sandbox." };
        case GAME_STATUS.noClearance:
        case GAME_STATUS.itemAlreadyPlaced:
            return { code: "OBSTRUCTED", message, details, hint: "Quelque chose occupe déjà la place : inspect_tile, puis scenery_remove/path_remove, ou choisis une autre tuile." };
        case GAME_STATUS.tooLow:
        case GAME_STATUS.tooHigh:
            return { code: "BAD_SLOPE", message, details, hint: "Hauteur hors limites : ajuste le terrain (terrain_flatten) ou le niveau demandé." };
        case GAME_STATUS.gamePaused:
            return { code: "GAME_ACTION_FAILED", message, details, hint: "Construction impossible en pause : reprends le temps (session_set_paused) ou passe en mode sandbox (buildInPauseMode)." };
        case GAME_STATUS.notInEditorMode:
            return { code: "NOT_SUPPORTED_IN_MODE", message, details, hint: "Cette action exige l'éditeur ou le mode sandbox : session_set_mode({ mode: 'sandbox' })." };
        case GAME_STATUS.notClosed:
            return { code: "GAME_ACTION_FAILED", message, details, hint: "Ferme d'abord l'attraction (ride_set_status closed)." };
        case GAME_STATUS.noFreeElements:
            return { code: "GAME_ACTION_FAILED", message, details, hint: "Limite d'éléments de la tuile ou de la carte atteinte." };
    }
    if (OWNERSHIP_WORDS.test(text)) {
        return { code: "NOT_OWNED", message, details, hint: "Utilise land_set_ownership sur la zone, ou active le mode sandbox." };
    }
    if (CLEARANCE_WORDS.test(text)) {
        return { code: "OBSTRUCTED", message, details, hint: "Quelque chose occupe déjà la place : inspect_tile pour voir quoi." };
    }
    if (SLOPE_WORDS.test(text)) {
        return { code: "BAD_SLOPE", message, details, hint: "Terrain trop pentu ou mauvaise hauteur : terrain_flatten sur la zone." };
    }
    return { code: "GAME_ACTION_FAILED", message, details };
}

export function bridgeError(code: ErrorCode, message: string, extra?: { details?: Record<string, unknown>; hint?: string }): BridgeError {
    return { code, message, ...extra };
}

export class BridgeException extends Error {
    constructor(public readonly error: BridgeError) {
        super(error.message);
        this.name = "BridgeException";
    }
}
