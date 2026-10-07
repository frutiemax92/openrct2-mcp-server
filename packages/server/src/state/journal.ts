// Journal d'opérations (SPEC 8.6) : chaque outil d'écriture enregistre son inverse pour undo_last.

import type { MethodName, MethodParams } from "@openrct2-claude/protocol";

export interface InverseOp<M extends MethodName = MethodName> {
    method: M;
    params: MethodParams<M>;
}

export interface JournalEntry {
    id: number;
    tool: string;
    summary: string;
    params: unknown;
    inverse: InverseOp[];
    /** Raison si l'opération ne peut pas être annulée. */
    irreversible?: string;
    cost: number;
    timestamp: string;
}

const MAX_ENTRIES = 500;

export class Journal {
    private entries: JournalEntry[] = [];
    private nextId = 1;

    record(e: Omit<JournalEntry, "id" | "timestamp">): JournalEntry {
        const entry: JournalEntry = { ...e, id: this.nextId++, timestamp: new Date().toISOString() };
        this.entries.push(entry);
        if (this.entries.length > MAX_ENTRIES) this.entries.shift();
        return entry;
    }

    /** Retire et renvoie les n dernières entrées (la plus récente d'abord). */
    pop(n: number): JournalEntry[] {
        const out: JournalEntry[] = [];
        while (n-- > 0 && this.entries.length > 0) out.push(this.entries.pop() as JournalEntry);
        return out;
    }

    peek(n: number): JournalEntry[] {
        return this.entries.slice(-n).reverse();
    }

    clear(): void {
        this.entries = [];
    }

    get length(): number {
        return this.entries.length;
    }

    toJSON(): JournalEntry[] {
        return this.entries;
    }

    load(entries: JournalEntry[]): void {
        this.entries = entries.slice(-MAX_ENTRIES);
        this.nextId = Math.max(0, ...entries.map((e) => e.id)) + 1;
    }
}
