// Phase 3 contre le vrai jeu (SPEC 1.3, critère « Montagnes russes ») : 10 circuits différents sur terrain plat,
// chacun créé, construit par macros, refermé par A*, testé puis démoli. Réussite = fermé, testé, sans accident ni calage.
//   OPENRCT2_USER_DIR=.userdata OPENRCT2_INTEGRATION=1 npx vitest run test/integration/coaster.test.ts
// Zone : OPENRCT2_IT_COASTER_AREA="x,y" (centre, défaut 50,40 ; ~30×30 tuiles libres et plates). Objet : OPENRCT2_IT_COASTER.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DIRECTION_DELTA } from "@openrct2-claude/protocol";
import { Bridge } from "../../src/bridge.js";
import { loadConfig, readToken } from "../../src/config.js";
import { configureLog } from "../../src/log.js";
import { createServer } from "../../src/server.js";

const [CX, CY] = (process.env.OPENRCT2_IT_COASTER_AREA ?? "50,40").split(",").map(Number);
const OBJECT = process.env.OPENRCT2_IT_COASTER ?? "rct2.ride.arrt1";
const CHECKPOINT = "it-p3-start";

const PLANS: Record<string, unknown>[][] = [
    [{ op: "straight", length: 1 }, { op: "lift", height: 8 }, { op: "turn", dir: "left", banked: true, quarters: 2 }, { op: "drop", height: 7, steep: true }],
    [{ op: "straight", length: 2 }, { op: "lift", height: 10 }, { op: "turn", dir: "right", banked: true, quarters: 2 }, { op: "drop", height: 9, steep: true }, { op: "helix", dir: "left", quarters: 2 }],
    [{ op: "lift", height: 6 }, { op: "turn", dir: "left", banked: true, size: "small" }, { op: "drop", height: 5 }],
    [{ op: "lift", height: 12 }, { op: "drop", height: 11, steep: true }, { op: "climb", height: 4 }, { op: "turn", dir: "right", banked: true, quarters: 2 }, { op: "drop", height: 4 }],
    [{ op: "straight", length: 1 }, { op: "lift", height: 9 }, { op: "turn", dir: "left", banked: true }, { op: "s_bend", dir: "right" }, { op: "drop", height: 8 }],
    [{ op: "lift", height: 10 }, { op: "turn", dir: "right", banked: true, quarters: 2 }, { op: "drop", height: 9, steep: true }, { op: "loop", dir: "left" }],
    [{ op: "lift", height: 7 }, { op: "turn", dir: "left", banked: true }, { op: "helix", dir: "right", quarters: 4, size: "large" }],
    [{ op: "lift", height: 11 }, { op: "turn", dir: "left", banked: true, quarters: 2 }, { op: "drop", height: 6 }, { op: "turn", dir: "left", banked: true }, { op: "drop", height: 4 }],
    [{ op: "straight", length: 1 }, { op: "lift", height: 8 }, { op: "s_bend", dir: "left" }, { op: "turn", dir: "right", banked: true, quarters: 2 }, { op: "drop", height: 7 }],
    [{ op: "lift", height: 14 }, { op: "turn", dir: "left", banked: true, quarters: 2 }, { op: "drop", height: 13, steep: true }, { op: "climb", height: 5 }, { op: "turn", dir: "left", banked: true }, { op: "drop", height: 5 }],
];

let bridge: Bridge;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
    const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text?: string }[]; isError?: boolean };
    const text = res.content.find((c) => c.type === "text")?.text ?? "";
    let json: any = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }
    return { json, text, isError: !!res.isError };
}

beforeAll(async () => {
    configureLog("error", null);
    const config = loadConfig();
    bridge = new Bridge({ host: config.host, port: config.port, token: () => readToken(config.userDir) ?? config.token, clientVersion: "integration" });
    const { server } = createServer(bridge, config);
    bridge.start();
    await bridge.ensureConnected();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    client = new Client({ name: "integration", version: "0" });
    await client.connect(b);
    await call("checkpoint_save", { name: CHECKPOINT });
    await call("session_set_mode", { mode: "sandbox" });
}, 30_000);

afterAll(async () => {
    await call("checkpoint_restore", { name: CHECKPOINT }).catch(() => undefined);
    bridge?.stop();
    await client?.close();
});

describe("montagnes russes (Phase 3)", () => {
    it("au moins 8 circuits sur 10 fermés, testés, sans accident", async () => {
        const outcomes: Record<string, unknown>[] = [];
        for (let i = 0; i < PLANS.length; i++) {
            const dir = i % 4;
            // Station centrée sur la zone, orientée selon dir.
            const x = CX - DIRECTION_DELTA[dir].x * 3;
            const y = CY - DIRECTION_DELTA[dir].y * 3;
            const created = await call("coaster_create", { object: OBJECT, x, y, direction: dir, stationLength: 6, connectToPath: false });
            if (created.isError) {
                outcomes.push({ i, step: "create", error: created.text.slice(0, 200) });
                continue;
            }
            const ride = created.json.rideId;
            const built = await call("coaster_build_plan", { ride, plan: PLANS[i] });
            let test: any = null;
            if (!built.isError) test = (await call("coaster_test", { ride })).json;
            outcomes.push({
                i,
                dir,
                closed: built.json?.closed ?? false,
                build: built.isError ? built.text.slice(0, 240) : built.json.summary,
                tested: test?.tested ?? false,
                crashed: test?.crashed ?? null,
                stalled: test?.stalled ?? null,
                ratings: test?.ratings,
                latG: test?.stats?.maxLatG,
            });
            await call("ride_demolish", { ride });
        }
        console.log(JSON.stringify(outcomes, null, 1));
        const ok = outcomes.filter((o) => o.closed && o.tested && !o.crashed && !o.stalled).length;
        expect(ok).toBeGreaterThanOrEqual(8);
    }, 600_000);
});
