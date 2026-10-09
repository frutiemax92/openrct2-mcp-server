import { beforeEach, describe, expect, it } from "vitest";
import { blackWidowPlus } from "./black-widow-plus.js";

describe("searchSection, retour vers la station", () => {
    // Les recherches bloquent la boucle d'événements : rendre la main entre deux tests laisse vitest traiter ses réponses
    // RPC, sinon les blocages s'additionnent et onTaskUpdate expire (60 s).
    beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    it("ramène le faisceau large vers la station (Black Widow Plus de Haiku, 8 octobre 2026)", () => {
        // Sans terme de retour, les 90 branches avaient la longueur à 20-30 tuiles de la station et mouraient au plafond
        // de longueur : 9 fermetures tentées, aucune variante.
        const res = blackWidowPlus(90, 1);
        expect(res.passes).toBe(1);
        expect(res.candidates.length).toBe(1);
        expect(res.candidates[0].layout.blocks.maxTrains).toBeGreaterThanOrEqual(3);
        expect(res.candidates[0].layout.lengthTiles).toBeGreaterThanOrEqual(183);
    }, 120_000);
});
