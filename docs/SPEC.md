# Spécification : MCP Server pour OpenRCT2 (sans fork)

> **Version :** 1.5 — 7 octobre 2026 (1.5 : designs `.td6` posés par parseur et rejeu, `coaster_list_designs` et `coaster_place_design`, fait F40 ; 1.1 : section 2 recoupée avec le dépôt OpenRCT2, abandon d'ES5, ADR 0001 ; 1.2 : spikes S1 à S4, S7 et S9 réalisés en jeu, faits F23 à F29 ; 1.3 : Phase 2 implémentée et validée en jeu, faits F30 à F35, S8 tranché ; 1.4 : S5 et Phase 3 (hors `.td6`), faits F36 à F39 ; voir `docs/SPIKES.md` et `docs/ENV.md`)
> **Destinataire :** Claude Opus (agent d'implémentation, idéalement dans Claude Code)
> **Objectif en une phrase :** construire un serveur MCP qui permet à Claude de concevoir et construire un parc d'attractions dans OpenRCT2, en s'appuyant uniquement sur l'API de plugins JavaScript existante (aucune modification du code C++).

---

## 0. Comment utiliser ce document

### 0.1 Règles pour l'agent d'implémentation

1. **La source de vérité est `distribution/scripting/openrct2.d.ts`** dans le dépôt `OpenRCT2/OpenRCT2` (branche `develop`), complété par `distribution/scripting/scripting.md`. Ce document contient des faits vérifiés et des hypothèses. En cas de conflit, le `.d.ts` gagne. **Exception : les noms d'arguments des game actions.** Ceux que le jeu lit réellement sont définis par `AcceptParameters(GameActionParameterVisitor&)` dans `src/openrct2/actions/**`, et le `.d.ts` se trompe pour 4 actions (voir F6). Pour les arguments, le C++ gagne. Corrige ce document quand tu découvres une erreur.
2. **Chaque affirmation est étiquetée** :
   - `[VÉRIFIÉ]` : confirmé par une source citée en section 2.
   - `[À VÉRIFIER]` : plausible mais non confirmé. À valider par un *spike* (section 16, Phase 0) avant de s'y fier.
   - `[DÉCISION]` : choix d'architecture de ce document, modifiable si un spike l'invalide (écris alors un ADR).
3. **Commence par la Phase 0 (spikes).** Ne construis pas le catalogue d'outils complet avant d'avoir répondu aux questions de la section 16.1. Consigne chaque résultat dans `docs/SPIKES.md` (question, expérience, résultat, décision).
4. **Pas de fork, pas de patch C++.** Tout passe par le plugin JS, la CLI officielle, les fichiers de sauvegarde et du code externe (le serveur MCP).
5. **Ne mets jamais d'outil `eval` générique en production.** Un outil de debug qui exécute du JS arbitraire dans le jeu doit être désactivé par défaut et protégé par un flag explicite.
6. **Écris le plugin en TypeScript, bundlé en un seul script global (IIFE) ciblant ES2020.** Le moteur est QuickJS-NG (ES2023) depuis OpenRCT2 v0.5.0 (F18) ; Duktape/ES5 ne concerne que les versions antérieures, non supportées par ce projet (ADR 0001). Restrictions : **pas de modules ES** (`import`/`export`) dans le fichier émis, **pas d'`Intl`**, pas de JIT (le code reste lent : voir règle 7). Les `Promise` existent, mais les API du jeu restent à base de callbacks.
7. **Aucune boucle longue dans le plugin.** Le JS s'exécute sur le thread du jeu. Tout travail volumineux est découpé en tranches par tick (section 6.3).
8. **Teste tout ce qui peut l'être sans le jeu** (logique du serveur, planificateurs, générateurs) avec un faux plugin. Réserve les tests avec le vrai jeu à des scénarios ciblés.
9. **Ce que Claude voit doit rester petit.** Chaque réponse d'outil a un budget de tokens (section 8.5). Pagine, résume, plafonne.
10. **Sois honnête sur les limites.** Si une fonctionnalité n'est pas faisable sans fork, documente-la dans la section 18 plutôt que de la contourner de façon fragile.

### 0.2 Ordre de lecture conseillé

Sections 1 à 3 (cadre), 16 (feuille de route et spikes), puis 6 à 9 (plugin, protocole, serveur, outils) en suivant la roadmap. Les sections 10 à 13 détaillent les fonctionnalités avancées (vision, scénerie, montagnes russes, base de style) et ne sont à implémenter qu'après le MVP.

---

## 1. Objectif et périmètre

### 1.1 But

Permettre à Claude (via MCP) de :
1. **Observer** un parc OpenRCT2 : carte, tuiles, attractions, finances, visiteurs, captures d'écran.
2. **Agir** : terraformer, tracer des chemins, placer des attractions, boutiques, scénerie, entrées, régler la gestion du parc.
3. **Itérer** : tester, mesurer, corriger, revenir en arrière (checkpoints), jusqu'à obtenir un parc cohérent et fonctionnel.

### 1.2 Hors périmètre (cette phase)

- Toute modification du code C++ d'OpenRCT2 (voir section 18 pour ce qu'un fork apporterait).
- Le multijoueur. Le pont est conçu pour un seul client Claude contrôlant une instance locale.
- Garantir un niveau esthétique « parc de concours ». L'objectif réaliste est un parc fonctionnel, cohérent et agréable ; la finition fine reste difficile.

### 1.3 Critères de succès (mesurables)

| Niveau | Critère |
|---|---|
| MVP (Phase 1) | Claude construit un petit parc jouable : entrée, réseau de chemins connecté, 2 attractions plates, 3 boutiques, scénerie de base, attractions ouvertes, en moins de 80 appels d'outils, avec un taux de réussite d'au moins 80 % sur 10 essais. |
| Vision (Phase 2) | Claude détecte et corrige seul au moins 3 types de défauts à partir de captures et de cartes annotées (attraction non connectée, zone vide, chemin sans issue). |
| Montagnes russes (Phase 3) | Circuit fermé, testable et sans accident sur terrain plat pour un coaster acier classique, au moins 8 fois sur 10. |
| Style (Phase 4) | Les zones de scénerie générées à partir de références obtiennent un meilleur score que des zones générées sans références, lors d'une comparaison à l'aveugle réalisée par un humain. |

---

## 2. État des connaissances

> Mis à jour le 7 octobre 2026 après la lecture seule du dépôt `OpenRCT2` (`v0.5.5-155-gc4aea2c72e`), puis après les spikes en jeu du même jour (F23 à F29). Les détails, les numéros de ligne et les tableaux complets d'arguments sont dans `docs/SPIKES.md`.

### 2.1 Faits vérifiés

| # | Fait | Source |
|---|---|---|
| F1 | Il existe trois types de plugins : `local`, `remote`, `intransient`. Les `intransient` se chargent au démarrage du jeu et restent actifs jusqu'à l'arrêt, y compris sur l'écran titre et entre les parcs. | `distribution/scripting/scripting.md` (dépôt officiel) ; PR #16707 |
| F2 | **En solo, tous les types de plugins sont sans restriction** : ils peuvent modifier l'état du jeu directement ou via des game actions. En multijoueur, les `intransient` ont les mêmes restrictions que les `local` (pas de mutation directe, seulement des game actions). | `scripting.md` ; doc des types de plugins |
| F3 | Erreur « Game state is not mutable in this context » : elle apparaît quand on mute l'état hors des contextes autorisés en multijoueur. | doc des types de plugins |
| F4 | `network.createListener()` et `network.createSocket()` existent (TCP) ; `Listener.listen(port, host?)`. **Pour des raisons de sécurité, les plugins ne peuvent écouter et se connecter qu'à localhost.** Le port utilisable dépend de l'OS et des privilèges. | `scripting.md` ; `.d.ts` (`Network`, `Listener`) |
| F5 | `context.queryAction(name, args, callback?)` et `context.executeAction(name, args, callback?)` existent. `queryAction` simule sans exécuter. **Résultat :** `error` est toujours présent (0 = succès) ; `errorTitle` et `errorMessage` ne sont présents qu'en cas d'échec ; `cost`, `position` (`CoordsXYZ`) et `expenditureType` (chaîne) sont présents s'ils sont définis ; en plus `ride` pour `ridecreate`, `peep` pour `staffhire`, `bannerIndex` pour `bannerplace`, `largesceneryplace` et `wallplace`. **Toutes les clés d'arguments sont obligatoires** (sauf `flags`) : une clé absente lève une **exception JS synchrone** `"Invalid action parameters."`, et un nom d'action inconnu lève `"Unknown action."`. Le callback de `queryAction` est appelé de façon synchrone. | `.d.ts` (`GameActionResult`) ; `ScriptEngine.cpp` (`GameActionResultToJS`, `JSToGameActionParameterVisitor`) ; `ScContext.hpp` (`QueryOrExecuteAction`) |
| F6 | Le `.d.ts` déclare les 80 game actions et leurs arguments, mais **4 interfaces sont fausses** : `footpathlayoutplace` (le jeu lit `slopeType` et `slopeDirection`, pas `slope`), `parkentranceplace` (il manque `entranceObject` et `footpathTypeIsLegacy`), `clearscenery` (il manque `x1, y1, x2, y2`), `surfacesetstyle` (il manque `surfaceColour1` et `edgeColour1`). Les noms réels sont ceux de `AcceptParameters` dans `src/openrct2/actions/**`. Les coordonnées composites se décomposent en `x, y[, z][, direction]` et les plages en `x1, y1, x2, y2`. | Comparaison systématique `.d.ts` ↔ C++ (`docs/SPIKES.md` § S2) |
| F7 | `context.captureImage(options)` existe. Options : `filename?` (relatif au dossier de captures), `width?`, `height?`, `position?` (`CoordsXY`, centre en unités monde, sans `z`), **`zoom` et `rotation` obligatoires** (zoom 0 = 1:1, 1 = 2:1… ; rotation 0 à 3), `transparent?`. Sans `width/height/position` : capture « géante » de tout le parc. L'image est écrite sur disque. | `.d.ts` (`CaptureOptions`) |
| F8 | **Un plugin communautaire de contrôle à distance par TCP (`CorySanin/openrct2-remote-control`) indique que sa commande `capture` « ne fonctionne pas sur un serveur headless ».** | README de ce dépôt |
| F9 | Les commandes de la console legacy `save_park [name]` et `load_park <filename>` existent ; `load_park` accepte un nom du dossier `save` ou un chemin absolu. Elles sont appelables via `console.executeLegacy("...")`, **marqué `@deprecated`**. Pour sauvegarder, l'API moderne propose `context.saveGame({ filename })` (relatif au dossier des sauvegardes, `.park` ajouté automatiquement). Il n'existe pas d'équivalent moderne pour charger. | `InteractiveConsole.cpp` ; `.d.ts` (`Console`, `SaveGameOptions`) |
| F10 | `objectManager` expose `installedObjects`, `getInstalledObject(id)`, `load(id[, index])` → `LoadedObject \| null`, `load(ids[])`, `unload(id \| ids[] \| type, index)`, `getObject(type, index)`, `getAllObjects(type)` (objets chargés). | `.d.ts` (`ObjectManager`) |
| F11 | `context.getTrackSegment(type)` et `context.getAllTrackSegments()` existent (350 types). Champs de `TrackSegment` : `type`, `description`, `beginZ`, `endZ`, `endX`, `endY` (le début est toujours en 0,0), `beginDirection`, `endDirection` (`Direction8`), `beginSlope`, `endSlope` (`TrackSlope`), `beginBank`, `endBank` (`TrackBanking`), `length`, `elements` (blocs occupés `{x, y, z}` relatifs), `trackGroup`, `mirrorSegment`, drapeaux (`isInversion`, `allowsChainLift`…), `getSubpositions()`. `map.getTrackIterator(location: CoordsXY, elementIndex)` → `TrackIterator` (`position`, `segment`, `previousPosition`, `nextPosition`, `next()`, `previous()`). | `.d.ts` (`TrackSegment`, `TrackIterator`) |
| F12 | Les notes de ride (`excitement`, `intensity`, `nausea`) sont exposées en centièmes. `Ride` expose aussi `maxSpeed`, `averageSpeed`, `rideTime`, `rideLength`, `maxPositiveVerticalGs`, `maxNegativeVerticalGs`, `maxLateralGs`, `totalAirTime`, `numDrops`, `numLiftHills`, `highestDropHeight`. | `.d.ts` (`Ride`) |
| F13 | Configuration utilisateur : `$XDG_CONFIG_HOME/OpenRCT2` (ou `~/.config/OpenRCT2`) sous Linux. L'option `enable_hot_reloading = true` dans la section `[plugin]` de `config.ini` recharge automatiquement les scripts. | man page `openrct2` ; `scripting.md` |
| F14 | La CLI propose `openrct2 host <parc> --port <p> [--headless]` et `openrct2-cli host <parc>` (serveur sans UI). Une sous-commande `screenshot` existe (syntaxe à relever au spike S1). Le jeu nécessite les fichiers originaux de RollerCoaster Tycoon 2. | man pages ; `command_line/RootCommands.cpp` |
| F15 | Hooks : `action.execute`, `action.location`, `action.query`, `guest.generation`, `interval.day`, `interval.tick`, `map.change`, `map.changed`, `map.resize`, `map.save`, `network.*`, `park.guest.softcap.calculate`, `ride.breakdown`, `ride.ratings.calculate`, `vehicle.crash`. **`map.change`** est appelé *avant* le déchargement de la carte courante ; **`map.changed`** *après* le chargement de la nouvelle carte et des scripts transients, **et seulement pour les plugins `intransient`**. Un changement de carte arrête les plugins transients (ce qui libère leurs minuteries, sockets et abonnements) mais **pas les `intransient`**. | `HookEngine.cpp` ; `Game.cpp` (`GameNotifyMapChange`, `GameNotifyMapChanged`) ; `ScriptEngine.cpp` (`UnloadTransientPlugins`, `StopPlugin`) |
| F16 | `context.getParkStorage()` (données dans le fichier `.park`) et `context.sharedStorage` (JSON global) existent. | `.d.ts` (`Context`) |
| F17 | Game actions utiles au projet. Chemins : `footpathplace`, `footpathlayoutplace`, `footpathremove`, `footpathadditionplace`, `footpathadditionremove`. Attractions : `ridecreate`, `trackplace`, `trackremove`, `rideentranceexitplace`, `rideentranceexitremove`, `ridesetstatus`, `ridesetprice`, `ridesetsetting`, `ridesetvehicle`, `ridesetappearance`, `ridedemolish`, `mazesettrack`. Parc : `parkentranceplace`, `peepspawnplace`, `landbuyrights`, `landsetrights`, `parksetname`, `parksetentrancefee`, `parksetloan`, `parkmarketing`, `parksetparameter`. Scénerie : `smallsceneryplace`, `smallsceneryremove`, `largesceneryplace`, `largesceneryremove`, `wallplace`, `wallremove`, `clearscenery`. Terrain : `landraise`, `landlower`, `landsetheight`, `landsmooth`, `surfacesetstyle`. Eau : `waterraise`, `waterlower`, `watersetheight`. Divers : `cheatset`, `gamesetspeed`, `pausetoggle`, `staffhire`, `stafffire`, `staffsetorders`, `staffsetpatrolarea`. Arguments exacts : `docs/SPIKES.md` § S2. | `.d.ts` (`ActionType`) ; `ScriptEngine.cpp` (table des noms) |
| F18 | **Le moteur JS est QuickJS-NG (ES2023) depuis OpenRCT2 v0.5.0**, et non plus Duktape. Sont disponibles : `let/const`, fonctions fléchées, classes, template literals, `Promise`, `async/await`, `Map/Set`, méthodes modernes. **Non disponibles : les modules ES (`import`/`export`) et `Intl`.** Pas de JIT. | `scripting.md` ; `src/openrct2/CMakeLists.txt` (`thirdparty/quickjs-ng`) |
| F19 | `context.apiVersion` vaut **124** sur `develop` à `v0.5.5-155`. `PluginMetadata` accepte `targetApiVersion` (obligatoire) et `minApiVersion` (facultatif). | `ScriptEngine.h` (`kPluginApiVersion`) ; `.d.ts` (`PluginMetadata`) |
| F20 | L'objet global `cheats` expose en lecture et écriture : `allowArbitraryRideTypeChanges`, `allowSpecialColourSchemes`, `allowTrackPlaceInvalidHeights`, `buildInPauseMode`, `disableAllBreakdowns`, `disableBrakesFailure`, `disableClearanceChecks`, `disableLittering`, `disablePlantAging`, `disableGrassGrowing`, `disableRideValueAging`, `disableSupportLimits`, `disableTrainLengthLimit`, `disableVandalism`, `enableAllDrawableTrackPieces`, `enableChainLiftOnAllTrack`, `fastLiftHill`, `forcedParkRating` (nombre), `freezeWeather`, `ignoreResearchStatus`, `ignoreRideIntensity`, `ignoreRidePrice`, `neverendingMarketing`, `makeAllDestructible`, `sandboxMode`, `showAllOperatingModes`, `showVehiclesFromOtherTrackTypes`, `allowRegularPathAsQueue`. Écrire dans `cheats` est une **mutation directe**. La voie par game action est `cheatset { type, param1, param2 }`, avec `type` = `CheatType` (énumération séquentielle de `Cheats.h` : `0` sandboxMode, `1` disableClearanceChecks, `11` buildInPauseMode, `17` setMoney, `42` ownAllLand, `44` ignoreResearchStatus…). Certains cheats n'existent **que** via `cheatset` (argent, `ownAllLand`, `fixRides`…). | `.d.ts` (`Cheats`, `CheatSetArgs`) ; `Cheats.h` |
| F21 | **Aucun moyen de placer un design `.td6` depuis un plugin.** L'action `trackdesign` existe, mais son `AcceptParameters` ne lit que `x, y, z, direction` (`// TODO visit the track design`) : le design reste vide. Le `.d.ts` la marque `@todo Currently unsupported`. Aucune API ni commande de console ne charge un `.td6`. | `TrackDesignAction.cpp` ; `.d.ts` (`TrackDesignArgs`) |
| F22 | Conventions : 1 tuile = 32 unités monde ; `z = baseHeight × 8` (les éléments exposent `baseHeight` et `baseZ`) ; 1 marche de terrain = 16 unités = 2 `baseHeight` ; hauteurs de terrain et d'eau entre 2 et 254 (`baseHeight`). Direction 0-3 en repère carte : 0 = −X, 1 = +Y, 2 = +X, 3 = −Y. Pente de surface : bits N=1, E=2, S=4, W=8, et 16 = diagonale. Dans les actions, les coordonnées sont en unités monde, **sauf** `landsetheight.height` et `watersetheight.height`, en unités `baseHeight`. | `world/MapLimits.h` ; `world/Map.cpp` (`CoordsDirectionDelta`) ; `world/tile_element/Slope.h` ; `.d.ts` (`CoordsXYZ`) |
| F23 | **Vérifié en jeu (mode A) :** le plugin `intransient` écoute sur `127.0.0.1`, son listener, sa connexion, sa minuterie `setInterval` et ses abonnements **survivent à `load_park`**. La latence aller-retour est de 50 ms (2 frames). | Spikes S1, S3, S9 |
| F24 | `captureImage` fonctionne en mode A (~100 ms pour 1920×1080) **si le dossier `screenshot/` existe** : `fs::create_directory(dir, screenshotDirectory)` échoue sinon. Indisponible en `host --headless` (F8 confirmé). La CLI `openrct2-cli screenshot <parc> <png> <w> <h> <x> <y> <zoom> <rotation>` fonctionne (~300 ms) mais refuse les options globales. | `Screenshot.cpp:597-625` ; spike S1 |
| F25 | **`load_park` (console) n'appelle ni `map.change` ni `map.changed`** (ni `GameLoadScripts`) : il passe par `Context::LoadParkFromStream`, qui n'appelle que `GameUnloadScripts`. Le plugin émet donc `map_changed` lui-même après un `load_park`. | `Context.cpp:780` ; `Game.cpp:646-675` ; spike S3 |
| F26 | En mode serveur (`host --headless`), `context.saveGame` lève « Game state is not mutable in this context » ; `console.executeLegacy("save_park …")` et `load_park` fonctionnent. | Spike S1/S3 |
| F27 | Origine de `trackplace` pour les attractions plates : 3×3 → tuile centrale ; 2×2 et 4×4 → coin minimal ; 1×5 → centre de l'axe long. `peepspawnplace` exige une allée sous le point et un terrain hors du parc. Le jeu relie automatiquement un chemin posé aux files d'attente voisines. | Spike S2 |
| F28 | Quadrants de petite scénerie : 0 = coin (−x, −y), 1 = (−x, +y), 2 = (+x, +y), 3 = (+x, −y). À rotation 0, +x va vers le bas à gauche de l'écran et +y vers le bas à droite ; au zoom 0, une tuile décale de (−32, +16) px en x et (+32, +16) px en y. | `Scenery.cpp:60` (`SceneryQuadrantOffsets`) ; spike S2 |
| F29 | Avec `use_vsync = true` et une fenêtre masquée, toute la boucle du jeu tombe à ~1 image/s (requêtes à 1 s). Lire certaines propriétés d'éléments de tuile inadaptées (`ride` d'un chemin qui n'est pas une file, `station` hors station…) journalise un avertissement à chaque lecture. | Spike S9 ; `ScTileElement.cpp` |
| F30 | **Coins d'une tuile** (repère carte) : S = (x, y), E = (x+1, y), N = (x+1, y+1), W = (x, y+1), soit bits 4, 2, 1, 8. Avec le drapeau diagonal (16), le coin opposé au seul coin non relevé monte de 2 niveaux. Une grille de sommets dont deux voisins sur un bord de tuile diffèrent d'au plus 1 niveau ne produit que des pentes valides. | `world/Map.cpp` (`TileElementHeight`, `MapGetCornerHeight`) ; tests du planificateur |
| F31 | **`watersetheight` refuse une hauteur < 2** (`kMinimumWaterHeight`, « Too low ») et **retire l'eau si la hauteur ne dépasse pas le sol**. Pour supprimer l'eau, il faut donc envoyer 2, pas 0 (bogue de la Phase 1 corrigé dans `terrain.set_water`). | `WaterSetHeightAction.cpp` ; test d'intégration |
| F32 | Additions de chemin : une par tuile ; interdites sur une tuile raccordée des quatre côtés (sauf fontaines) ; refusées sur une rampe si l'objet a `dontAllowOnSlope`, sur une file si `dontAllowOnQueue` ; écrans de file seulement sur les files. Retrait : `footpathadditionremove { x, y, z }`. | `FootpathAdditionPlaceAction.cpp` |
| F33 | `SmallSceneryObject.flags` est le `FlagHolder` brut de `SmallSceneryFlag` : bit 0 `occupiesFullTile`, 2 `requiresFlatSurface`, 3 `isRotatable`, 24 `occupiesHalfTile`, 25 `occupiesThreeQuarters`, 28 `isTree`. Un objet « tuile entière » exclut tout autre objet au même niveau. | `object/SmallSceneryEntry.h` ; `ScObject.hpp` |
| F34 | **Projection des captures, toutes rotations** : `captureImage` centre la vue sur `Translate3DTo2DWithZ(rotation, (position, TileElementHeight(position)))`, avec `r = pos.rotate(rotation)`, `sx = r.y − r.x`, `sy = (r.x + r.y) / 2 − z`, et couvre `width × 2^zoom` unités d'écran. Vérifié en jeu aux rotations 0 à 3, zooms 1 et 2 (grille annotée alignée sur le relief, un lac et une colline). | `Viewport.cpp:1919` ; `Screenshot.cpp:631` ; spike S8 |
| F35 | `landsetheight` coûte ~25 ms par tuile en jeu (une action par image : chaque appel dépasse le budget de 4 ms) : une colline de 229 tuiles prend 5,8 s. `staffhire` : le costume n'est lu que pour les artistes (index d'objet d'animation d'artiste chargé, sinon refus) ; `autoPosition: true` place l'employé sur un chemin ; la réponse donne l'id dans `peep`. | Mesures Phase 2 ; `StaffHireNewAction.cpp` |
| F36 | **Pose d'une pièce de piste** (modèle de `TrackDesignPlaceVirtual`) : à la pose (x, y, z, rot 0-7, pente, inclinaison), la pièce T se pose avec `trackplace { z: pose.z − T.beginZ, direction: rot & 3 }` ; la pose suivante vaut `xy + rotate(endX, endY, rot)`, `z = origine.z + endZ`, `rot = ((rot + endDirection − beginDirection) & 3) \| (endDirection & 4)`, plus un pas dans `rot` si la fin n'est pas diagonale. `TrackIterator.position` est l'origine passée à `trackplace` ; `trackremove` prend `z = origine.z + elements[0].z`. Vérifié en jeu sur des circuits fermés de 33 à 51 pièces. | `TrackDesign.cpp:1590-1735` ; `Track.cpp:427` ; spike S5 |
| F37 | **`trackplace` ne contrôle pas les groupes de pièces** du type d'attraction (seule la chaîne sur pente raide l'est) : le serveur impose `enabledTrackGroups` (table générée depuis `ride/rtd/**`). La hauteur de dégagement d'un bloc n'est pas exposée par l'API. | `TrackPlaceAction.cpp:100-180` ; `ScTrackSegment.cpp` |
| F38 | **Tester une attraction exige une entrée et une sortie** (et un circuit complet). Construire en pause exige le cheat `buildInPauseMode`. | `Ride.cpp:3795-3835` ; `TrackPlaceAction.cpp:139` |
| F39 | Statistiques de `Ride` : `maxSpeed`/`averageSpeed` en mph, `rideLength` en mètres, G déjà divisés par 100 ; `highestDropHeight` en unités de hauteur. Un test complet d'un circuit de 300 m prend ≈ 2 400 ticks (≈ 8 s à vitesse 4). | `ScRide.cpp:738-777` ; mesures Phase 3 |
| F40 | **Rejeu des `.td6` vérifié.** Fichier = RLE Sawyer + somme de contrôle (4 octets) ; en-tête `TD6Track` de 0xA3 octets (type RCT2 en 0x00, version en 0x07 bits 2-3 : 2 = td6, 3 = td7, nom DAT du véhicule en 0x74-0x7B), pièces de 2 octets (3 en td7, type sur 16 bits) terminées par 0xFF : drapeaux 0x80 chaîne, 0x40 inversé, 0x30 schéma de couleurs, 0x0F index de station / vitesse de frein (× 2) / rotation de siège ; puis entrées/sorties de 6 octets (z en pas de 8, direction bit 7 = sortie, x, y en unités monde) et scénerie de 22 octets. Les types de pièces sont ceux d'OpenRCT2 sauf les alias 101 (→ `multiDimInvertedUp90ToFlatQuarterLoop`) et 100 en wild mouse (→ `rotationControlToggle`). La pose suit `TrackDesignPlaceRide` : marche géométrique seule (le jeu ne contrôle pas pente ni inclinaison ; les pièces volantes inversées dépendent du drapeau `inverted`), `trackplace` avec `isFromTrackDesign: true`, entrée/sortie en `origine + rotate(x, y)`, direction `(rotation + d) & 3`. Sur les 204 designs de RCT2 : 201 lus (3 labyrinthes), 186 bouclés, les autres sont des navettes, tours et lancements, ouverts par nature. 4 designs posés et testés en jeu (bois, wild mouse, lay-down à pièces inversées, navette) : notes à ±0,6 de celles du fichier (sans la scénerie). | `T6Importer.cpp` ; `TD46.cpp` ; `TrackDesign.cpp:1338-1735` ; `test/td6.test.ts` |

