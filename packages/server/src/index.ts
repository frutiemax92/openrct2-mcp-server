#!/usr/bin/env node
// Point d'entrée : serveur MCP sur stdio (SPEC 8.1).

import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Bridge } from "./bridge.js";
import { loadConfig, readToken } from "./config.js";
import { configureLog, log } from "./log.js";
import { createServer, SERVER_VERSION } from "./server.js";
import { SessionRecorder } from "./state/recorder.js";

async function main(): Promise<void> {
    const config = loadConfig();
    configureLog(config.logLevel, config.logFile);
    const recorder = process.env.OPENRCT2_RECORD_DIR ? new SessionRecorder(join(process.env.OPENRCT2_RECORD_DIR, `session-${config.sessionId}.jsonl`)) : null;
    const bridge = new Bridge({
        host: config.host,
        port: config.port,
        token: () => readToken(config.userDir) ?? config.token,
        clientVersion: `openrct2-mcp/${SERVER_VERSION}`,
    });
    const { server } = createServer(bridge, config, recorder);
    bridge.start();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.info("serveur MCP démarré", { version: SERVER_VERSION, host: config.host, port: config.port, userDir: config.userDir });
    const shutdown = () => {
        bridge.stop();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((e) => {
    log.error("échec du démarrage", { message: e instanceof Error ? e.message : String(e) });
    process.exit(1);
});
