// Boîte d'envoi du plugin vers le serveur MCP (SPEC 13.7). Le plugin n'a pas accès au disque : les styles et les
// demandes Magic Fill attendent ici que le serveur les prenne (`inbox.take`), les range sur disque et les acquitte
// (`inbox.ack`). Les styles sont aussi gardés dans `sharedStorage` (plugin.store.json) pour survivre à un
// redémarrage du jeu quand aucun serveur n'est connecté ; les demandes Magic Fill, éphémères, restent en mémoire.

import {
    STYLE_CLEAR_STORAGE_KEY,
    STYLE_MAX_PENDING,
    STYLE_PENDING_STORAGE_KEY,
    type InboxEvent,
    type MagicFillRequest,
    type MagicFillStatus,
    type StyleRecord,
} from "@openrct2-claude/protocol";
import { log } from "../util";

let styles: StyleRecord[] | null = null;
const fills: MagicFillRequest[] = [];
const fillStatus: { [id: string]: { status: MagicFillStatus; message: string } } = {};
let notifier: ((data: InboxEvent) => void) | null = null;
const listeners: (() => void)[] = [];
let clearRequested: boolean | null = null;
/** Résultat du dernier « Clear all styles » traité par le serveur (affiché par le Style Picker). */
let clearNotice = "";

function loadClear(): boolean {
    if (clearRequested === null) clearRequested = context.sharedStorage.get<boolean>(STYLE_CLEAR_STORAGE_KEY) === true;
    return clearRequested;
}

function setClear(v: boolean): void {
    clearRequested = v;
    try {
        context.sharedStorage.set(STYLE_CLEAR_STORAGE_KEY, v);
    } catch (e) {
        log(`demande d'effacement non enregistrée : ${e}`);
    }
}

function loadStyles(): StyleRecord[] {
    if (styles === null) {
        const stored = context.sharedStorage.get<StyleRecord[]>(STYLE_PENDING_STORAGE_KEY);
        styles = Array.isArray(stored) ? stored : [];
    }
    return styles;
}

function persist(): void {
    try {
        context.sharedStorage.set(STYLE_PENDING_STORAGE_KEY, loadStyles());
    } catch (e) {
        log(`styles en attente non enregistrés : ${e}`);
    }
}

function changed(): void {
    for (const l of listeners) {
        try {
            l();
        } catch (e) {
            log(`fenêtre : ${e}`);
        }
    }
    notifier?.(counts());
}

let connectedProbe: () => boolean = () => false;

/** main.ts : un serveur MCP authentifié est-il connecté ? (affiché dans les fenêtres) */
export function setConnectedProbe(fn: () => boolean): void {
    connectedProbe = fn;
}

export function serverConnected(): boolean {
    return connectedProbe();
}

/** Prévient les fenêtres (connexion ou déconnexion du serveur). */
export function refresh(): void {
    changed();
}

/** Fonction appelée à chaque nouvel élément (main.ts : événement `inbox` vers le serveur connecté). */
export function setNotifier(fn: (data: InboxEvent) => void): void {
    notifier = fn;
}

/** Les fenêtres se réabonnent à leur ouverture et se désabonnent à leur fermeture. */
export function onInboxChange(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
    };
}

export function counts(): InboxEvent {
    return { styles: loadStyles().length, fills: fills.length, clearStyles: loadClear() || undefined };
}

/**
 * Bouton « Clear all styles » : les styles en attente sont oubliés tout de suite, la base du serveur est vidée à la
 * prochaine prise (`inbox.take` → `clearStyles`), avant les styles sauvés après le clic. Persisté : survit à la
 * fermeture du jeu sans serveur.
 */
export function requestClearAll(): number {
    const s = loadStyles();
    const dropped = s.length;
    s.splice(0, s.length);
    persist();
    setClear(true);
    clearNotice = "";
    changed();
    return dropped;
}

export function clearPending(): boolean {
    return loadClear();
}

export function lastClearNotice(): string {
    return clearNotice;
}

export function canQueueStyle(): boolean {
    return loadStyles().length < STYLE_MAX_PENDING;
}

export function addStyle(record: StyleRecord): void {
    loadStyles().push(record);
    persist();
    changed();
}

export function addFill(req: MagicFillRequest): void {
    fills.push(req);
    fillStatus[req.id] = { status: "pending", message: "En attente de Claude." };
    changed();
}

/** Au plus un style par appel (taille), toutes les demandes Magic Fill. */
export function take(): { styles: StyleRecord[]; fills: MagicFillRequest[]; remaining: InboxEvent; clearStyles?: boolean } {
    const s = loadStyles();
    return {
        styles: s.slice(0, 1),
        fills: fills.slice(),
        remaining: { styles: Math.max(0, s.length - 1), fills: 0 },
        clearStyles: loadClear() || undefined,
    };
}

export function ack(styleIds: string[], fillIds: string[], clearedStyles?: number): number {
    let removed = 0;
    if (typeof clearedStyles === "number" && loadClear()) {
        setClear(false);
        clearNotice = `{GREEN}Cleared ${clearedStyles} stored style(s).`;
        removed++;
    }
    const s = loadStyles();
    for (let i = s.length - 1; i >= 0; i--) {
        if (styleIds.indexOf(s[i].id) >= 0) {
            s.splice(i, 1);
            removed++;
        }
    }
    if (removed) persist();
    for (let i = fills.length - 1; i >= 0; i--) {
        if (fillIds.indexOf(fills[i].id) >= 0) {
            const id = fills[i].id;
            fills.splice(i, 1);
            removed++;
            if (fillStatus[id]?.status === "pending") fillStatus[id] = { status: "received", message: "Reçue par le serveur MCP : demande à Claude de la traiter." };
        }
    }
    if (removed) changed();
    return removed;
}

export function setFillStatus(id: string, status: MagicFillStatus, message: string): boolean {
    const known = fillStatus[id] !== undefined;
    fillStatus[id] = { status, message };
    changed();
    return known;
}

export function fillStatusOf(id: string): { status: MagicFillStatus; message: string } | null {
    return fillStatus[id] ?? null;
}