> **Sur les sources.** Les pages « mintlify.wiki » (documentation communautaire non officielle) ont servi à écrire la version 1.0 de ce document. Tous les faits qui en venaient (F5, F7, F10, F11, F12) ont depuis été recoupés avec le `.d.ts` ou le C++. Ne pas s'en servir comme référence.

### 2.2 Implications directes de ces faits

- **F2 + F8 orientent le mode d'exécution recommandé (section 3.3).** Le mode « jeu avec fenêtre, en solo » offre à la fois la liberté de mutation et la capture d'image. Le mode headless (`host`) est un serveur multijoueur : mutation directe restreinte et captures probablement indisponibles.
- **F4** : la communication se fait par TCP sur `127.0.0.1`, point. Pas d'accès distant sans tunnel ou proxy externe.
- **F5 + F6** : le plugin enveloppe chaque appel d'action dans `try/catch` et traduit l'exception en `INVALID_PARAMS`. `packages/protocol` contient une table des clés attendues par action, **générée à partir du C++** et non du `.d.ts`. Le serveur valide les arguments avant l'envoi.
- **F9** : les checkpoints sont possibles sans fork : `context.saveGame` pour sauvegarder, `load_park` (legacy) pour restaurer. **F15** suggère que le plugin `intransient`, son listener et ses minuteries survivent au rechargement d'un parc. Reste à le confirmer en jeu (spike S3).
- **F18 + F19** : plus de contrainte ES5 (ADR 0001). Plugin bundlé en IIFE, cible ES2020, `targetApiVersion` fixé à la version du jeu utilisée (124 au moment de la rédaction).
- **F21** : le placement de `.td6` passe obligatoirement par le plan B (parseur côté serveur et rejeu, section 12.7) ; implémenté et vérifié (F40).

### 2.3 Questions ouvertes (à trancher par des spikes)

> État au 7 octobre 2026 : les cinq questions ci-dessous sont tranchées (F23 à F28, `docs/SPIKES.md`), ainsi que S8 (F34) et S5 (F36). Reste ouvert : l'origine des empreintes non carrées en directions 2 et 3.

Liste complète en section 16.1. Les plus critiques :
- ~~survie effective du listener et de la connexion après `load_park`~~ : confirmée (F23) ;
- ~~disponibilité de `captureImage` selon le mode~~ : mode A oui, mode B non (F24) ;
- ~~placement d'attractions plates et de boutiques~~ : établi (F27) ;
- ~~orientation de l'écran, signification de `quadrant`~~ : établies à rotation 0 (F28) ;
- ~~accélération du temps de jeu~~ : `gamesetspeed` jusqu'à 4, ≈ 280 ticks/s (spike S7).

---

## 3. Architecture

### 3.1 Vue d'ensemble

```text
┌──────────────┐  MCP (stdio)   ┌────────────────────────┐  TCP 127.0.0.1   ┌─────────────────────────────┐
│ Claude (Opus)│ ─────────────► │  Serveur MCP (Node/TS) │ ───────────────► │ Plugin « claude-bridge »    │
│ via Claude   │ ◄───────────── │  - outils de haut niveau│ ◄─────────────── │ (intransient, ES2020)       │
│ Desktop/Code │  texte + images│  - planificateurs       │  JSON par lignes │ - file de commandes         │
└──────────────┘                │  - rendu de cartes PNG  │                  │ - game actions / API map    │
                                │  - base de référence    │                  │ - captureImage, saveGame    │
                                │  - journal / undo       │                  └──────────────┬──────────────┘
                                └───────────┬─────────────┘                                 │
                                            │ lit les fichiers                              ▼
                                            ▼                                     ┌──────────────────┐
                                   dossier de captures, saves,                    │ OpenRCT2 (solo)  │
                                   exports, reference_db/                         └──────────────────┘
```

