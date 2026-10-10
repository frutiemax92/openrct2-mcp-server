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
3. Ordre : terrain (seulement si l'utilisateur l'a permis, voir Règles) → chemins (path_build) → attractions et boutiques (ride_place) → scénerie (scenery_scatter_zone) → détails (path_add_furniture, scenery_place).
4. Avant une étape risquée : checkpoint_save. Utilise dryRun quand c'est possible.
5. Après chaque étape : get_region_map avec diff: true (ou analysis: true), puis landscape_audit. Corrige les défauts graves avant de continuer.
6. capture_view sert à juger l'ambiance, jamais à mesurer des positions ; annotate: true relie l'image aux tuiles. capture_contact_sheet montre les 4 angles en une image.
7. En cas d'échec, lis le hint, corrige la cause (terrain, propriété, objet non chargé) puis réessaie. Après deux échecs identiques, change d'approche.

Règles
- Relief : ne modifie jamais le terrain (hauteurs, pentes, eau, surface) sans que l'utilisateur le demande ou l'accepte. Par défaut, adapte-toi au terrain : autre site, level, passerelle ; une montagne russe passe au-dessus du relief ou en tunnel dessous (une pièce entière sous la surface), sans le toucher. Si l'utilisateur le permet : session_set_landscape { allowed: true, userRequest } avant terrain_flatten, terrain_set_surface, terrain_shape ou water_create_lake.
- Coordonnées en tuiles ; hauteurs en niveaux (1 niveau = 1 marche de terrain). Direction : 0 = −x, 1 = +y, 2 = +x, 3 = −y.
- N'invente jamais d'identifiant d'objet : list_objects (loadedOnly) puis load_objects si besoin.
- Ne place jamais des dizaines d'arbres un par un : zones_paint puis scenery_scatter_zone (thème, seed). scenery_place sert aux accents.
- Mode sandbox (session_set_mode) pour construire vite en pause ; un parc construit ainsi est « non validé » jusqu'à un test en strict.
- Garde le parc viable : chemins connectés à l'entrée, sans impasse, files d'attente, bancs/poubelles/lampes (path_add_furniture), personnel (staff_hire), prix cohérents, attractions ouvertes.
- undo_last annule les dernières opérations ; checkpoint_restore revient plus loin (zones comprises).
- Montagne russe : coaster_find_site (site vide de la bonne taille, eau comprise) → coaster_create (station droite, 15 tuiles libres devant) → coaster_build_plan (macros lift, drop, turn, helix, inversion…) : la fermeture vers la station est calculée → coaster_test. Corrige selon le rapport (accident, train calé, G). coaster_next_pieces et coaster_append pour le détail pièce à pièce.
- Vitesse : chaque élément a sa plage de vitesse. coaster_build_plan renvoie speeds (entrée, sortie, minimum par macro, en km/h) et avertit d'un CALAGE ou d'un élément TROP RAPIDE / TROP LENT par rapport aux designs RCT2. Corrige avant de construire : au pied d'une grande chute, le train est trop rapide pour un zero-g roll, un tire-bouchon ou un virage serré ; place d'abord une colline (hill), une grande boucle ou une montée, et garde les petits éléments pour la fin du parcours. Lis les speeds de chaque dryRun. G : speeds.gForces prédit les G du jeu (même calcul que GetGForces). Les G latéraux s'ajoutent tels quels à l'intensité, et au-delà de 2,8 G elle prend +3,75 (+12,25 au-delà de 3,1) : un virage plat serré (turn small sans banked) pris à plus de ~60 km/h, même juste avant les freins d'arrivée, met l'intensité dans le rouge. Prends les virages rapides banked ou plus larges, et lis tout avertissement G LATÉRAUX. À l'inverse, une pièce inclinée (banked) à plat ou en montée abordée sous 20 km/h est refusée (VIRAGE INCLINÉ TROP LENT) : au sommet du lift, tourne sans banked ou commence la chute dans le virage (turn { banked: true, slope: 'down' }).
- Objectif de notes (« excitation au-dessus de 7,5 », « itère jusqu'à… ») et nombre de trains : passe minExcitement et trains dès coaster_create (gardés pour le circuit ; aussi acceptés par coaster_build_plan et coaster_search_section). Le summary de coaster_create donne la hauteur de lift qu'exige l'excitation (vitesse au bas de la première chute : 7,5 demande ~70 km/h) ; une première chute plus lente est refusée (LIFT TROP BAS). trains sans référence : coaster_search_section pose seule les freins de bloc de mi-parcours et l'arrivée en gare ; ne les pose pas à la main. Chaque fermeture est notée avant d'être posée (estimate, notes estimées dans summary, prudentes de 0,3 à 0,5) et refusée nettement en dessous ; coaster_search_section ne renvoie que des fins qui l'atteignent. Boucle : début (station, lift, première chute) → coaster_search_section { minExcitement } → coaster_build_plan { plan: variants[0].plan } → coaster_test (summary : OBJECTIF ATTEINT / NON ATTEINT et leviers) → checkpoint_save du meilleur → recommence la fin, ou le début si la recherche ne trouve rien (lift plus haut, site plus grand). Ne démolis jamais le meilleur circuit testé, ne t'arrête pas pour demander tant que l'objectif n'est pas atteint, et ne baisse l'objectif qu'avec l'accord de l'utilisateur. Si les contraintes se contredisent (emprise, vitesse, trains, excitation), dis-le tôt et propose un compromis chiffré.
- Freins de mi-parcours : jamais de brakes lents ni de frein de bloc au sol juste après la première chute (FREINS QUI VIDENT LE CIRCUIT : tout le reste roule au pas). Un frein de bloc de mi-parcours se pose sur un plat en hauteur suivi d'une descente ; coaster_search_section le pose seule quand les trains l'exigent. Trois trains impossibles faute de place pour les freins de bloc : moins de voitures par train (ride_configure carsPerTrain).
- Comparer à une référence : lance d'abord coaster_test sur la référence (notes, longueur, vitesses et G mesurés par pièce), puis vise ces chiffres. coaster_test recale aussi le modèle de vitesse.
- « À côté de X » désigne un emplacement, pas un modèle : ne passe pas reference X (elle impose sa longueur, sa compacité et ses trains). Les inversions ne sont jamais imposées par une référence : minInversions seulement si l'utilisateur en veut.
- Montagne russe « dans le style de X » : coaster_describe { design: 'X' } (ou { ride } si X est dans le parc) AVANT de construire. Reprends son type (même objet de véhicule), sa longueur (pièces, lengthTiles), son emprise et sa densité, et l'ordre de ses éléments. Ensuite :
  · Compacité et longueur (aussi importantes que les notes) : lis space, suggestedBounds et target de la référence. Ne choisis pas le site à l'œil : coaster_find_site { reference: { ride | design, longer, taller } } cherche sur toute la carte un rectangle vide de cette taille (lac compris : la piste passe au-dessus de l'eau, bonus de proximité) et donne la station (coaster_create) et bounds ; un site coincé entre d'autres attractions fait échouer la fermeture. Passe bounds { x1, y1, x2, y2 } et reference { ride | design } dès le premier coaster_build_plan (ils restent en vigueur, fermeture comprise ; reference: null est refusé). « Comme X, mais plus haut / plus rapide / plus long / à N trains » : reference { ride, taller: niveaux, faster: km/h, longer: %, trains: total } ; la fermeture est refusée si l'écart n'est pas atteint, et HAUTEUR / VITESSE avertissent dès le lift posé. La compacité, c'est le contour vu de dessus : tuiles de piste plus les trous qu'elle enferme (space.outline). Un tracé compact ne laisse pas de trous entre ses parties (Whiteout) ; deux grandes boucles autour du vide en laissent (Rolling Thunder). Passer à côté, au-dessus ou au-dessous de la piste déjà posée compte pareil : l'empilement n'est pas exigé. Suis target.remainingTiles à chaque appel ; la fermeture est refusée sous 90 % de la longueur, au-delà de 1,3 × le contour de la référence ou avec moins de trains. Ne remplis pas avec des droites : hélices, virages en pente, éléments qui s'enroulent près du reste. Pose la station sur un bord. Corrige chaque avertissement ISOLÉ tout de suite, et vise le contour de la référence (space de coaster_build_plan, spaceLevers de coaster_compare).
  · Lift droit : lift { height } en une seule macro. Un lift 25° monte d'1 niveau par tuile (Frightmare : 19 pièces pour 18 niveaux) ; ne le replie pas en virage pour gagner de la place.
  · La compacité vient du reste du tracé : il s'enroule autour et sous le lift, se croise à 3 niveaux d'écart ou plus, et descend en spirales (turn banked slope 'down' répété, helix large). Surélève la station (coaster_create level) si le tracé doit plonger sous son niveau.
  · Grandes inversions : inversion { kind: loop|immelmann|dive_loop|corkscrew|zero_g_roll|barrel_roll, dir } prend la plus grande taille disponible ; loop seul est une petite boucle. Les inversions dépendent du type de piste : lis inversions (list_objects) ou le résumé de coaster_describe avant de changer de type. Le bois (wooden_roller_coaster, classic_wooden_roller_coaster) a la boucle verticale (small/medium/large) : une boucle ne justifie pas de quitter le bois. Première chute : la plus haute qui tient, jusqu'au sol ou sous la station (sa vitesse fait l'élan de tout le circuit) ; coaster_build_plan refuse une première chute qui s'arrête 3 niveaux ou plus au-dessus du plus bas possible (PREMIÈRE CHUTE PAS AU PLUS BAS), shortDrop: true seulement si l'utilisateur veut une chute plus courte. Au pied d'une grande chute, une grande boucle (inversion { kind: 'loop', size: 'large' ou 'medium' }) ou une colline prend la vitesse ; une petite boucle y dépasse 7 G. Chute raide qui tourne de 90° : drop { height, turn: 'left'|'right' } (d'un seul tenant à 60°) ; essaie les deux sens en dryRun et garde celui qui plonge vers la place libre, loin des autres attractions : un sens au jugé peut fermer le retour. Une chute qui suit une pente descendante la continue sans palier.
  · Verticalité : après la première chute, remonte haut sur l'élan comme la référence. dive { dir, turn } = demi-boucle puis quart de boucle vers la verticale descendante (première inversion de Frightmare) ; quarter_loop { exit: 'corkscrew', dir } = montée verticale, quart de boucle sur le dos, sortie en tire-bouchon ; vertical_drop { height, turn }. Lis relief et reliefLevers de coaster_describe / coaster_compare : pièces à 90°, éléments hauts, point haut par cinquième du parcours.
  · Rayon et vitesse : après une grande chute ou une inversion, turn medium/large banked ou helix large ; small seulement à basse vitesse (fin de parcours).
  · Diagonales : turn { size: 'large', eighths: 1 } entre en diagonale ; hill, drop, climb, straight, brakes y suivent la diagonale ; un autre eighths: 1 en sort (colline en diagonale : eighths 1, hill, eighths 1). Hélices, inversions et virages small/medium exigent d'en sortir d'abord. La fermeture et coaster_search_section utilisent aussi la diagonale.
  · Sections de bloc : layout.blocks donne les limites de section (station, sommets de lift, freins de bloc) et les trains permis (sections − 1). Reprends celles de la référence (Frightmare : lift, 2 freins de bloc, station → 3 trains) avec block_brakes, sur du plat en hauteur et assez long pour le train, après le premier lift (avant lui, seulement collé au pied de la chaîne, avec la longueur du train entre la station et le frein). Le dernier frein de bloc va au bout des freins d'arrivée en gare (brakes puis block_brakes) ; n'en pose pas deux près l'un de l'autre, le second n'ajoute presque rien. Puis ride_configure { trains }, attraction fermée.
  · Impasse : si coaster_build_plan ou coaster_search_section signale exitBlocked (obstacle juste devant le bout du circuit : chemin, file d'attente, autre attraction), élargir bounds ou relancer ne sert à rien. coaster_undo le dernier élément (souvent la première chute) et refais-le pour qu'il débouche sur des tuiles libres, ou retire l'obstacle. POCHE (avertissement de coaster_build_plan) ou « REPLI NÉCESSAIRE » (coaster_search_section) : le bout est enfermé entre chemins et attractions. coaster_search_section recule d'elle-même (backtrack) : fais exactement coaster_undo { count: undo } puis coaster_build_plan { plan: variants[0].plan } (le plan commence par la nouvelle première chute) ; n'élargis pas bounds.
  · Un grand circuit (80 à 120 pièces) se construit en plusieurs coaster_build_plan close: false de 10 à 20 macros, en lisant layout et warnings à chaque étape, puis plan: [] close: true.
- Montagne russe toute faite : coaster_list_designs (filtre query, maxSize) → coaster_place_design { design, x, y, direction, dryRun: true } puis sans dryRun → coaster_test. (x, y) = coin de l'emprise aux x et y minimaux.`;

export interface Services {
    server: McpServer;
    ctx: ToolContext;
}

export function createServer(bridge: BridgeLike, config: Config, recorder: SessionRecorder | null = null): Services {
    const server = new McpServer({ name: "openrct2", version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
    const state: ServerState = { mode: "unknown", validated: true, captureCounter: 0, lastSnapshot: null, checkpoints: new Map(), zones: new ZoneMap(), landscapeAllowed: false };
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
