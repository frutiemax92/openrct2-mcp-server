// Banc de test : faux plugin + serveur MCP + client MCP en mémoire.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakePlugin, World } from "@openrct2-claude/fake-plugin";
import { Bridge } from "../src/bridge.js";
import { loadConfig } from "../src/config.js";
import { configureLog } from "../src/log.js";
import { createServer } from "../src/server.js";

export interface Harness {
    plugin: FakePlugin;
    bridge: Bridge;
    client: Client;
    userDir: string;
    call(name: string, args?: Record<string, unknown>): Promise<{ json: any; text: string[]; images: number; isError: boolean }>;
    calls: number;
    close(): Promise<void>;
}

export async function startHarness(world?: World): Promise<Harness> {
    configureLog("error", null);
    const userDir = mkdtempSync(join(tmpdir(), "openrct2-claude-"));
    const plugin = new FakePlugin({ userDir, world });
    const port = await plugin.start();
    const config = { ...loadConfig({ OPENRCT2_USER_DIR: userDir, OPENRCT2_PORT: String(port), OPENRCT2_TOKEN: plugin.token }) };
    const bridge = new Bridge({ host: "127.0.0.1", port, token: () => plugin.token, clientVersion: "test", reconnectDelayMs: 50 });
    const { server } = createServer(bridge, config);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(b);
    const h: Harness = {
        plugin,
        bridge,
        client,
        userDir,
        calls: 0,
        async call(name, args = {}) {
            h.calls++;
            const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text?: string }[]; isError?: boolean };
            const text = res.content.filter((c) => c.type === "text").map((c) => c.text!);
            let json: any = null;
            try {
                json = JSON.parse(text[0]);
            } catch {
                json = null;
            }
            return { json, text, images: res.content.filter((c) => c.type === "image").length, isError: !!res.isError };
        },
        async close() {
            bridge.stop();
            await client.close();
            await plugin.stop();
        },
    };
    return h;
}
