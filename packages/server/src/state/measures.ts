// Mesures des essais de montagnes russes (COASTER_REFERENCE P2), par attraction, dans
// <dossier utilisateur>/claude-coaster-measures.json : coaster_compare les réutilise tant que le circuit n'a pas changé.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CoasterMeasure } from "../planners/compare.js";

export class MeasureStore {
    private readonly byRide = new Map<number, CoasterMeasure>();

    constructor(private readonly file: string | null) {
        if (file && existsSync(file)) {
            try {
                for (const m of JSON.parse(readFileSync(file, "utf8")) as CoasterMeasure[]) this.byRide.set(m.rideId, m);
            } catch {
                // Fichier illisible : on repart de zéro.
            }
        }
    }

    static inUserDir(userDir: string): MeasureStore {
        return new MeasureStore(join(userDir, "claude-coaster-measures.json"));
    }

    /** Dernière mesure de l'attraction, seulement si elle porte sur ce circuit. */
    get(rideId: number, fingerprint: string): CoasterMeasure | undefined {
        const m = this.byRide.get(rideId);
        return m && m.fingerprint === fingerprint ? m : undefined;
    }

    /** Dernière mesure de l'attraction, quel que soit son circuit (train, par exemple). */
    latest(rideId: number): CoasterMeasure | undefined {
        return this.byRide.get(rideId);
    }

    set(m: CoasterMeasure): void {
        this.byRide.set(m.rideId, m);
        if (!this.file) return;
        try {
            writeFileSync(this.file, JSON.stringify([...this.byRide.values()]));
        } catch {
            // Écriture impossible : la mesure reste en mémoire.
        }
    }
}