### 3.2 Responsabilités

| Composant | Responsabilité | À éviter |
|---|---|---|
| **Plugin** | Exécuter des opérations *élémentaires et sûres* dans le jeu ; exposer l'observation de la carte ; gérer la file de commandes ; renvoyer des erreurs structurées. | Logique métier complexe, planification, génération procédurale lourde. |
| **Serveur MCP** | Exposer les outils à Claude ; composer des opérations de haut niveau ; planifier (chemins, fermeture de circuit, scénerie) ; rendre des cartes PNG ; tenir un journal d'opérations ; superposer des annotations sur les captures. | Parler directement au jeu autrement que par le protocole défini. |
| **Fichiers partagés** | Captures, sauvegardes, exports de scénerie, base de référence. | Transporter du binaire par le socket. |

**[DÉCISION]** Toute logique qui peut vivre dans le serveur y vit. Le serveur est testable, déboguable et ne tourne pas sur le thread du jeu. Le plugin reste mince.

### 3.3 Modes d'exécution

| Mode | Description | Mutation d'état (F2) | Captures (F7, F8) | Verdict |
|---|---|---|---|---|
| **A. Solo avec fenêtre** | Lancer OpenRCT2 normalement, ouvrir un parc, plugin `intransient` actif. Sous Linux sans écran : `xvfb-run`. | Libre : API `map`, actions, cheats. `captureImage` fonctionnel [VÉRIFIÉ F24]. | **Recommandé pour le MVP** [confirmé, spike S1]. L'utilisateur peut aussi regarder Claude construire en direct. |
| **B. `host --headless`** | Serveur dédié sans fenêtre. | Restreint aux game actions (type `intransient` = comportement « local » en multijoueur). | Indisponible [VÉRIFIÉ F24] ; `saveGame` aussi (repli `save_park`, F26). | Utilisable pour construire sans images (cartes schématiques du serveur). |
| **C. Hybride** | Jeu headless pour la construction, CLI `screenshot` sur une sauvegarde pour le rendu. | Comme B. | Via un processus séparé à partir d'un `.park` enregistré. | Plan B si A est impraticable sur la machine cible. |

**[DÉCISION]** Développer et valider en mode A. Concevoir le plugin pour qu'il fonctionne aussi en mode B en n'utilisant que des game actions quand c'est possible (le plugin détecte `network.mode` et refuse proprement les opérations qui exigent une mutation directe).

### 3.4 Flux d'un appel d'outil (exemple : `path_build`)

1. Claude appelle `path_build({ points, pathObject })`.
2. Le serveur valide les paramètres (zod), lit la carte locale (cache) et planifie : hauteur et pente de chaque tuile.
3. Le serveur envoie `batch` (dry-run) au plugin : `queryAction('footpathplace', …)` par tuile.
4. En cas d'échec, le serveur renvoie à Claude une erreur actionnable (tuile fautive, raison, suggestion). Sinon, il envoie `batch` en exécution réelle.
5. Le plugin traite la file par tranches de ticks et renvoie un résultat par opération.
6. Le serveur consigne l'inverse de chaque opération dans le journal (pour `undo_last`), met à jour son cache, et renvoie un résumé court à Claude.

---

## 4. Environnement de développement

### 4.1 Prérequis

- OpenRCT2 (version stable récente ou `develop`) et **les fichiers originaux de RollerCoaster Tycoon 2** (exigés par le jeu, F14). Relever `context.apiVersion` au runtime et le consigner dans `docs/ENV.md`.
- Node.js LTS (≥ 20) et pnpm. TypeScript.
- Optionnel : Python 3.11+ si certains outils d'analyse hors-ligne sont écrits en Python.
- Linux sans écran : `xvfb`.

### 4.2 Dossiers utiles

| OS | Dossier utilisateur OpenRCT2 | Plugins |
|---|---|---|
| Linux | `$XDG_CONFIG_HOME/OpenRCT2` ou `~/.config/OpenRCT2` [VÉRIFIÉ F13] | `<dossier>/plugin` [VÉRIFIÉ] |
| Windows | `Documents\OpenRCT2` [À VÉRIFIER] | `…\plugin` |
| macOS | `~/Library/Application Support/OpenRCT2` [À VÉRIFIER] | `…/plugin` |

Sous-dossiers à repérer : `save/` (parcs), `screenshot/` (captures [VÉRIFIÉ] ; doit exister avant toute capture, F24), `object/` (objets personnalisés), `plugin/`. Rendre ces chemins configurables via variables d'environnement.

### 4.3 Configuration du jeu pour le développement

