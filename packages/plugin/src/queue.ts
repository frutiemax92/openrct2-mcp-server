// File de commandes et budget par pompe (SPEC 6.3, ADR 0002).
//
// Chaque requête est un générateur : chaque `yield` marque la fin d'une opération élémentaire.
// La pompe (context.setInterval, appelée à chaque frame, même en pause) avance les requêtes dans
// l'ordre d'arrivée, jusqu'à K opérations ou T millisecondes. Un `yield` de type `Wait` suspend la
// requête jusqu'à ce que le callback du jeu ait été appelé.

import { LIMITS, type BridgeError } from "@openrct2-claude/protocol";
import { fail, log, now, toBridgeError } from "./util";

export interface Wait {
    /** Suspend la requête jusqu'à `done` (callback d'une game action). */
    wait?: { done: boolean };
    /** Rend la main jusqu'à la frame suivante. */
    frame?: true;
}

export const NEXT_FRAME: Wait = { frame: true };

export type Job = Generator<Wait | undefined, unknown, unknown>;

export interface Responder {
    ok(id: string, result: unknown): void;
    error(id: string, error: BridgeError): void;
}

interface Pending {
    id: string;
    method: string;
    job: Job;
    deadline: number;
    waiting: { done: boolean } | null;
    responder: Responder;
}

export const budget = {
    maxOps: 20,
    maxMs: 4,
};

const queue: Pending[] = [];

export function pendingCount(): number {
    return queue.length;
}

export function enqueue(id: string, method: string, job: Job, responder: Responder, timeoutMs: number = LIMITS.requestTimeoutMs): void {
    if (queue.length >= LIMITS.maxQueuedRequests) {
        fail("BUSY", `File pleine (${queue.length} requêtes en attente).`);
    }
    queue.push({ id, method, job, deadline: now() + timeoutMs, waiting: null, responder });
}

/** Vide la file (changement de carte, déconnexion). */
export function flush(code: "BUSY" | "INTERNAL", message: string, onlyResponder?: Responder): void {
    for (let i = queue.length - 1; i >= 0; i--) {
        const p = queue[i];
        if (onlyResponder && p.responder !== onlyResponder) continue;
        queue.splice(i, 1);
        try {
            p.job.return(undefined);
        } catch {
            // ignoré
        }
        p.responder.error(p.id, { code, message });
    }
}

export function pump(): void {
    if (queue.length === 0) return;
    const start = now();
    let ops = 0;
    while (queue.length > 0 && ops < budget.maxOps && now() - start < budget.maxMs) {
        const p = queue[0];
        if (now() > p.deadline) {
            queue.shift();
            try {
                p.job.return(undefined);
            } catch {
                // ignoré
            }
            p.responder.error(p.id, { code: "TIMEOUT", message: `Délai dépassé pour ${p.method}.` });
            continue;
        }
        if (p.waiting && !p.waiting.done) break;
        p.waiting = null;
        let step: IteratorResult<Wait | undefined, unknown>;
        try {
            step = p.job.next();
        } catch (e) {
            queue.shift();
            const err = toBridgeError(e);
            if (err.code === "INTERNAL") log(`${p.method} : ${err.message}`);
            p.responder.error(p.id, err);
            continue;
        }
        ops++;
        if (step.done) {
            queue.shift();
            p.responder.ok(p.id, step.value);
        } else if (step.value && step.value.wait) {
            p.waiting = step.value.wait;
        } else if (step.value && step.value.frame) {
            break;
        }
    }
}

/** Transforme une fonction synchrone en job d'une opération. */
export function* syncJob(fn: () => unknown): Job {
    return fn();
}
