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
- Montagne russe : coaster_find_site (site vide de la bonne taille, eau comprise) → coaster_create (station droite, 15 tuiles libres devant) → coaster_build_plan (macros lift, drop, turn, helix, inversion…) : la fermeture vers la station est calculée → coaster_test. Corrige selon le rapport (accident, train calé, G). coaster_next_pieces et coaster_append pour le détail pièce à pièce.
- Vitesse : chaque élément a sa plage de vitesse. coaster_build_plan renvoie speeds (entrée, sortie, minimum par macro, en km/h) et avertit d'un CALAGE ou d'un élément TROP RAPIDE / TROP LENT par rapport aux designs RCT2. Corrige avant de construire : au pied d'une grande chute, le train est trop rapide pour un zero-g roll, un tire-bouchon ou un virage serré ; place d'abord une colline (hill), une grande boucle ou une montée, et garde les petits éléments pour la fin du parcours. Lis les speeds de chaque dryRun. G : speeds.gForces prédit les G du jeu (même calcul que GetGForces). Les G latéraux s'ajoutent tels quels à l'intensité, et au-delà de 2,8 G elle prend +3,75 (+12,25 au-delà de 3,1) : un virage plat serré (turn small sans banked) pris à plus de ~60 km/h, même juste avant les freins d'arrivée, met l'intensité dans le rouge. Prends les virages rapides banked ou plus larges, et lis tout avertissement G LATÉRAUX.
- Comparer à une référence : lance d'abord coaster_test sur la référence (notes, longueur, vitesses et G mesurés par pièce), puis vise ces chiffres. coaster_test recale aussi le modèle de vitesse.
- Montagne russe « dans le style de X » : coaster_describe { design: 'X' } (ou { ride } si X est dans le parc) AVANT de construire. Reprends son type (même objet de véhicule), sa longueur (pièces, lengthTiles), son emprise et sa densité, et l'ordre de ses éléments. Ensuite :
  · Compacité et longueur (aussi importantes que les notes) : lis space, suggestedBounds et target de la référence. Ne choisis pas le site à l'œil : coaster_find_site { reference: { ride | design, longer, taller } } cherche sur toute la carte un rectangle vide de cette taille (lac compris : la piste passe au-dessus de l'eau, bonus de proximité) et donne la station (coaster_create) et bounds ; un site coincé entre d'autres attractions fait échouer la fermeture. Passe bounds { x1, y1, x2, y2 } et reference { ride | design } dès le premier coaster_build_plan (ils restent en vigueur, fermeture comprise ; reference: null est refusé). « Comme X, mais plus haut / plus rapide / plus long / à N trains » : reference { ride, taller: niveaux, faster: km/h, longer: %, trains: total } ; la fermeture est refusée si l'écart n'est pas atteint, et HAUTEUR / VITESSE avertissent dès le lift posé. La même longueur de piste dans la même emprise, c'est la densité de la référence : suis target.remainingTiles à chaque appel ; la fermeture est refusée sous 90 % de la longueur ou avec moins de trains. Ne remplis pas avec des droites : hélices, virages en pente, passages sous le lift. Pose la station sur un bord, mais pas le lift : laisse de la place des deux côtés du lift, car la seconde moitié du parcours passe dessous, puis sous la première chute et à travers les grandes inversions. Corrige chaque avertissement ISOLÉ tout de suite, et vise la couverture et les tuiles empilées de la référence (space de coaster_build_plan, spaceLevers de coaster_compare).
  · Lift droit : lift { height } en une seule macro. Un lift 25° monte d'1 niveau par tuile (Frightmare : 19 pièces pour 18 niveaux) ; ne le replie pas en virage pour gagner de la place.
  · La compacité vient du reste du tracé : il s'enroule autour et sous le lift, se croise à 3 niveaux d'écart ou plus, et descend en spirales (turn banked slope 'down' répété, helix large). Surélève la station (coaster_create level) si le tracé doit plonger sous son niveau.
  · Grandes inversions : inversion { kind: loop|immelmann|dive_loop|corkscrew|zero_g_roll|barrel_roll, dir } prend la plus grande taille disponible ; loop seul est une petite boucle. Les inversions dépendent du type de piste : lis inversions (list_objects) ou le résumé de coaster_describe avant de changer de type. Le bois (wooden_roller_coaster, classic_wooden_roller_coaster) a la boucle verticale (small/medium/large) : une boucle ne justifie pas de quitter le bois. Chute vrillée : turn { slope: 'steep_down' }.
  · Verticalité : après la première chute, remonte haut sur l'élan comme la référence. dive { dir, turn } = demi-boucle puis quart de boucle vers la verticale descendante (première inversion de Frightmare) ; quarter_loop { exit: 'corkscrew', dir } = montée verticale, quart de boucle sur le dos, sortie en tire-bouchon ; vertical_drop { height, turn }. Lis relief et reliefLevers de coaster_describe / coaster_compare : pièces à 90°, éléments hauts, point haut par cinquième du parcours.
  · Rayon et vitesse : après une grande chute ou une inversion, turn medium/large banked ou helix large ; small seulement à basse vitesse (fin de parcours).
  · Sections de bloc : layout.blocks donne les limites de section (station, sommets de lift, freins de bloc) et les trains permis (sections − 1). Reprends celles de la référence (Frightmare : lift, 2 freins de bloc, station → 3 trains) avec block_brakes, sur du plat en hauteur et assez long pour le train, après le premier lift (avant lui, seulement collé au pied de la chaîne, avec la longueur du train entre la station et le frein). Le dernier frein de bloc va au bout des freins d'arrivée en gare (brakes puis block_brakes) ; n'en pose pas deux près l'un de l'autre, le second n'ajoute presque rien. Puis ride_configure { trains }, attraction fermée.
  · Impasse : si coaster_build_plan ou coaster_search_section signale exitBlocked (obstacle juste devant le bout du circuit : chemin, file d'attente, autre attraction), élargir bounds ou relancer ne sert à rien. coaster_undo le dernier élément (souvent la première chute) et refais-le pour qu'il débouche sur des tuiles libres, ou retire l'obstacle.
  · Un grand circuit (80 à 120 pièces) se construit en plusieurs coaster_build_plan close: false de 10 à 20 macros, en lisant layout et warnings à chaque étape, puis plan: [] close: true.
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