- Dans `config.ini`, section `[plugin]` : `enable_hot_reloading = true` (F13). Le plugin se recharge à chaque sauvegarde du fichier `.js` (pratique pour itérer).
- Prévoir un **parc modèle** `templates/sandbox_flat_128.park` : carte plate d'environ 128×128, terrain possédé, jeu d'objets chargés suffisant (chemins, files d'attente, quelques attractions plates et boutiques, 30 à 60 objets de scénerie variés, une entrée de parc). Le créer une fois via l'éditeur de scénarios, puis le versionner (ou documenter la procédure si les droits empêchent de le versionner). Au besoin, compléter à chaud via `objectManager.load(...)` (F10, spike S4).

### 4.4 Scripts à fournir

- `pnpm dev:plugin` : compile en watch et copie le `.js` dans le dossier `plugin/`.
- `pnpm dev:server` : lance le serveur MCP en mode développement.
- `pnpm game` : lance OpenRCT2 sur le parc modèle (chemin du binaire configurable).
- `pnpm test`, `pnpm test:integration` (nécessite le jeu).
- `pnpm mcp:inspect` : lance l'inspecteur MCP officiel sur le serveur pour tester les outils sans Claude.

---

## 5. Dépôt et stack

### 5.1 Structure proposée (monorepo pnpm)

```text
openrct2-claude/
├─ docs/
│  ├─ SPIKES.md            # résultats des expériences (Phase 0)
│  ├─ ADR/                 # décisions d'architecture
│  └─ ENV.md               # versions, chemins, particularités
├─ packages/
│  ├─ protocol/            # types partagés + schémas zod du protocole plugin⇄serveur
│  ├─ plugin/              # plugin OpenRCT2 (TS → script IIFE ES2020)
│  │  ├─ src/
│  │  │  ├─ main.ts        # registerPlugin, listener, boucle
│  │  │  ├─ net.ts         # framing NDJSON, connexions
│  │  │  ├─ queue.ts       # file de commandes, budget par tick
│  │  │  ├─ handlers/      # un fichier par famille de méthodes
│  │  │  ├─ coords.ts      # conversions tuile/monde/hauteur
│  │  │  └─ util.ts        # utilitaires partagés
│  │  └─ rollup.config.js  # bundle IIFE unique
│  └─ server/              # serveur MCP
│     ├─ src/
│     │  ├─ index.ts       # McpServer + transport stdio
│     │  ├─ bridge.ts      # client TCP du plugin, corrélation id → promesse
│     │  ├─ tools/         # un fichier par famille d'outils
│     │  ├─ planners/      # chemins, fermeture de circuit, scénerie
│     │  ├─ render/        # cartes PNG, overlays, planches-contacts
│     │  ├─ state/         # cache de carte, journal d'opérations, checkpoints
│     │  └─ refdb/         # base de référence (Phase 4)
│     └─ test/
├─ tools/                  # scripts hors-ligne (export de parcs, analyse de style)
├─ reference_db/           # données de référence (Phase 4)
├─ templates/              # parc modèle
└─ fake-plugin/            # faux jeu en Node pour tester le serveur
```

### 5.2 Choix techniques

- **Serveur MCP en TypeScript** avec le SDK officiel `@modelcontextprotocol/sdk` (transport stdio) et `zod` pour les schémas. **[DÉCISION]** Les types partagés entre plugin et serveur évitent les divergences. (Une implémentation Python avec FastMCP est viable ; en ce cas, génère les schémas du protocole depuis une source unique.) Vérifie l'API actuelle du SDK avant d'écrire du code : elle évolue.
- **Plugin** : TypeScript, `target: "ES2020"`, `lib: ["ES2020"]` (sans `DOM`), types fournis par `openrct2.d.ts` (F18, ADR 0001). Bundle unique au format **IIFE** (rollup ou esbuild) : le fichier émis ne doit contenir **ni `import` ni `export`** (les plugins sont évalués comme scripts globaux) ni appel à `Intl`. Un test de build vérifie ces deux points.
- **Rendu d'images côté serveur** : `sharp` (redimensionnement, composition) et un rendu raster simple pour les cartes (canvas SVG → PNG ou `pngjs`). Pas de dépendance à un navigateur.
- **Validation** : chaque outil a un schéma d'entrée strict ; chaque réponse du plugin est validée avant d'être utilisée.

---

## 6. Le plugin OpenRCT2 (`claude-bridge`)

### 6.1 Enregistrement

```ts
registerPlugin({
  name: "claude-bridge",
  version: "0.1.0",
  authors: ["<auteur>"],
  type: "intransient",          // F1 : reste chargé entre les parcs ; requis pour une écoute stable
  licence: "MIT",
  minApiVersion: 124,           // F19 : version de develop à v0.5.5-155 ; à relever dans docs/ENV.md
  targetApiVersion: 124,
  main: main
});
```

Au démarrage, `main()` : lit la configuration (`context.sharedStorage` ou constantes injectées au build), crée le listener, s'abonne aux hooks nécessaires (`interval.tick`, `map.change`, `map.changed`, `map.save`), et journalise (`console.log`).

> `[VÉRIFIÉ F15]` `map.change` est appelé **avant** le déchargement de la carte : vider la file et répondre `BUSY` aux nouvelles requêtes. `map.changed` (réservé aux plugins `intransient`) est appelé **après** le chargement : reconstruire les tables d'objets et émettre `map_changed` (6.12).

### 6.2 Réseau et framing

- `var listener = network.createListener(); listener.listen(PORT, "127.0.0.1");` (F4). Port par défaut proposé : `38491` (différent du port multijoueur 11753). Configurable.
- **Une seule connexion cliente active** à la fois (le serveur MCP). Refuser ou fermer les suivantes.
- **Framing : JSON par lignes (NDJSON)**, un objet JSON par ligne terminée par `\n`. Les événements `data` des sockets peuvent livrer des fragments : accumuler dans un tampon, découper sur `\n`.
- Les données du socket sont traitées comme des chaînes `[À VÉRIFIER]` (encodage, taille maximale d'un write). Écrire de gros résultats **en plusieurs morceaux** de taille raisonnable (par exemple 16 Ko) en conservant la contrainte « une ligne = un message » côté application (les morceaux sont concaténés avant le `\n` final), ou mieux, éviter les gros messages par pagination.
- **Authentification légère :** le premier message doit être `hello` avec un jeton partagé (variable d'environnement côté serveur, `sharedStorage` ou constante côté plugin). Sans jeton valide, fermer la connexion. C'est une protection contre d'autres processus locaux, pas contre un attaquant déterminé.

### 6.3 Modèle d'exécution : file de commandes et budget par tick

Le jeu tourne à environ 40 ticks par seconde (hook `interval.tick`). Tout le JS partage le thread du jeu : un traitement long **gèle** le jeu.

```text
data reçu → parse → validation → file d'attente (FIFO)
interval.tick → tant que (budget non épuisé) : prendre une opération, l'exécuter
              → les callbacks de executeAction/queryAction produisent le résultat
              → quand une requête est terminée, écrire la réponse
```

Règles :
1. **Budget par tick :** au plus *K* opérations (par défaut 20) **ou** *T* millisecondes (par défaut 4 ms mesurées avec `Date.now()`), selon ce qui arrive en premier. Paramétrable.
2. **Une requête = une ou plusieurs opérations.** Les opérations d'une requête s'exécutent dans l'ordre. Les requêtes s'exécutent dans l'ordre d'arrivée (pas de parallélisme : la sémantique doit rester simple).
3. **Les callbacks peuvent être asynchrones** `[À VÉRIFIER]` (en solo, ils sont probablement appelés immédiatement, mais ne pas le présumer). Le moteur de requêtes doit être une machine à états qui attend le callback avant de passer à l'opération suivante si elle en dépend.
4. **Scans de carte :** découper par lignes de tuiles (par exemple 8 lignes de 256 tuiles par tick) et accumuler.
5. **Timeout par requête** (défaut 30 s) avec réponse d'erreur `TIMEOUT`.
6. **Réponse de progression** pour les longues requêtes (optionnel) : `{ id, progress: 0.4 }`.

### 6.4 Mutations : game actions d'abord

- **Préférer systématiquement les game actions** (`executeAction`) à la modification directe de la carte. Elles appliquent les contrôles de coût, de propriété, de dégagement et de permissions, et restent valides en mode B. Elles fournissent aussi des erreurs lisibles.
- **Modification directe (API `map`, tuiles)** : autorisée en solo (F2), utile pour le terrain en masse ou des détails qu'aucune action ne couvre. Chaque méthode qui l'utilise doit :
  - vérifier `network.mode === "none"` et refuser sinon (`NOT_SUPPORTED_IN_MODE`) ;
  - valider les bornes et les invariants (pente max, collision avec chemins existants, cohérence des éléments) ;
  - rester isolée dans un module `direct_edit` facile à désactiver.
- **Cheats (`cheats.*`)** : exposer deux profils, **[DÉCISION]** sélectionnables par l'outil `session_set_mode` :
  - `strict` : aucun cheat qui change la validité ou les notes des attractions (le parc doit être jouable « pour de vrai »). Seuls le budget et la propriété du terrain peuvent être ajustés par des moyens explicites.
  - `sandbox` : active des cheats de confort pour accélérer l'exploration : `sandboxMode` (0), `buildInPauseMode` (11), `ignoreResearchStatus` (44), `ownAllLand` (42), `setMoney` (17), et au besoin `disableClearanceChecks` (1). Un parc construit ainsi doit être marqué « non validé » jusqu'à re-test en `strict`.
  - `[VÉRIFIÉ F20]` `session.cheats.set` passe par l'action `cheatset { type, param1, param2 }` (valide aussi en mode B) ; `session.cheats.get` lit l'objet global `cheats`. Certains cheats (argent, `ownAllLand`, `fixRides`) n'existent que via `cheatset`.
- **Pause et construction :** construire en pause exige probablement `buildInPauseMode` `[À VÉRIFIER]`. En solo, `context.paused` est modifiable directement (lecture seule en réseau) ; sinon, action `pausetoggle`. Recommandation : mettre le jeu en pause pendant les séquences de construction pour que l'argent, les visiteurs et les pannes n'évoluent pas, puis relancer le temps pour les tests.

### 6.5 Coordonnées, hauteurs, directions

Conventions à implémenter dans `coords.ts`. Les unités et les directions en repère carte sont établies par lecture du code (F22) ; le spike S2 (marqueurs asymétriques) reste nécessaire pour le lien avec l'écran et pour les quadrants :

| Notion | Convention |
|---|---|
| Tuile → monde | 1 tuile = 32 unités. `worldX = tileX * 32`. Le centre d'une tuile est à `+16`. [VÉRIFIÉ F22] |
| Hauteur monde (`z`) | En unités monde. Une « marche » de terrain visible vaut 16 unités. [VÉRIFIÉ F22] |
| `baseHeight` d'un élément | Unité de 8 : `z = baseHeight * 8` (les éléments exposent `baseHeight` et `baseZ`). Une marche de terrain = 2 `baseHeight`. Bornes terrain/eau : 2 à 254. [VÉRIFIÉ F22] |
| Unités dans les actions | Unités monde, **sauf** `landsetheight.height` et `watersetheight.height` (unités `baseHeight`). `smallsceneryplace` avec `z = 0` : hauteur automatique (surface ou eau). `rideentranceexitplace` n'a pas de `z`. [VÉRIFIÉ, `docs/SPIKES.md` § S2] |
| Direction (objets, pistes, chemins) | Entier 0 à 3, repère carte : 0 = −X, 1 = +Y, 2 = +X, 3 = −Y. [VÉRIFIÉ F22] À l'écran, rotation 0 : +X vers le bas à gauche, +Y vers le bas à droite [VÉRIFIÉ F28] ; rotations 1 à 3 : [À VÉRIFIER, S8] |
| Rotation de la caméra | Entier 0 à 3 (F7). |
| Pente de surface | Bits des coins relevés N=1, E=2, S=4, W=8, et 16 = diagonale « double hauteur ». [VÉRIFIÉ F22] |
| Pente de chemin | À la pose : `slopeType` (0 plat, 1 en pente) + `slopeDirection` (0-3). En lecture : `FootpathElement.slopeDirection` (`null` si plat). [VÉRIFIÉ, `docs/SPIKES.md` § S2] |
| Quadrant de scénerie | 0 à 3, coin de la tuile pour la petite scénerie : 0 = (−X, −Y), 1 = (−X, +Y), 2 = (+X, +Y), 3 = (+X, −Y) [VÉRIFIÉ F28]. |

**Règle :** toute l'API publique (protocole et outils MCP) utilise des **coordonnées de tuile** (entiers) et des **hauteurs en « niveaux de terrain »** (marches visibles), jamais des unités monde. Les conversions sont internes, centralisées et testées. Les outils renvoient aussi, si utile, les valeurs brutes dans un champ `raw`.

### 6.6 Objets (rides, scénerie, chemins)

- Les actions utilisent souvent des **indices d'objets chargés**, alors que l'utilisateur et Claude manipulent des **identifiants** (chaînes). Le plugin maintient une table `identifier ↔ index` par type, reconstruite à chaque changement de carte.
- `objectManager.installedObjects` liste ce qui est installé ; seuls les objets **chargés dans le parc** sont utilisables. Méthode `objects.list({ type, query, loadedOnly })` et `objects.load({ identifiers })` (F10).
- **Ne jamais coder des identifiants en dur** dans le code ou les prompts : les découvrir à l'exécution. Les exemples de la doc non officielle ne sont pas fiables.
- Le serveur enrichit chaque objet d'un **rôle sémantique** (`tree_conifer_tall`, `shrub_flowering`, `bench`, `lamp_post`, `bin`, `queue_path`, `path_tarmac`…) via `data/object-tags.json`, généré au départ par heuristiques sur les noms et métadonnées, puis revu à la main. Ce sont ces rôles que manipulent les recettes de scénerie (section 11) et la base de référence (section 13).

### 6.7 Captures d'écran

- `capture.view({ centerTile, zoom, rotation, width, height, filename })` appelle `context.captureImage(...)` (F7) avec `position` en coordonnées monde (centre de la tuile ; `z` ignoré).
- Le plugin renvoie le **chemin du fichier** et ses dimensions ; le serveur lit le PNG sur disque (dossier de captures configurable). Pas de binaire dans le socket.
- Noms de fichiers : `claude/<sessionId>/<n>.png` (relatif au dossier de captures). Nettoyer régulièrement.
- **Si `captureImage` échoue ou est absent (mode B, F8)** : renvoyer `NOT_SUPPORTED_IN_MODE` avec `fallback: "cli_screenshot"`. Le serveur peut alors enchaîner : `context.saveGame` dans un fichier temporaire, puis appeler la commande `screenshot` de la CLI sur cette sauvegarde (syntaxe [VÉRIFIÉ F24] : `openrct2-cli screenshot <parc> <png> <w> <h> <x> <y> <zoom> <rotation>`, coordonnées en unités monde ; la sous-commande lit toujours le dossier utilisateur par défaut).
- Le dossier `screenshot/` doit exister (F24) : le serveur le crée avant chaque capture. Noms de fichiers plats (un seul niveau de sous-dossier est créé par le jeu).
- Latence : une capture bloque le thread du jeu pendant le rendu. Éviter les « captures géantes » fréquentes ; préférer des fenêtres ciblées.

### 6.8 Checkpoints (sauvegarde et restauration)

- `checkpoint.save({ name })` → `context.saveGame({ filename: name })` (F9 ; relatif au dossier `save/`, `.park` ajouté automatiquement), puis vérifie la présence du fichier. `[À VÉRIFIER]` Sous-dossiers acceptés dans `filename` (pour isoler les checkpoints dans `save/claude/`). Repli : `console.executeLegacy("save_park <nom>")`, nécessaire en mode B (F26). Les checkpoints sont nommés `claude-<nom>` à plat dans `save/`.
- `checkpoint.restore({ name })` → `console.executeLegacy("load_park <nom ou chemin absolu>")` (F9 ; seule voie de chargement, API dépréciée).
- `[VÉRIFIÉ F23, F25]` Le listener, la connexion TCP, les abonnements et les minuteries survivent à `load_park`, mais **`map.change`/`map.changed` ne sont pas appelés** : le plugin émet `map_changed` lui-même après la commande (restauration en ~200 ms). La pompe utilise `setInterval` (ADR 0002). Le serveur garde une reconnexion automatique avec re-`hello` par prudence.
- Plan B (non nécessaire à ce jour) si `load_park` devenait inutilisable : le serveur gère le processus du jeu (arrêt, relance avec `openrct2 <fichier.park>`) et la reconnexion du plugin.
- Chaque checkpoint enregistre aussi les métadonnées du serveur (journal d'opérations, cache) pour rester cohérent.

### 6.9 Erreurs

Normaliser toute erreur du jeu en :

```json
{
  "code": "GAME_ACTION_FAILED",
  "message": "Can't build here... Land not owned by park",
  "details": {
    "action": "footpathplace",
    "gameError": 1,
    "gameTitle": "Can't build footpath here...",
    "gameMessage": "Land not owned by park!",
    "tile": { "x": 42, "y": 17 }
  },
  "hint": "Utilise land_set_ownership ou active le mode sandbox."
}
```

Codes : `INVALID_PARAMS`, `NOT_FOUND`, `OBJECT_NOT_LOADED`, `NOT_OWNED`, `OBSTRUCTED`, `BAD_SLOPE`, `INSUFFICIENT_FUNDS`, `GAME_ACTION_FAILED`, `NOT_SUPPORTED_IN_MODE`, `BUSY`, `TIMEOUT`, `INTERNAL`. Le champ `hint` est écrit par nous (pas par le jeu) et vise à guider Claude vers la correction.

### 6.10 Performance

À mesurer au spike S9 et à consigner :
- coût d'un `queryAction` et d'un `executeAction` (placement de 1 000 éléments de scénerie) ;
- coût d'un scan complet de la carte 256×256 (65 536 tuiles) et du cache associé ;
- coût d'une capture à 1920×1080 ;
- latence aller-retour d'un message minimal.

Règle : le plugin ne doit pas faire chuter le jeu sous environ 30 ticks/s pendant une opération longue ; ajuster *K* et *T* en conséquence.

### 6.11 Sécurité

- Écoute exclusivement sur `127.0.0.1` (F4 l'impose de toute façon).
- Jeton d'authentification (6.2).
- Aucune méthode de type `eval`, `fs` ou `exec`. Les chemins de fichiers reçus (checkpoints, captures) sont des **noms** validés (`[a-zA-Z0-9_-]+`), jamais des chemins arbitraires.
- Plafonner : taille des messages, nombre d'opérations par requête (par exemple 500), nombre de requêtes en file.

### 6.12 Survie aux changements de carte

À chaque changement de carte, le plugin : invalide ses tables d'objets, vide la file, notifie le serveur par un message `event: "map_changed"` (avec `mapSize`, nom du parc), et se remet dans un état propre. Le serveur invalide alors son cache de carte.

---

## 7. Protocole plugin ⇄ serveur

### 7.1 Format

Un message JSON par ligne. Champ `v` pour la version du protocole (commence à 1).

**Requête**

```json
{ "v": 1, "id": "r-000123", "method": "path.place_tiles", "params": { "dryRun": false, "tiles": [ ... ] } }
```

**Réponse (succès)**

```json
{ "v": 1, "id": "r-000123", "ok": true, "result": { ... }, "tick": 48211 }
```

**Réponse (échec)**

```json
{ "v": 1, "id": "r-000123", "ok": false, "error": { "code": "OBSTRUCTED", "message": "...", "details": { }, "hint": "..." } }
```

**Événement (sans `id`)**

```json
{ "v": 1, "event": "map_changed", "data": { "mapSize": { "x": 128, "y": 128 } } }
```

### 7.2 Handshake

`hello` → `{ token, clientVersion }` → réponse :

```json
{
  "pluginVersion": "0.1.0",
  "apiVersion": 124,
  "networkMode": "none",
  "gameMode": "normal",
  "headless": false,
  "mapSize": { "x": 128, "y": 128 },
  "capabilities": {
    "captureImage": true,
    "directEdit": true,
    "consoleLegacy": true,
    "saveLoad": true,
    "trackSegments": true
  }
}
```

Les `capabilities` sont **mesurées à l'exécution** (tests d'existence des fonctions, tentative inoffensive) et pilotent le comportement du serveur (outils masqués ou dégradés selon le cas).

### 7.3 Méthodes (inventaire)

| Famille | Méthodes |
|---|---|
| `session.*` | `hello`, `info`, `set_paused`, `set_mode`, `cheats.get`, `cheats.set` |
| `park.*` | `overview`, `finances`, `set` (nom, entrée, prêt, publicité), `guests.summary`, `thoughts.summary` |
| `map.*` | `size`, `region` (lecture de tuiles, paginée), `tile`, `scan` (long, par tranches), `ownership.get`, `ownership.set` |
| `terrain.*` | `set_heights`, `raise`, `lower`, `smooth`, `set_surface`, `set_water` |
| `path.*` | `place_tiles`, `remove_tiles`, `place_addition`, `remove_addition` (la connectivité est calculée par le serveur) |
| `ride.*` | `list`, `get`, `create`, `place_track`, `remove_track`, `place_entrance_exit`, `set_status`, `set_setting`, `demolish`, `ratings`, `train` (voitures du premier train : `Car.mass`, `spacing` et `carMass` de l'objet ; vide si aucun train sur la piste) |
| `track.*` | `segments` (table complète), `query_piece`, `place_piece`, `remove_piece`, `iterate` |
| `scenery.*` | `place_small`, `place_large`, `place_wall`, `remove`, `clear_region` |
| `objects.*` | `list`, `get`, `load`, `unload` |
| `staff.*` | `hire`, `fire`, `set_orders`, `set_patrol`, `list` |
| `capture.*` | `view` |
| `checkpoint.*` | `save`, `restore`, `list`, `delete` |
| `time.*` | `run` (laisser tourner N jours/ticks), `status` |
| `batch.*` | `execute` (liste d'opérations, `dryRun`, `stopOnError`) |

Chaque méthode a un schéma zod dans `packages/protocol`, et un test de contrat exécuté contre le faux plugin **et** contre le vrai.

### 7.4 Opérations en lot (`batch.execute`)

```json
{
  "method": "batch.execute",
  "params": {
    "dryRun": true,
    "stopOnError": false,
    "ops": [
      { "action": "footpathplace", "args": { "x": 1024, "y": 1024, "z": 64, "...": 0 } },
      { "action": "smallsceneryplace", "args": { "...": 0 } }
    ]
  }
}
```

Résultat : tableau aligné sur `ops` avec `{ ok, cost, error? }`, plus `totalCost` et `firstFailureIndex`. En `dryRun`, le plugin utilise `queryAction`. **Limite importante :** une simulation d'une opération B qui dépend d'une opération A *non encore exécutée* peut échouer à tort (ex. chemin placé sur une tuile pas encore terraformée). Le serveur doit donc simuler dans l'ordre logique en séparant les lots par dépendance (terrain, puis chemins, puis le reste), et accepter que certains dry-runs soient pessimistes.

---

## 8. Le serveur MCP

### 8.1 Transport et intégration aux clients

- Transport : **stdio** (le client lance le processus). C'est le plus simple avec Claude Desktop et Claude Code.
- Claude Code : `claude mcp add openrct2 -- node /chemin/packages/server/dist/index.js`.
- Claude Desktop : entrée dans le fichier de configuration MCP du client (`mcpServers` → `command` + `args` + `env`).
- Variables d'environnement : `OPENRCT2_HOST` (défaut `127.0.0.1`), `OPENRCT2_PORT` (défaut `38491`), `OPENRCT2_TOKEN`, `OPENRCT2_USER_DIR`, `OPENRCT2_BIN` (optionnel), `OPENRCT2_AUTOSTART` (optionnel : lance le jeu), `LOG_LEVEL`.
- Le serveur **tolère l'absence du jeu** : les outils renvoient une erreur claire (« jeu non connecté ») et le serveur tente de se reconnecter en arrière-plan.

### 8.2 Principes de conception des outils (pour que Claude s'en serve bien)

1. **Peu d'outils, de haut niveau.** Éviter l'exposition un-à-un des game actions. Un outil = une intention (« tracer un chemin », « placer une attraction et la raccorder »).
2. **Descriptions écrites comme des prompts** : à quoi ça sert, quand l'utiliser, ce que ça renvoie, pièges connus, un exemple d'appel.
3. **Entrées en coordonnées de tuile** et niveaux de terrain ; jamais d'unités monde.
4. **`dry_run` partout où c'est utile**, avec coût estimé et liste des problèmes.
5. **Erreurs actionnables** : tuile fautive, cause, `hint`. Jamais « échec » seul.
6. **Résultats compacts et pagination** ; aucune réponse non bornée.
7. **Idempotence autant que possible** (paramètre `idempotencyKey` optionnel pour les créations).
8. **Réversibilité** : chaque outil d'écriture enregistre son inverse dans le journal ; `undo_last` annule. Checkpoints pour les retours plus larges.
9. **Vérification intégrée** : les outils d'écriture renvoient un petit « état après » (par exemple « l'attraction est connectée au chemin : oui/non »), pour éviter des appels de contrôle supplémentaires.
10. **Pas de narration de l'outillage** dans les réponses : informations factuelles seulement.

### 8.3 Format des réponses

- Contenu texte concis (Markdown léger ou JSON compact) **et**, quand c'est pertinent, un bloc image.
- Si le SDK le permet, renvoyer aussi un contenu **structuré** (`structuredContent`) conforme à un schéma de sortie. Vérifier la prise en charge côté clients.
- Toujours inclure `summary` (une phrase), `changed` (compteurs : tuiles, éléments, coût), `warnings[]`, `next_hints[]`.

### 8.4 Images

- Type de contenu MCP `image` (base64, `image/png`).
- Redimensionner côté serveur : **côté long ≤ 1 568 px** (au-delà, le gain de détail est faible pour un modèle de vision et le coût en tokens augmente). Cibler une image par tour d'outil ; trois au maximum pour une planche-contact.
- Compresser (palette réduite pour les cartes schématiques).

### 8.5 Budgets de taille

| Type de réponse | Budget indicatif |
|---|---|
| Texte d'un outil d'écriture | ≤ 400 tokens |
| Texte d'un outil de lecture | ≤ 1 500 tokens (≤ 4 000 sur demande explicite) |
| Carte texte (grille) | ≤ 64×64 tuiles par appel |
| Images | ≤ 1 500 tokens par image, ≤ 3 par réponse |
| Listes (objets, attractions) | 25 éléments par page, `cursor` pour la suite |

Le serveur tronque proprement (avec `truncated: true` et la manière d'obtenir la suite), jamais silencieusement.

### 8.6 État et cache

- **Cache de carte** côté serveur : hauteur, pente, propriétaire, éléments résumés par tuile. Alimenté par `map.scan` au démarrage, mis à jour de façon incrémentale après chaque écriture (à partir des résultats), invalidé sur `map_changed`. Permet des planificateurs rapides (chemins, scénerie, circuits) sans aller-retour avec le jeu.
- **Journal d'opérations** : liste ordonnée `{ id, tool, params, inverseOps, cost, timestamp }`. Sert à `undo_last`, au replay et au débogage.
- **Table des checkpoints** : nom → fichier, date, résumé (argent, notes, nombre d'éléments).

### 8.7 Observabilité

- Journal structuré (JSONL) de chaque appel d'outil : durée, taille de réponse, erreurs, appels au plugin.
- **Enregistrement de session** : appels, réponses (tronquées), captures. Un script `replay` rejoue une session contre le faux plugin ou le jeu.
- Compteurs : taux d'erreur par outil et par code, appels par tâche, tokens estimés par réponse.

---

## 9. Catalogue d'outils MCP

Les noms sont indicatifs. Les outils marqués **P1** forment le MVP.

### 9.1 Session et observation

| Outil | Phase | Rôle |
|---|---|---|
| `session_info` | P1 | État du lien, capacités, mode (`strict`/`sandbox`), pause, parc (nom, argent, note, visiteurs, date), taille de carte, checkpoints. **Premier appel conseillé.** |
| `session_set_mode` | P1 | `strict` ou `sandbox` (6.4). |
| `session_set_paused` | P1 | Pause ou reprise du temps. |
| `list_objects` | P1 | Objets installés ou chargés, filtrés par type, rôle, texte. Retour compact : `id`, `name`, `type`, `loaded`, `role`, `size` si connu. |
| `load_objects` | P1 | Charge des objets dans le parc (F10). Signale les échecs et les limites d'emplacements. |
| `get_park_overview` | P1 | Finances, note du parc, nombre de visiteurs, pensées principales (agrégées), attractions en panne. |
| `get_region_map` | P1 | Carte d'une région : texte en grille avec légende **et/ou** PNG (10.2). Couches texte : `overview`, `height`, `owner`. Options `diff` (tuiles modifiées) et `analysis` (Phase 2 : réseaux coupés, impasses, entrées non raccordées annotés). |
| `inspect_tile` | P1 | Éléments d'une tuile (type, hauteurs, objet, direction, propriétaire). |
| `capture_view` | P1 | Capture du jeu (6.7) ; `annotate` superpose la grille des tuiles et leurs coordonnées, `highlight` entoure des tuiles (Phase 2, 10.3). |
| `capture_contact_sheet` | P2 | Même tuile sous 2 à 4 rotations, assemblées en une image (10.4). |
| `list_rides` / `get_ride` | P1 | Liste et détail : type, état, entrée/sortie, connectée aux chemins, notes, prix, file d'attente, pannes. |

### 9.2 Terrain

| Outil | Phase | Rôle |
|---|---|---|
| `terrain_flatten` | P1 | Aplanit un rectangle à un niveau donné (ou « auto » = médiane), avec marge de raccord en pente douce. |
| `terrain_set_surface` | P1 | Style de surface (herbe, sable, etc.) sur une zone. |
| `terrain_shape` | P2 | Opérations de haut niveau : `hill`, `valley`, `plateau`, `smooth`, `noise`, avec profil et rayon. Calcul sur la grille des coins (F30), bord de zone et tuiles occupées fixes. |
| `water_create_lake` | P2 | Ellipse ou rectangle, niveau (défaut : point bas du pourtour), profondeur, berges en pente vers l'intérieur. |
| `land_set_ownership` | P1 | Acheter ou déclarer constructible une région (selon mode). |

Contraintes à encapsuler : hauteurs discrètes, pentes définies par les coins de chaque tuile (combinaisons invalides), niveau d'eau propre, ordre (terrain d'abord). `terrain_*` renvoie les tuiles dont la pente rend un chemin impossible.

### 9.3 Chemins

| Outil | Phase | Rôle |
|---|---|---|
| `path_build` | P1 | Polyligne de tuiles → pose du chemin avec **choix automatique de la hauteur et de la pente** (rampes), option file d'attente, objet de chemin donné. `level` impose une hauteur fixe (passerelle sur supports, indépendante du terrain sous la polyligne). Renvoie les tuiles posées et les échecs avec causes. |
| `path_remove` | P1 | Retrait sur zone. |
| `path_add_furniture` | P2 | Bancs, lampadaires, poubelles à intervalles réguliers le long des chemins d'une zone (règles F32 ; bancs près des sorties, poubelles près des bancs et boutiques). |
| `path_check_connectivity` | P1 | Graphe des chemins : composantes connexes, entrée du parc reliée ?, impasses, attractions non raccordées. |

### 9.4 Attractions plates, boutiques, entrée

| Outil | Phase | Rôle |
|---|---|---|
| `ride_place` | P1 | **Création complète d'une attraction plate ou d'une boutique** : `ridecreate`, pose de la ou des pièces (`trackplace`), entrée et sortie, couleurs, nom. Option `connect_to_path` qui trace le raccord au chemin le plus proche. Renvoie `rideId`, empreinte, positions d'entrée/sortie. |
| `ride_set_status` | P1 | `closed`, `testing`, `open`. |
| `ride_configure` | P1 | Prix, intervalle de départ, durée, inspection, etc. (`ridesetsetting`, `ridesetprice`). |
| `ride_get_report` | P1 | Notes d'excitation/intensité/nausée (divisées par 100, F12), statut de test, problèmes détectés. |
| `ride_demolish` | P1 | Suppression. |
| `park_set_entrance` | P1 | Pose de l'entrée du parc et des points d'apparition des visiteurs. |
| `park_configure` | P1 | Nom, prix d'entrée, prêt, publicité, recherche. |
| `staff_hire` / `staff_list` | P2 | Personnel (agents d'entretien, mécaniciens, sécurité, artistes), ordres et zones de patrouille (F35). |

> **Piège :** la pose d'une attraction plate ou d'une boutique passe par `ridecreate` (`colour1`/`colour2` sont des index de préréglages) puis `trackplace` avec une pièce fixe par type de ride (`flatTrack1x1A` = 262 pour les boutiques, `flatTrack3x3` = 266 pour la plupart des attractions plates, etc. ; table dans `docs/SPIKES.md` § S2, à générer dans `data/ride_start_piece.json` depuis `src/openrct2/ride/rtd/**`), puis `rideentranceexitplace` (sans `z`). `[VÉRIFIÉ F27]` Origine : centre pour une 3×3, coin minimal pour 2×2 et 4×4, centre de l'axe long pour 1×5. `ride_place` essaie les tuiles d'entrée/sortie autour de l'empreinte et raccorde en évitant les files des autres attractions (le jeu les fusionnerait). Si l'entrée/sortie est surélevée (attraction sur plateforme ou station en hauteur), le raccord bascule automatiquement en **passerelle** (chemin plat ou en rampe sur supports, indépendante du terrain) qui peut monter ou descendre d'un niveau par tuile jusqu'à rejoindre le réseau existant au même niveau ; `coaster_create` et `coaster_place_design` font de même pour l'entrée et la sortie d'un circuit (`routeToNetwork`, `packages/server/src/tools/helpers.ts`). Pour `coaster_place_design`, le raccord essaie d'abord de **contourner l'emprise** du circuit (son rectangle englobant) avant d'accepter de la traverser entre les pièces de piste : la hauteur de dégagement de chaque tuile (`rh`) autorise bien le passage, mais sans cette préférence le chemin trouvé serpente inutilement entre les poteaux de support (invisibles du serveur, qui ne voit que les pièces de piste). Le dégagement est vérifié pièce par pièce (`RegionTile.ri` : intervalles [base, dégagement] de chaque pièce ; un chemin occupe [niveau, niveau+2)), ce qui permet de passer **sous** une pièce haute ou **entre** deux pièces d'un circuit qui se croise. Une passerelle ne repasse jamais sur une de ses propres tuiles (pas de demi-tour en rampe ni de spirale sous son départ), et le raccord est simulé avant d'être posé : en cas de refus du jeu, rien n'est posé (`connected: false`).

### 9.5 Scénerie

| Outil | Phase | Rôle |
|---|---|---|
| `scenery_place` | P1 | Liste d'éléments `{ role|object, x, y, quadrant?, rotation?, zOffset?, colours? }` (≤ 200 par appel). `dry_run` supporté. Renvoie succès, échecs groupés par cause. |
| `scenery_remove` | P1 | Retrait par zone et filtre. |
| `zones_paint` / `zones_get` | P2 | Couche sémantique de zones (11.2). |
| `scenery_scatter_zone` | P2 | Remplit une zone selon une **recette** (section 11). |
| `landscape_audit` | P2 | Défauts classés par gravité avec tuiles et correction : attractions non raccordées, chemins coupés de l'entrée, impasses (hors allée vers le point d'apparition), attractions fermées, zones vides, manque de bancs/poubelles/lampadaires, allées sans végétation, répétition trop régulière ; carte annotée en option. |

### 9.6 Montagnes russes

Voir section 12 (outils `coaster_*`, Phase 3).

### 9.7 Journal, annulation, checkpoints

| Outil | Phase | Rôle |
|---|---|---|
| `undo_last` | P1 | Annule les *n* dernières opérations d'écriture (journal). |
| `checkpoint_save` / `checkpoint_restore` / `checkpoint_list` | P2 | Sauvegarde et restauration d'état (6.8). |
| `run_time` | P2 | Laisse le temps s'écouler (N jours/ticks), puis renvoie un résumé (argent, notes, incidents). |

### 9.8 Référence de style (Phase 4)

`style_get_reference`, `style_search_patches`, `style_apply_patch` : section 13.

### 9.9 Exemple détaillé : `path_build`

```ts
// Entrée
{
  points: [{x:60,y:64},{x:70,y:64},{x:70,y:72}],   // sommets; le serveur remplit les tuiles intermédiaires (4-connexité)
  pathObject: "<id d'un chemin chargé>",
  queue: false,
  allowSlopes: true,        // rampes sur 1 marche de dénivelé
  maxStepPerTile: 1,        // en marches de terrain
  dryRun: false
}
// Sortie
{
  summary: "27 tuiles posées, 0 échec, coût 1 080",
  placed: 27,
  failed: [],
  slopes: [{ x: 66, y: 64, dir: "E", rise: 1 }],
  totalCost: 1080,
  connectivity: { componentsAfter: 1, connectedToParkEntrance: true },
  next_hints: ["Raccorde l'attraction 'Carousel' (rideId 3) : l'entrée est en (72,73)."]
}
```

Cas d'échec : dénivelé trop fort → `BAD_SLOPE` avec les tuiles concernées et le hint « Utilise terrain_flatten sur la bande (x 64–70, y 64) ».

---

## 10. Vision et feedback spatial (sans fork)

Les modèles de vision lisent mal les coordonnées exactes. Sans fork, on compense côté serveur.

### 10.1 Trois sources de « vue »

1. **Capture du jeu** (`captureImage`) : réaliste, utile pour juger l'ambiance. Peu fiable pour mesurer.
2. **Carte schématique rendue par le serveur** à partir des données de carte (cache) : vue de dessus **exacte**, avec grille et étiquettes. C'est l'outil principal de raisonnement spatial.
3. **Carte texte** (grille de caractères) : très économe en tokens, adaptée aux petites régions.

### 10.2 Carte schématique (`get_region_map`)

- Raster 1 tuile = *n* pixels (par exemple 12 à 24), couleurs par type : herbe, sable, eau, chemin, file d'attente, empreinte d'attraction, entrée/sortie (symboles), scénerie (densité par teinte), terrain non possédé (hachures).
- **Ombrage par hauteur** (courbes de niveau ou dégradé) et marqueurs de pente.
- **Grille étiquetée** tous les 8 ou 16 tuiles ; **étiquettes** pour les attractions et zones ; flèches pour la direction des entrées.
- Option **différentiel** : carte avant/après (tuiles modifiées en surbrillance).
- Option **analyse** : chemins connectés (couleur par composante), impasses, tuiles « à problème » signalées par les audits.

### 10.3 Annotation des captures du jeu

Pour relier pixels et tuiles sur une capture :
1. Projection isométrique dans `render/projection.ts`, reprise du code du jeu **[VÉRIFIÉ F34, rotations 0 à 3]** : `r = (x, y).rotate(rotation)`, `sx = r.y − r.x`, `sy = (r.x + r.y) / 2 − z`, puis division par `2^zoom` et translation pour centrer sur `position` (à la hauteur du terrain au centre de la tuile).
2. ~~Calibrage empirique~~ : inutile, la formule vient du code ; la vérification visuelle en jeu (S8) a suffi.
3. Grille et étiquettes dessinées sur la capture avec `pngjs` (`render/annotate.ts`), sans dépendance native.
4. **Limite connue :** les éléments hauts masquent des tuiles ; la grille se base sur la hauteur du terrain, pas sur celle des structures.

### 10.4 Planche-contact multi-angles

`capture_contact_sheet({ centerTile, zoom, rotations: [0,1,2,3] })` : quatre captures assemblées en une seule image (une image = moins de tokens, une vue d'ensemble). Utile pour juger l'intégration d'une attraction.

### 10.5 Boucle de contrôle recommandée pour Claude

1. `get_region_map` (schématique) pour planifier.
2. Outils d'écriture en `dry_run`, puis réels.
3. `get_region_map` en différentiel pour vérifier.
4. `capture_view` ou `capture_contact_sheet` pour l'ambiance, de temps en temps seulement.
5. `landscape_audit` / `path_check_connectivity` pour les contrôles automatiques.
6. `checkpoint_save` avant toute étape risquée.

---

## 11. Terraformage et scénerie générative

### 11.1 Principe

Claude **compose** (intentions, zones, ambiances) ; un **générateur** déterministe **place**. Claude ne place jamais des centaines d'arbres un par un.

### 11.2 Couche sémantique de zones

Couche portant un **type de zone** : `forest_dense`, `forest_edge`, `meadow`, `flower_bed`, `lakeshore`, `plaza`, `queue_screening`, `path_border`, `under_coaster`. Outils : `zones_paint({ rect|polygon, type })`, `zones_get`. **[DÉCISION 1.3]** Stockée à la tuile plutôt qu'en cellules 4×4 (plus précis, mémoire négligeable), dans le serveur, et sauvegardée avec les checkpoints (`save/claude-meta/`).

### 11.3 Générateur

Entrée : zone + recette + graine (`seed`) pour la reproductibilité. Ingrédients :
- **Échantillonnage de Poisson-disc** avec rayon variable (pas de tirage uniforme).
- **Densité modulée** par bruit cohérent (plusieurs échelles) et par distance aux bords, chemins, eau, attractions.
- **Couches d'objets** : grands arbres, arbres moyens, buissons, fleurs, couvre-sol ; proportions par essence (ex. 70 % / 20 % / 10 % d'accents).
- **Dégagements fonctionnels** : rien dans 1 à 2 tuiles autour des entrées d'attractions, intersections, files d'attente ; rien sur les tuiles nécessaires à un futur raccord.
- **Placement fin** : quadrant de la tuile, décalage de hauteur, rotation, pour casser la régularité.
- **Contraintes OpenRCT2** : une tuile peut porter plusieurs éléments de petite scénerie selon quadrants et hauteurs ; vérifier par `queryAction` ; plafonner le nombre d'éléments (performances, limites de la carte).

### 11.4 Recettes thématiques

`data/recipes/<thème>.json` : `{ theme, description, zones: { <zoneType>: { density, layers:[{role, share, minSpacing, fallback?}], noise?, edge?, pathAffinity?, clearances?, require?, variety? } } }` (schéma zod dans `planners/recipes.ts`). Thèmes livrés : `temperate`, `tropical`, `desert`, `western`, `formal`. Les recettes sont **paramétrées par des rôles d'objets** (6.6), pas par des identifiants. Une table de correspondance rôle → objets réellement chargés est établie à l'exécution, avec repli si un rôle n'a aucun objet.

### 11.5 Terraformage de haut niveau

Opérations sur heightmap (`hill`, `valley`, `plateau`, `smooth`, `noise`, `ramp_for_path`, `flatten_for(ride)`), calculées côté serveur sur le cache, puis converties en `landsetheight` / `landsmooth` ou en modification directe en lot (mode A uniquement), avec **garde-fous** : pente maximale par tuile, interdiction de casser des chemins ou attractions existants sans confirmation (`allowDisturb: true`).

**Ordre de travail :** terrain → chemins et attractions → scénerie → finitions (mobilier, détails).

---

## 12. Montagnes russes

### 12.1 Constat

Poser des pièces une à une exige un raisonnement 3D précis (fermeture du circuit, hauteur, orientation, énergie, forces G, collisions). Les LLM y échouent seuls. Il faut déplacer ces contraintes vers des **outils de recherche et de validation**, et laisser à Claude la structure, le rythme et le thème.

### 12.2 Données de base : la table des segments de piste

- `context.getAllTrackSegments()` (F11) donne, par type de pièce, les propriétés géométriques. **À exporter une fois** vers un fichier JSON versionné (`data/track_segments.json`) par le spike S5, avec les champs réels (F11) : `type`, `description`, `length`, `endX`, `endY` (début toujours en 0,0), `beginZ`, `endZ` (relatifs à la base du premier bloc), `beginDirection`, `endDirection` (0-7 ; 4 = début diagonal), `beginSlope`, `endSlope`, `beginBank`, `endBank` (l'inclinaison), `elements` (blocs occupés), `trackGroup`, `mirrorSegment`, drapeaux (`isInversion`, `allowsChainLift`…).
- Disponibilité par type d'attraction : l'API n'expose que le `trackGroup` de chaque pièce, pas les groupes autorisés par type de ride. Les déterminer empiriquement par `queryAction('trackplace', …)` ou en lisant `enabledTrackGroups`/`extraTrackGroups` dans `src/openrct2/ride/rtd/**` ; consigner dans `data/ride_track_support.json`.

### 12.3 Marcheur de piste (`track walker`)

Module du serveur qui, à partir d'une **pose** `(x, y, z, direction, pente, inclinaison)` et d'un type de pièce, calcule la **pose suivante** en appliquant le décalage de fin du segment tourné selon la direction. Il sert à :
- construire une séquence de pièces ;
- énumérer les successeurs possibles ;
- rejouer un design `.td6` (12.7) ;
- calculer l'emprise (blocs occupés) pour détecter les collisions sur le cache de carte.

À valider sur des circuits existants via `map.getTrackIterator` : `TrackIterator.nextPosition` donne la pose attendue de la pièce suivante (comparaison calcul vs. réalité).

### 12.4 Outils `coaster_*` (Phase 3)

| Outil | Rôle |
|---|---|
| `coaster_create` | Crée l'attraction et la station (type, objet de ride, position, orientation, longueur de station). |
| `coaster_next_pieces` | Liste les **pièces valides** à la pose courante : chacune est testée par `queryAction('trackplace', …)` ; renvoie type, description, pose finale, coût. Claude *choisit* au lieu d'inventer. |
| `coaster_append` | Ajoute une ou plusieurs pièces (avec `dryRun`). |
| `coaster_undo` | Retire les *n* dernières pièces (`trackremove`). |
| `coaster_plan_closure` | Cherche un chemin de ≤ *N* pièces qui ramène à la station (13.5). |
| `coaster_build_plan` | Compile un plan en **macro-éléments** (12.6) en pièces, valide, construit avec retour arrière en cas d'échec. |
| `coaster_describe` | Relit un circuit du parc (`ride`) ou un design `.td6` (`design`) pour s'en inspirer : mesures (`layout`), relief (`relief` : pièces à 60° et 90°, éléments hauts, point haut par cinquième) et séquence des pièces groupées avec les hauteurs (12.6). |
| `coaster_list_designs` | Liste les designs `.td6`/`.td7` installés (nom, type, véhicule installé ou non, notes attendues, emprise) (12.7). |
| `coaster_place_design` | Place un `.td6` (12.7). |
| `coaster_test` | Passe en `testing`, laisse tourner, renvoie le rapport (12.8). |
| `coaster_rating_breakdown` | Recalcule les notes d'un circuit testé terme par terme, comme `RideRatings.cpp`, avec valeur d'entrée, plafond et leviers chiffrés (COASTER_REFERENCE P1). |
| `coaster_compare` | Met un circuit et sa référence côte à côte (notes, écart par composante, emprise, profils de vitesse et de G, éléments, relief) et donne les trois leviers qui rapportent le plus, plus les leviers de relief (`reliefLevers`) ; teste d'abord ce qui n'a pas de mesure à jour (COASTER_REFERENCE P2). |

> Implémentation (1.4) : `coaster_plan_closure` est intégré à `coaster_build_plan` (`plan: []`, `close: true`, `dryRun` pour seulement planifier). Les montées de la fermeture portent une chaîne (garantit le retour en gare sans calcul d'énergie). Implémentation (1.5) : `coaster_list_designs` et `coaster_place_design` (12.7).

### 12.5 Fermeture du circuit (le point critique)

Problème : de la pose courante à la pose de la station (position, hauteur, direction, pente nulle), avec les pièces autorisées.

Approche **[DÉCISION]** : recherche **bidirectionnelle** (en avant depuis la pose courante, en arrière depuis l'entrée de station) avec A* :
- État : `(x, y, z, direction, pente, inclinaison, drapeaux: chaîne/freins)`.
- Transitions : segments valides du type d'attraction (12.2, 12.3).
- Heuristique : distance de Manhattan au but + écart de hauteur + pénalité de direction.
- Filtres : collision avec le cache de carte et le circuit déjà posé, dégagement vertical, hauteur min/max, propriété du terrain.
- Résultat : plusieurs solutions classées (longueur, rayon des virages, énergie estimée). **Validation finale par `queryAction`** pièce par pièce avant exécution.

### 12.6 Macro-éléments

Claude planifie en 10 à 20 macro-éléments plutôt qu'en 150 pièces :

`lift_hill(height)`, `drop(height, angle)`, `camelback(height)`, `helix(turns, radius, bank)`, `s_bend`, `turnaround(radius)`, `straight(n)`, `brake_run(n)`, `loop`, `corkscrew`, …

Chaque macro est compilé en pièces par le planificateur ; échec = erreur structurée (« la pièce 14 collisionne avec le chemin en (60,64) »). Le plan reste éditable (liste de macros), ce qui permet à Claude de corriger localement.

**Macros implémentées** (`planners/track.ts`, `compileMacros`) : `straight{length}`, `lift{height, steep?}` (chaîne droite ; raide par défaut si le type le permet, `steep: false` pour un lift 25°), `climb`, `drop{height, steep?}`, `hill{height, steep?}` (colline : montée puis descente de même hauteur), `turn{dir, size: small|medium|large, banked?, quarters?, slope: flat|up|down|steep_up|steep_down}` (`large` = huitième vers la diagonale puis retour, `steep_*` = virage d'1 tuile à 60°), `helix{dir, quarters, down?, size}` (large par défaut), `inversion{kind, dir, size?}`, `dive{dir, size?, height?, turn?}` (demi-boucle puis quart de boucle vers la verticale descendante), `quarter_loop{exit, dir, height?, turn?}` (montée verticale, quart de boucle sur le dos, sortie à l'endroit), `vertical_drop{height, turn?}` (COASTER_SPACE.md, section 8), `loop{dir}` (petite boucle verticale), `s_bend`, `brakes`, `block_brakes`, `photo`, `level`, `piece{name, chain?}`. Un plan compte jusqu'à 60 macros.

`inversion` pose une inversion complète (entrée et sortie à l'endroit). Sans `size`, la plus grande taille disponible est prise. Les paires viennent des 201 designs de RCT2 :

| `kind` | small | medium / large |
|---|---|---|
| `loop` | `{d}VerticalLoop` | `{d}{Medium,Large}HalfLoopUp` + `{o}…HalfLoopDown` |
| `immelmann` | `halfLoopUp` + `{d}BarrelRollDownToUp` (sinon vrille, sinon tire-bouchon) | idem avec la demi-boucle `{d}{Medium,Large}` |
| `dive_loop` | `{d}BarrelRollUpToDown` (sinon vrille, tire-bouchon) + `halfLoopDown` | idem avec `{d}{Medium,Large}HalfLoopDown` |
| `corkscrew` | `{d}CorkscrewUp` + `{o}CorkscrewDown` | `{d}LargeCorkscrewUp` + `{o}LargeCorkscrewDown` |
| `zero_g_roll` | `{d}ZeroGRollUp` + `{d}ZeroGRollDown` | `{d}LargeZeroGRollUp` + `{d}LargeZeroGRollDown` |
| `barrel_roll` | `{d}BarrelRollUpToDown` + `{d}BarrelRollDownToUp` (sinon vrilles) | — |

(`{d}` = côté demandé, `{o}` = côté opposé.) L'erreur d'une inversion indisponible liste celles que le type permet ; `coaster_create` les annonce aussi.

**Retour sur le style.** `coaster_build_plan` renvoie `layout` (pièces, `lengthTiles`, emprise, `density` = tuiles de piste par tuile d'emprise, niveaux min/max, inversions) et des `warnings` non bloquants : chaîne posée sur un virage, virage serré (3 tuiles ou petite hélice) ou non incliné pris à grande vitesse. La vitesse est estimée par la hauteur perdue depuis le point le plus haut. `coaster_describe` donne les mêmes mesures pour un circuit de référence, ainsi que sa séquence (« `17×up25⛓ L-0.5→16.5, …` », hauteurs en niveaux au-dessus de la station). Exemple, Frightmare : 112 pièces, 205 tuiles de piste sur 24×17 (densité 0,5), lift droit de 19 pièces, 5 inversions, et un tracé qui plonge jusqu'à 7 niveaux sous la station.

> Constat (7 octobre 2026), tentative « dans le style de Frightmare » sans ces outils. Claude n'avait aucun moyen de lire la référence. La seule inversion proposée était la petite boucle verticale. Les consignes demandaient « 5 à 15 macros », et le plan était limité à 30. Résultat : lift replié en virage, petite boucle, hélice serrée à pleine vitesse, et 71 pièces (491 m) sur 35×30, contre 112 pièces sur 24×17 pour la référence.

### 12.7 Designs `.td6`

- `[VÉRIFIÉ F21 — spike S6]` Aucune voie directe : l'action `trackdesign` existe mais ne transmet pas le design depuis un script, et aucune API ne charge un `.td6`.
- **Méthode retenue et implémentée (1.5, F40) :** le serveur lit le `.td6` (`planners/td6.ts` : RLE, en-tête, pièces, entrées/sorties ; la scénerie est seulement comptée) et le **rejoue** avec le marcheur de piste (12.3) : `ridecreate`, suite de `trackplace` (`isFromTrackDesign: true`, drapeaux chaîne et inversé, vitesse de frein, schéma de couleurs, rotation de siège), entrée/sortie, réglages.
- **Bibliothèque :** `<game_path>/Tracks` (lu dans le `config.ini` du dossier utilisateur, ou `OPENRCT2_RCT2_PATH`), `<dossier utilisateur>/track/`, et `OPENRCT2_TRACKS_DIR` (dossiers séparés par `:`). Fichiers `.td6` et `.td7`, sous-dossiers compris ; lue une fois puis gardée en mémoire (`refresh: true` pour relire).
- **Véhicule :** l'objet est retrouvé par son nom DAT (`legacyIdentifier`, exposé par `objects.list` depuis la 1.5) et chargé s'il ne l'est pas ; `object` permet d'en imposer un autre. Le type d'attraction est celui du design s'il est déclaré par l'objet, sinon le premier type à circuit de l'objet (équivalent de `RCT2RideTypeToOpenRCT2RideType` : hyper, classic mini, monster trucks…).
- **Outils :**
  - `coaster_list_designs { query?, installedOnly = true, maxSize?, sort: name|excitement|size }` : nom, type, véhicule, notes attendues, emprise (direction 0), pièces, navette ou non, nombre d'éléments de scénerie.
  - `coaster_place_design { design, x, y, direction = 0, anchor = corner|origin, level?, object?, name?, connectToPath = true, dryRun }` : `(x, y)` est le coin de l'emprise aux x et y minimaux (ou l'origine du design avec `anchor: 'origin'`) ; `direction` est celle de la première pièce. Hauteur par défaut : la plus basse qui garde tous les blocs au-dessus du terrain et de l'eau (équivalent de `TrackDesignGetZPlacement`), arrondie au niveau. Contrôles serveur (terrain possédé, chemins, autres attractions, entrées) avant toute pose ; si le jeu refuse une pièce, l'attraction est démolie et rien n'est gardé. Réglages appliqués : mode, départ, attentes, opération, vitesse du lift, nombre de tours, trains et voitures, couleurs de piste et de véhicules. Puis raccord de l'entrée (file d'attente) et de la sortie au chemin, comme `coaster_create`.
- **Limites :** la scénerie du design n'est pas posée (l'excitation mesurée est un peu plus basse que celle du fichier) ; labyrinthes, attractions plates et designs RCT1 (`.td4`) refusés ; une seule station est supposée pour l'entrée/sortie si la pièce voisine n'est pas trouvée.
- Bibliothèque de designs : respecter les licences de chaque design ; ne pas redistribuer sans accord.

### 12.8 Test et rapport

> **Implémenté (7 octobre 2026) : vitesse mesurée et prédite.** Sans vitesse, le planificateur posait des éléments au hasard de l'élan : par exemple un zero-g roll au ras du sol juste après la grande chute (intensité 14,6, 5,5 G). Trois pièces :
>
> 1. **Mesure.** `time.run { sample: { ride } }` relève à chaque frame la vitesse de la tête du premier train (`car.velocity` / 65536, l'unité des consignes de frein ; le serveur multiplie par 2,25 pour des mph affichés, car `ToHumanReadableSpeed` = velocity × 9 >> 18) sur sa pièce, et les G verticaux et latéraux de chaque voiture (`car.gForces`, centièmes de g) sur la sienne. Le résultat est agrégé par pièce : `PieceSample` (vitesse d'entrée, min, max, G). `track.circuit` renvoie aussi `chain` et `brakeSpeed` (mph) de chaque pièce.
> 2. **Rapport.** `coaster_test` ferme deux fois l'attraction avant l'essai, ce qui efface un accident précédent (`RideSetStatusAction` n'efface l'indicateur que sur une attraction déjà fermée). Il renvoie `profile`, la séquence groupée avec la vitesse d'entrée mesurée (« `@km/h` »), et `hotspots` : la pièce aux G verticaux max, celle aux G min, celle aux G latéraux max et la plus lente hors freins, avec index, tuile et vitesse.
> 3. **Modèle** (`planners/speed.ts`). Il suit la forme de `Vehicle.TrackMotion.cpp` (gravité selon la pente, traînées linéaire `v/4096` et quadratique `(v>>8)²/16/masse`), ramenée à la distance : `Δv² = K·descente(niveaux) − (k1·v + k2·v²)·longueur(tuiles)`, v en mph. La chaîne maintient au moins la vitesse du lift, les freins plafonnent à leur consigne (`brakeSpeed` × 2,25 mph : rangé ÷ 2 et relu × 2 dans `TrackElement.cpp`, comparé à velocity >> 16), la station repart à `stationSpeed`. Valeurs par défaut K = 172, k1 = 0,15, k2 = 0,0015 : Frightmare atteint 101 km/h au bas de la chute (mesuré : 101) sans caler nulle part. Chaque `coaster_test` réussi recale K, k1, k2, `invExtra` (hauteur supplémentaire au sommet des inversions, 0 par défaut) et la vitesse du lift. Pour cela, il simule tout le circuit depuis la station et minimise l'écart moyen aux vitesses mesurées (recherche sur grille). Le nouveau calage n'est gardé que s'il fait mieux que l'ancien. Un ajustement pièce à pièce par moindres carrés donnait 21 km/h d'écart moyen, car à vitesse 4 une frame couvre 4 ticks et la « vitesse d'entrée » tombe n'importe où dans la pièce. La simulation globale donne 5,4 km/h sur Frightmare (K = 170, k1 = 0, k2 = 0,002). Le résultat est gardé par type d'attraction dans `<dossier utilisateur>/claude-speed-model.json`, avec l'erreur moyenne en km/h.
>
> **Décomposition des notes (P1).** Après un essai réussi, `coaster_test` renvoie `rating` : les notes recalculées et chaque terme de `RideRatings.cpp`. Le recalcul est exact sur Frightmare et Nightmare Frenzy. Les entrées que l'API `Ride` n'expose pas sont recomptées sur les pièces (virages, inversions, hélices) ou lues par `track.rating_scan` (proximité, abri, scénerie). Le détail est dans COASTER_REFERENCE.md, P1. L'essai est aussi gardé pour `coaster_compare`.
>
> **Fenêtres de vitesse minimale.** Pour chaque inversion, on relève aussi la vitesse la plus basse dans l'élément : la pièce, puis les suivantes tant que le train est à l'envers (`elementMinSpeed`). Le seuil est la médiane des designs RCT2 : tire-bouchon 44 km/h, demi-boucle 37, boucle verticale 48. Un avertissement « TROP LENT AU SOMMET » part sous 80 % de cette médiane. Mesuré en jeu : un grand tire-bouchon pris à 63 km/h passe son sommet à 28 km/h, alors que le modèle en prédisait 41 ; pris à 78 km/h, il passe à 52.
>
> **Longueur et masse du train (8 octobre 2026, à valider en jeu).** Le modèle ci-dessus traitait le train comme un point. Le jeu fait autrement (`Vehicle::UpdateTrackMotion`) : chaque voiture reçoit l'accélération de sa propre pente, le train prend la moyenne sur ses voitures, et la traînée quadratique `(v >> 8)² / 16` est divisée par la masse totale (`GetAccelerationDecrease2`) ; la traînée linéaire `v / 4096` ne dépend pas de la masse. Deux conséquences, que l'utilisateur a observées en jeu :
>
> 1. **À voitures égales, un train plus court (plus léger) perd sa vitesse plus vite.** `k2` est désormais rapporté à la masse du train de calage (`massRef`, gardé dans `claude-speed-model.json`) : k2 effectif = k2 · massRef / masse. Un fichier de calage sans `massRef` garde son `k2` tel quel jusqu'au prochain `coaster_test`.
> 2. **La pente agit sur la hauteur moyenne des voitures.** Intégrée sur la distance, la moyenne des accélérations des voitures est la variation de leur hauteur moyenne. `simulateTrain` place la voiture k à k × (longueur d'une voiture) derrière la tête et suit cette moyenne. Un train long s'étale sur une crête ou un sommet d'inversion, un train court suit le profil de près. La chaîne tire tant qu'une voiture est sur une pièce à chaîne. Avant la première pièce, les voitures sont à la hauteur de son début. Une voiture de longueur nulle redonne exactement le modèle ponctuel.
>
> Données : méthode `ride.train` du plugin (`Car.mass`, avec les visiteurs, et `RideObjectVehicle.spacing`). Longueur du train en tuiles = Σ spacing / 0x44180, la longueur d'une tuile de station dans `Ride.cpp`. Les trains n'existent qu'en essai ou ouverts. Le serveur garde donc le dernier train vu par attraction (et dans `claude-coaster-measures.json`), sinon il revient au modèle ponctuel. `coaster_test` lit le train pendant l'essai et cale avec lui. `coaster_build_plan` simule le circuit existant et le plan d'un seul tenant (les voitures de queue sont encore sur les pièces d'avant) et indique le train dans `speeds.model`. Les fenêtres d'entrée des designs RCT2 sont recalculées avec le nombre de voitures de chaque design et la longueur et la masse par voiture du train courant (même véhicule supposé).
>
> **Freins.** `coaster_build_plan` avertit (`FREINS TROP COURTS`) quand la ligne de freins avant la station, ou la section qui mène à un frein de bloc, est plus courte que le train (`brakeRuns`). Exemple : Frightmare a 4 tuiles au frein de bloc de mi-parcours et 2 avant la station.

> **Modifier la piste d'un circuit en essai.** `coaster_build_plan`, `coaster_append`, `coaster_undo` et `coaster_test` ferment deux fois l'attraction avant d'agir. Retirer une pièce sous un train en essai le fait s'écraser, et l'indicateur d'accident bloque les essais suivants tant qu'on n'a pas fermé deux fois.
>
> **Fenêtres d'entrée.** Pour chaque genre d'élément (nom de pièce sans le côté : `verticalLoop`, `corkscrewUp`, `bankedQuarterTurn3Tiles`, `halfBankedHelixDownSmall`…), le modèle calcule la vitesse d'entrée sur les 186 circuits fermés de RCT2 et en garde les 10e, 50e et 90e centiles. Exemples avec les valeurs par défaut : boucle verticale 64-78 km/h, tire-bouchon 51-65, demi-boucle 68-74, grande demi-boucle 90-95, virage incliné de 3 tuiles 34-67. Les éléments propres à OpenRCT2 empruntent la fenêtre de l'élément classique le plus proche : zero-g roll → tonneau, grand zero-g → boucle verticale, grand tire-bouchon → tire-bouchon, demi-boucle moyenne → demi-boucle.
>
> **Retour dans `coaster_build_plan`.** `speeds` donne la vitesse au curseur, puis par macro l'entrée, la sortie et le minimum (km/h), le niveau de fin et un calage éventuel, ainsi que l'entrée et la sortie de la fermeture. Des `warnings` signalent un « CALAGE probable » (vitesse nulle dans la pièce), un élément « TROP RAPIDE » (au-dessus de p90 × 1,15 + 3 mph) ou « TROP LENT » (sous p10 × 0,85 − 2 mph), avec la plage relevée. `coaster_describe` affiche les vitesses estimées de la référence. La macro `hill { height }` (colline) sert à freiner le train avant un élément.

- `ride.set_status(testing)` puis laisser tourner (13.6 du temps de jeu).
- Rapport structuré : excitation, intensité, nausée (÷100), vitesse max, longueur, G vertical/latéral max, nombre de descentes, **statut du test** (terminé, bloqué, calage), **localisation des problèmes** (pièce où le train cale, virage à G latéral excessif, collision…). `[À VÉRIFIER]` quelles propriétés de `Ride` exposent ces valeurs ; sinon, les approcher par simulation côté serveur ou par échantillonnage de la position/vitesse des wagons (`map.getAllEntities('car')`) pendant le test.
- Accélération du temps : `[À VÉRIFIER — spike S7]` en mode A, vitesse de jeu réglable depuis le plugin ? Sinon prévoir la patience (temps réel) ou le recours au cheat de test rapide s'il existe.

### 12.9 Ce qui reste difficile

- Atteindre des notes élevées (heuristiques à calibrer sur des exemples réels).
- Intégrer le circuit au terrain (tunnels, passages sous des chemins) : contraintes supplémentaires dans la recherche.
- Esthétique du tracé.
- Types exotiques (multi-lancements, pièces volantes, quarts de boucle à 90° comme ceux de Frightmare : seulement par `piece`).
- La fermeture A* pénalise les S-bends (coût +3) sans les interdire ; une fermeture courte depuis une pose mal orientée peut encore en contenir.
- Imiter un circuit de référence : la décomposition de la note et la comparaison sont faites (P1, P2). Les mesures d'espace (éléments, croisements, empilement, plus grand vide, volume libre) sont calculées par `planners/space.ts`, pas encore exposées par les outils (COASTER_SPACE.md, étape 1). Ce qui manque encore au serveur (vue spatiale, recherche de section sous contraintes, G prédits, dégagement réel, état fiable) est détaillé dans [COASTER_REFERENCE.md](COASTER_REFERENCE.md). Ce qui manque pour construire aussi compact que la référence (mesures d'espace, rectangle imposé, croisements serrés) est dans [COASTER_SPACE.md](COASTER_SPACE.md).

Commencer par **un seul type de coaster** (acier classique à chaîne) sur terrain plat.

---

## 13. Base de référence de style (Phase 4)

### 13.1 Principe

Extraire des **statistiques de style** et des **patchs** à partir de parcs de référence, les stocker hors du contexte de Claude, et les lui fournir **à la demande** via des outils. Pas d'entraînement : de la récupération.

### 13.2 Pipeline hors ligne

1. **Export** : script (ou méthode `scenery.export_region`) qui lit les éléments de scénerie, chemins et attractions d'une région d'un parc chargé dans le jeu (via `map.getTile` par tranches). Sortie : JSON compact par région.
2. **Normalisation** : mapping des objets vers des **rôles** (6.6). Les objets personnalisés sans équivalent sont marqués `unmapped`.
3. **Analyse** : descripteurs de style par parc et par type de zone : composition par rôle/couche, densité selon la distance aux chemins/attractions/eau/bords, taille et espacement des bosquets, corrélations avec le relief, motifs de finition.
4. **Patchs** : découpage en 8×8 à 16×16 tuiles, étiquetés (`forest_edge_north`, `park_entrance_formal`, `pond_bank`, …) et stockés en encodage compact.
5. **Images** : vues de dessus annotées (carte schématique, 10.2) et captures du jeu.
6. **Index** : SQLite (tags, thèmes, types de zone, métriques).

### 13.3 Tailles (ordres de grandeur)

| Élément | Taille |
|---|---|
| Export brut d'un grand parc | 5 à 20 Mo |
| Descripteur de style | 1 à 3 Ko (≈ 500 à 1 000 tokens) |
| Patch 16×16 | 2 à 6 Ko |
| Image de référence | 100 à 500 Ko |
| Réponse d'un `style_get_reference` | 3 000 à 10 000 tokens au total |

Volume utile : 10 à 20 parcs ou zones, 5 à 10 exemples par couple (thème, type de zone), 200 à 500 patchs bien étiquetés. Le goulot est l'**étiquetage humain** : pré-étiqueter avec Claude à partir des cartes schématiques, puis relire.

### 13.4 Disposition sur disque

```text
reference_db/
  index.sqlite
  descriptors/*.json
  patches/*.json
  images/*.png
  LICENSES.md        # origine et droits de chaque source
```

### 13.5 Outils MCP

| Outil | Rôle |
|---|---|
| `style_get_reference({ theme, zone_type, max_examples })` | Descripteur compact, 1 à 3 images annotées, patchs candidats (étiquette, dimensions, résumé d'une ligne). |
| `style_search_patches({ tags, zone_type, size, limit })` | Recherche filtrée, résultats plafonnés. |
| `style_apply_patch({ patch_id, at, rotation, mirror, variation, role_map })` | Applique un patch (rotation/miroir, remplacement d'objets par rôle, ajustement à la hauteur du terrain, bruit pour casser la répétition). |

Aucun outil « tout lister ». Chaque patch porte une **étiquette lisible** et un **résumé d'une ligne**.

### 13.6 Droits et éthique

- Analyser des parcs pour en tirer des **statistiques de style** est différent de **recopier** des zones entières. Pour les parcs de NE Designs (`nedesigns.com`) et de tout autre créateur, **demander l'accord des auteurs** avant de réutiliser des zones ou de distribuer des dérivés. Pour un usage strictement personnel et expérimental, c'est moins sensible, mais cela ne remplace pas un avis juridique.
- Consigner dans `LICENSES.md` la provenance et les droits de chaque référence.
- Éviter la « copie fade » : extraire plusieurs styles distincts et laisser Claude choisir et combiner.

---

## 14. Guide d'usage pour Claude à l'exécution

À fournir comme **instructions système** (ou fichier d'instructions du projet), 1 000 à 2 000 tokens, en plus des descriptions d'outils :

```text
Tu construis un parc dans OpenRCT2 via des outils MCP.

Méthode
1. Commence par session_info, puis get_park_overview et get_region_map sur la zone de travail.
2. Planifie par zones (entrée, allée principale, places, attractions, coasters, boutiques, nature).
3. Ordre de travail : terrain → chemins → attractions et boutiques → scénerie → détails.
4. Avant toute écriture importante : checkpoint_save. Utilise dry_run quand c'est possible.
5. Après chaque étape : vérifie avec get_region_map (différentiel) et path_check_connectivity.
6. Utilise capture_view/capture_contact_sheet pour juger l'ambiance, pas pour mesurer des positions.
7. En cas d'échec d'un outil, lis le hint, corrige la cause (terrain, propriété, objet non chargé), puis réessaie. Après deux échecs identiques, change d'approche.

Règles
- Travaille en coordonnées de tuile. N'invente jamais d'identifiants d'objets : utilise list_objects.
- Décris à voix haute ce qui fait fonctionner une référence de style avant de l'appliquer.
- Ne place jamais des éléments de scénerie un par un en grand nombre : utilise scenery_scatter_zone.
- Pour une montagne russe : coaster_create → plan en macro-éléments → coaster_plan_closure → coaster_build_plan → coaster_test. Corrige selon le rapport (calage, G, collisions).
- Garde le parc viable : chemins connectés, files d'attente, mobilier, personnel, prix cohérents.
```

---

## 15. Tests et évaluation

### 15.1 Pyramide de tests

1. **Unitaires (serveur, sans jeu)** : conversions de coordonnées, planificateurs (chemins, scénerie, A* de fermeture), rendu de cartes (tests d'images de référence), schémas du protocole.
2. **Contrats** : même suite de tests de protocole exécutée contre le **faux plugin** (`fake-plugin/`, un faux jeu en Node qui simule une carte en mémoire et quelques actions) et contre le **vrai jeu**.
3. **Intégration avec le jeu** (manuelle ou nocturne) : scénarios scriptés sur le parc modèle : poser un chemin, une attraction plate, une boutique, de la scénerie ; capture ; checkpoint/restore ; vérifier l'état par `inspect_tile`.
4. **Évaluation agent** : tâches données à Claude via le vrai serveur, avec métriques.

### 15.2 Tâches d'évaluation (échantillon)

| Tâche | Réussite si… |
|---|---|
| T1. « Place une entrée de parc et une allée vers le centre. » | Entrée posée, allée connectée, aucune erreur résiduelle. |
| T2. « Ajoute 2 attractions plates et 3 boutiques raccordées. » | Toutes ouvertes, accessibles, chemins sans impasse. |
| T3. « Aménage une forêt dense au nord qui masque le bord de la carte. » | Densité cible atteinte, dégagements respectés, aucun accès bloqué. |
| T4. « Corrige les attractions non connectées. » | `path_check_connectivity` ne signale plus d'attraction isolée. |
| T5. « Construis un coaster fermé et testé. » | Circuit fermé, test terminé, pas de crash ni de calage. |
| T6. « Refais cette zone dans le style de la référence X. » | Meilleur score que la base sans référence (jugement humain à l'aveugle). |

Métriques : taux de réussite, nombre d'appels d'outils, erreurs par code, tokens consommés, durée, coût en argent de jeu, état final du parc (notes, finances).

### 15.3 Journal et reproductibilité

Toute session d'évaluation enregistre : graine aléatoire, version du jeu/plugin/serveur, parc de départ (hash), séquence d'appels, captures. Les générateurs sont déterministes à graine fixée.

---

## 16. Feuille de route et critères d'acceptation

### 16.1 Phase 0 — Spikes (à faire en premier)

| Spike | Question | Expérience | Décision attendue |
|---|---|---|---|
| **S1** | Un plugin `intransient` peut-il écouter en TCP et faire un écho JSON ? `captureImage` fonctionne-t-il en mode A ? en `--headless` ? La CLI `screenshot` fonctionne-t-elle et avec quelle syntaxe ? | Plugin « hello » + client Node ; `captureImage` dans chaque mode ; `openrct2 --help`. | Mode d'exécution recommandé (A/B/C) confirmé. |
| **S2** | Comment poser chemins, attraction plate, boutique, entrée/sortie, entrée du parc ? Quelles sont les conventions de direction, de hauteur et de quadrant ? | Séquences de `queryAction`/`executeAction` ; marqueurs asymétriques ; captures. | `coords.ts` validé ; recettes d'appels pour `ride_place`, `path_build`. |
| **S3** | `context.saveGame` / `load_park` (via `console.executeLegacy`) : chemins, noms, sous-dossiers ? Le listener, la connexion et les abonnements survivent-ils à `load_park` ? | Sauvegarde, modifications, restauration, ping du plugin. | Checkpoints natifs ou relance de processus. |
| **S4** | Quels objets sont chargés dans le parc modèle ? `objectManager.load` fonctionne-t-il à chaud et à quelle limite ? Mapping identifiant ↔ index. | Liste, chargement, placement. | Procédure de préparation du parc modèle. |
| **S5** | Export de `getAllTrackSegments()` : champs réels, volume, utilisabilité pour un marcheur de piste. | Export JSON + comparaison avec un circuit existant via `getTrackIterator`. | `data/track_segments.json` + validation du marcheur. |
| **S6** | Placement de designs `.td6` : action disponible ? | Lecture du `.d.ts` et de `src/openrct2/actions/`. | **Tranché (F21)** : aucune voie directe → plan B (parseur + rejeu). |
| **S7** | Contrôle de la vitesse du temps depuis le plugin ; durée d'un test de montagnes russes ; propriétés de `Ride` pour G et vitesses. | Expériences en mode A. | Faisabilité de `coaster_test` et `run_time`. |
| **S8** | Calibrage de la projection pour annoter les captures. | Marqueurs sur grille connue, détection de pixels. | Paramètres de projection par zoom et rotation. |
| **S9** | Budget de performance. | Mesures de la section 6.10. | Valeurs par défaut de *K* et *T*, tailles de lots. |

**Livrable Phase 0 :** `docs/SPIKES.md` complété, `docs/ENV.md`, et un tableau « hypothèses confirmées/infirmées » mettant à jour la section 2 de ce document.

### 16.2 Phase 1 — MVP

- Plugin : listener, handshake, file de commandes, `session`, `park`, `map.region/tile`, `objects`, `terrain` (aplanir, style), `path`, `ride` (plates, boutiques), `scenery` (petite scénerie), `capture.view`, `batch`.
- Serveur : outils P1 de la section 9, cache de carte, journal et `undo_last`, faux plugin, tests.
- **Acceptation :** critère « MVP » de la section 1.3 ; tests contractuels verts contre faux plugin et vrai jeu ; documentation d'installation.

### 16.3 Phase 2 — Boucle visuelle et outils composites

- Cartes schématiques PNG, annotations de captures, planches-contacts, différentiels.
- Checkpoints, `run_time`, audits (`landscape_audit`), `terrain_shape`, `water_create_lake`, générateur de scénerie par zones et recettes.
- **Acceptation :** critère « Vision » de la section 1.3 ; T3 et T4 réussis.

> **État (7 octobre 2026) : implémentée.** Outils ajoutés : `terrain_shape`, `water_create_lake`, `zones_paint`, `zones_get`, `scenery_scatter_zone`, `path_add_furniture`, `landscape_audit`, `capture_contact_sheet`, `staff_hire`, `staff_list` ; options `get_region_map.analysis` et `capture_view.annotate`. Tous validés en jeu (aucun échec d'action ; `docs/SPIKES.md`, Phase 2). Le critère « Vision » est couvert par un scénario scripté (`test/e2e-phase2.test.ts`) : l'audit détecte une attraction non raccordée, des impasses et des zones vides, les outils les corrigent, l'audit suivant ne les signale plus. Reste à mesurer avec Claude aux commandes (évaluation agent, 15.1 niveau 4).

### 16.4 Phase 3 — Montagnes russes

- Table des segments, marcheur de piste, `coaster_next_pieces`, fermeture A*, macros, test et rapport, `.td6` (parseur + rejeu, F21).
- **Acceptation :** critère « Montagnes russes » de la section 1.3.

> **État (7 octobre 2026) : implémentée.** `data/track_segments.json` (350 segments, exporté du jeu), marcheur et macros dans `planners/track.ts`, outils `coaster_create`, `coaster_build_plan` (plan de macros + fermeture A* validée par `queryAction`, avec nouvelle recherche si le jeu refuse une pièce), `coaster_next_pieces`, `coaster_append`, `coaster_undo`, `coaster_test`. `coaster_plan_closure` est fusionné dans `coaster_build_plan` (`plan: []`). Critère « Montagnes russes » atteint par un scénario scripté (`test/integration/coaster.test.ts`) : 8 circuits sur 10 fermés, testés, sans accident ni calage ; les deux autres sont refusés avant pose avec la cause. Designs `.td6` : `coaster_list_designs` et `coaster_place_design` (12.7, F40). Restent : la pose de la scénerie des designs, la localisation des calages et pics de G, l'évaluation avec Claude aux commandes.

### 16.5 Phase 4 — Base de style

- Export de scénerie, analyse, index, outils `style_*`, étiquetage assisté.
- **Acceptation :** critère « Style » de la section 1.3.

### 16.6 Phase 5 — Bilan et décision de fork

Faire le bilan à partir des journaux : où Claude échoue-t-il ou perd-il du temps ? Comparer à la section 18 avant de décider de forker.

---

## 17. Risques et réponses

| Risque | Probabilité | Impact | Réponse |
|---|---|---|---|
| `captureImage` indisponible hors fenêtre (F8, F24) | Constatée en mode B | Moyen | Mode A recommandé ; plan C (CLI `screenshot`) ; cartes schématiques côté serveur. |
| Le listener ne survit pas à `load_park` | Écarté (F23) | Élevé | Survie constatée ; reconnexion automatique gardée par prudence. Hooks absents compensés par le plugin (F25). |
| Placement d'attractions plates/boutiques plus complexe que prévu | Écarté (F27) | Moyen | Recettes validées en jeu ; reste les directions 2 et 3 des empreintes non carrées. |
| Jeu ralenti à ~1 image/s (vsync + fenêtre masquée) | Constatée (F29) | Élevé | `use_vsync = false` imposé par `pnpm game` ; documenté dans `docs/ENV.md`. |
| Pas d'action pour les `.td6` | Certaine (F21) | Moyen | Parseur + rejeu avec le marcheur (fait, F40). |
| Le `.d.ts` diverge du C++ sur les arguments d'actions | Constatée (F6) | Moyen | Table d'arguments générée depuis le C++ ; `try/catch` autour de chaque appel ; PR amont pour corriger le `.d.ts`. |
| Performance : gel du jeu pendant les scans/lots | Moyenne | Moyen | Budget par tick, découpage, mesures S9. `landsetheight` à ~25 ms/tuile (F35) : un `terrain_shape` de 64×64 peut prendre ~100 s ; zone de travail plafonnée, découpage conseillé. |
| Directions/hauteurs mal comprises (erreurs de 1 marche) | Élevée au début | Moyen | Tests dédiés, marqueurs asymétriques, `coords.ts` centralisé. |
| Documentation communautaire inexacte | Moyenne | Moyen | `.d.ts` comme référence ; spikes. |
| Évolution de l'API de plugins (versions du jeu) | Moyenne | Moyen | Épingler la version du jeu ; relever `apiVersion` ; tests de contrat. |
| Limites d'objets/éléments dans un parc | Basse | Moyen | Palettes économes ; compteurs et avertissements. |
| Droits sur les parcs et designs de la communauté | Moyenne | Élevé si redistribution | Section 13.6 ; accord des auteurs ; usage personnel par défaut. |
| Licence : OpenRCT2 est sous GPL-3 | Basse | Faible | Le plugin est un script chargé dynamiquement ; garder le code séparé, licence explicite ; ce n'est pas un avis juridique. |

---

## 18. Quand envisager un fork (pour mémoire)

Ne pas forker avant d'avoir des journaux de sessions réelles. Candidats probables, par ordre de gain attendu :

1. **Snapshot/restore en mémoire** (plus rapide et plus fiable que `saveGame`/`load_park`).
2. **Diagnostics de construction riches** (raison structurée d'un placement refusé, pièces suivantes possibles).
3. **Overlays et vues cadrées natifs** (grille de tuiles, étiquettes, vue orthographique de dessus, rendu synchrone sans fenêtre).
4. **Avance rapide déterministe sans rendu** (tests d'attractions, flux de visiteurs).
5. **Serveur HTTP/gRPC natif** à la place du pont TCP.
6. Analyses : cartes de chaleur de visiteurs, contributions aux notes d'une attraction.

Les ajouts isolés à l'API de scripts peuvent être **proposés en amont** au projet, ce qui réduit la dette de maintenance.

---

## 19. Annexes

### 19.1 Squelette de plugin (TypeScript, bundlé en IIFE ES2020)

```ts
// packages/plugin/src/main.ts  (extrait indicatif ; types : /// <reference path="openrct2.d.ts" />)
const PORT = 38491;
const TOKEN = "__INJECTED_AT_BUILD__";

function main(): void {
  const listener = network.createListener();
  listener.on("connection", (socket) => {
    let buffer = "";
    let authed = false;
    const send = (msg: object) => socket.write(JSON.stringify(msg) + "\n");

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 1);
        if (line.length === 0) continue;
        let msg: any;
        try { msg = JSON.parse(line); } catch {
          send({ v: 1, ok: false, error: { code: "INVALID_PARAMS", message: "JSON invalide" } });
          continue;
        }
        if (!authed) {
          if (msg.method === "session.hello" && msg.params?.token === TOKEN) {
            authed = true;
            send({ v: 1, id: msg.id, ok: true, result: helloResult() });
          } else {
            socket.end();
          }
          continue;
        }
        enqueue(msg, send);
      }
    });
    socket.on("close", () => { /* nettoyer */ });
  });
  listener.listen(PORT, "127.0.0.1");

  context.subscribe("interval.tick", processQueue);   // budget K ops / T ms
  context.subscribe("map.change", onMapChange);       // avant déchargement : vider la file (F15)
  context.subscribe("map.changed", onMapChanged);     // après chargement : tables d'objets, event map_changed
}

// Chaque appel d'action : clés obligatoires, exception si l'une manque (F5, F6).
function runAction(name: ActionType, args: object, done: (r: GameActionResult) => void): void {
  try {
    context.executeAction(name, args, done);
  } catch (e) {
    done({ error: -1, errorTitle: "INVALID_PARAMS", errorMessage: String(e) });
  }
}

registerPlugin({
  name: "claude-bridge",
  version: "0.1.0",
  authors: ["<auteur>"],
  type: "intransient",
  licence: "MIT",
  minApiVersion: 124,
  targetApiVersion: 124,
  main
});
```

### 19.2 Squelette d'outil MCP (TypeScript, SDK officiel — vérifier l'API courante)

```ts
// packages/server/src/tools/session.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerSessionTools(server: McpServer, bridge: Bridge) {
  server.registerTool(
    "session_info",
    {
      title: "Informations de session",
      description:
        "Premier appel conseillé. Renvoie l'état du lien avec le jeu, les capacités disponibles, " +
        "le mode (strict/sandbox), l'état de pause, un résumé du parc et la taille de la carte.",
      inputSchema: {}
    },
    async () => {
      const info = await bridge.call("session.info", {});
      return { content: [{ type: "text", text: JSON.stringify(summarize(info)) }] };
    }
  );
}
```

Réponse avec image : `{ content: [{ type: "text", text: "..." }, { type: "image", data: <base64>, mimeType: "image/png" }] }`.

### 19.3 Glossaire

| Terme | Sens |
|---|---|
| Game action | Opération de jeu standard (placer un chemin, etc.), avec phases `query` et `execute`. |
| `queryAction` | Simule une action : coût et validité, sans effet. |
| Intransient | Type de plugin qui reste chargé du démarrage à l'arrêt. |
| Tuile | Case de 32×32 unités monde. |
| Marche de terrain | Pas de hauteur visible du terrain (16 unités monde, à vérifier). |
| Rôle (d'objet) | Catégorie sémantique indépendante des identifiants (`tree_conifer_tall`). |
| Patch | Extrait étiqueté de 8×8 à 16×16 tuiles d'un parc de référence. |
| Marcheur de piste | Module qui calcule les poses successives d'un circuit à partir de la table des segments. |
| Checkpoint | Sauvegarde nommée de l'état du parc et des métadonnées du serveur. |

### 19.4 Références

- Dépôt : `https://github.com/OpenRCT2/OpenRCT2`
  - `distribution/scripting/openrct2.d.ts` (API de plugins, source de vérité)
  - `distribution/scripting/scripting.md` (types de plugins, sockets locales uniquement)
  - `src/openrct2/actions/` (game actions ; `AcceptParameters` donne les noms réels des arguments)
- Plugin communautaire de contrôle TCP : `https://github.com/corysanin/openrct2-remote-control` (exemple de pont TCP et de commandes `save`, `capture`).
- Pages de manuel : `openrct2(6)`, `openrct2-cli(6)` (commande `host`, option `--headless`, dossiers utilisateur).
- PR utiles : #16707 (plugins intransient), #8078 (`save_park`), #11218 (`load_park`), #16144 (ImageManager), #18826 (actions documentées dans le `.d.ts`).
- NE Designs : `https://nedesigns.com/` (références visuelles ; demander l'accord des créateurs avant tout réemploi).
- MCP : spécification et SDK officiels (vérifier la version courante).

### 19.5 Définition de « terminé » pour chaque outil

- Schéma d'entrée strict et documenté (description écrite comme un prompt).
- Test unitaire côté serveur ; test de contrat contre le faux plugin et le vrai jeu.
- Gestion des erreurs avec `code`, `message`, `hint`.
- Budget de taille de réponse respecté.
- Inverse enregistré dans le journal (outils d'écriture).
- Entrée de journal d'observabilité.
- Exemple d'appel et de réponse dans la documentation de l'outil.

---

*Fin du document.*
