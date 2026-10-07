// Assemblage du serveur MCP : outils, état, instructions d'usage (SPEC 8, 9, 14).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeLike } from "./bridge.js";
import type { Config } from "./config.js";
import { Journal } from "./state/journal.js";
import { MapCache } from "./state/mapCache.js";
import { ZoneMap } from "./state/zones.js";
import type { SessionRecorder } from "./state/recorder.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerBuildTools } from "./tools/build.js";
import { registerCoasterTools } from "./tools/coasters.js";
import type { ServerState, ToolContext } from "./tools/context.js";
import { registerHistoryTools } from "./tools/history.js";
import { registerLandscapeTools } from "./tools/landscape.js";
import { registerObjectTools } from "./tools/objects.js";
import { registerObserveTools } from "./tools/observe.js";
import { registerRideTools } from "./tools/rides.js";
import { registerSceneryTools } from "./tools/scenery.js";
import { registerStaffTools } from "./tools/staff.js";
import { registerSessionTools } from "./tools/session.js";

export const SERVER_VERSION = "0.1.0";

export const INSTRUCTIONS = `Tu construis un parc dans OpenRCT2 via ces outils.

Méthode
1. Commence par session_info, puis get_park_overview, landscape_audit { image: true } et get_region_map (format text) sur la zone de travail.
2. Planifie par zones : entrée, allée principale, places, attractions, boutiques, nature. Note l'intention paysagère avec zones_paint.
3. Ordre : terrain (terrain_flatten, terrain_shape, water_create_lake) → chemins (path_build) → attractions et boutiques (ride_place) → scénerie (scenery_scatter_zone) → détails (path_add_furniture, scenery_place).
4. Avant une étape risquée : checkpoint_save. Utilise dryRun quand c'est possible.
5. Après chaque étape : get_region_map avec diff: true (ou analysis: true), puis landscape_audit. Corrige les défauts graves avant de continuer.
6. capture_view sert à juger l'ambiance, jamais à mesurer des positions ; annotate: true relie l'image aux tuiles. capture_contact_sheet montre les 4 angles en une image.
7. En cas d'échec, lis le hint, corrige la cause (terrain, propriété, objet non chargé) puis réessaie. Après deux échecs identiques, change d'approche.

Règles
- Coordonnées en tuiles ; hauteurs en niveaux (1 niveau = 1 marche de terrain). Direction : 0 = −x, 1 = +y, 2 = +x, 3 = −y.
- N'invente jamais d'identifiant d'objet : list_objects (loadedOnly) puis load_objects si besoin.
- Ne place jamais des dizaines d'arbres un par un : zones_paint puis scenery_scatter_zone (thème, seed). scenery_place sert aux accents.
- Mode sandbox (session_set_mode) pour construire vite en pause ; un parc construit ainsi est « non validé » jusqu'à un test en strict.
- Garde le parc viable : chemins connectés à l'entrée, sans impasse, files d'attente, bancs/poubelles/lampes (path_add_furniture), personnel (staff_hire), prix cohérents, attractions ouvertes.
- undo_last annule les dernières opérations ; checkpoint_restore revient plus loin (zones comprises).
- Montagne russe : coaster_create (station droite, 15 tuiles libres devant) → coaster_build_plan avec 5 à 15 macros (lift, drop, turn banked, helix…) : la fermeture vers la station est calculée → coaster_test. Corrige selon le rapport (accident, train calé, G). coaster_next_pieces et coaster_append pour le détail pièce à pièce.
- Montagne russe toute faite : coaster_list_designs (filtre query, maxSize) → coaster_place_design { design, x, y, direction, dryRun: true } puis sans dryRun → coaster_test. (x, y) = coin de l'emprise aux x et y minimaux.`;

export interface Services {
    server: McpServer;
    ctx: ToolContext;
}

export function createServer(bridge: BridgeLike, config: Config, recorder: SessionRecorder | null = null): Services {
    const server = new McpServer({ name: "openrct2", version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
    const state: ServerState = { mode: "unknown", validated: true, captureCounter: 0, lastSnapshot: null, checkpoints: new Map(), zones: new ZoneMap() };
    const ctx: ToolContext = { bridge, cache: new MapCache(bridge), journal: new Journal(), config, state, recorder };
    bridge.on("event:map_changed", () => {
        state.lastSnapshot = null;
        state.mode = "unknown";
        // Une restauration de checkpoint recharge ensuite les zones depuis ses métadonnées.
        state.zones.clear();
    });
    registerSessionTools(server, ctx);
    registerObjectTools(server, ctx);
    registerObserveTools(server, ctx);
    registerBuildTools(server, ctx);
    registerRideTools(server, ctx);
    registerHistoryTools(server, ctx);
    registerLandscapeTools(server, ctx);
    registerSceneryTools(server, ctx);
    registerAuditTools(server, ctx);
    registerStaffTools(server, ctx);
    registerCoasterTools(server, ctx);
    return { server, ctx };
}
