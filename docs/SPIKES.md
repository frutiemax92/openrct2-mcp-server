# Résultats des spikes (Phase 0)

> Format : question, expérience, résultat, décision.
> Référence lue : dépôt `../OpenRCT2`, branche `develop`, `git describe` = `v0.5.5-155-gc4aea2c72e` (commit `c4aea2c72e`, 7 octobre 2026).
> `kPluginApiVersion = 124` (`src/openrct2/scripting/ScriptEngine.h:46`).

Ce premier passage couvre uniquement ce qui se tranche **par lecture seule** du `.d.ts` et du C++ (S2 en partie, S5 en partie, S6 en entier). Tout ce qui demande le jeu en marche reste marqué « à confirmer en jeu ».

---

## 0. Constats transverses (bloquants pour la spec)

### 0.1 Le moteur JS n'est plus Duktape

- `src/openrct2/CMakeLists.txt` compile `thirdparty/quickjs-ng/quickjs-amalgam.c`. `ScriptEngine.cpp` utilise l'API QuickJS (`JSContext*`, `JSValue`). Aucune occurrence de `duk_` dans `src/openrct2/scripting/`.
- `distribution/scripting/scripting.md` (l. 17-36) : « OpenRCT2 uses QuickJS-NG […] supports ES2023 », avec `let/const`, fonctions fléchées, classes, template literals, `Promise`, `async/await`, `Map/Set`, etc. Duktape (ES5) ne concerne que les versions **antérieures à v0.5.0**.
- Limites restantes : **pas de modules ES** (`import`/`export`, il faut un bundler qui produit un script global), **pas d'`Intl`**, interprété sans JIT.

**Décision proposée :** abandonner la contrainte ES5 (règle 0.1.6 de la spec et règle de `CLAUDE.md`). Cibler ES2020+ avec un bundle unique au format IIFE, et épingler `minApiVersion` à la version du jeu utilisée. Acté dans `docs/ADR/0001-moteur-js-quickjs.md`.

### 0.2 Chemin du `.d.ts`

Le fichier est `distribution/scripting/openrct2.d.ts` et non `distribution/openrct2.d.ts`. Il existe aussi une copie installée : `build/usr/local/share/doc/openrct2/openrct2.d.ts`. À corriger dans la spec (0.1.1, 19.4) et dans `CLAUDE.md`.

### 0.3 Le `.d.ts` n'est pas toujours exact : le C++ fait foi pour les noms d'arguments

Au runtime, les clés lues sont celles des méthodes `AcceptParameters(GameActionParameterVisitor&)` de chaque action. J'ai comparé les 80 actions de façon systématique (script de comparaison `.d.ts` ↔ `visitor.Visit(...)`). **76 concordent, 4 divergent** (§ 2.2).

Point critique, `ScriptEngine.cpp:1591-1636` et `ScContext.hpp:319-324` :
- **chaque clé visitée est obligatoire.** Une clé absente met un drapeau d'erreur, puis `queryAction`/`executeAction` **lèvent une exception JS** `"Invalid action parameters."` (exception synchrone, pas un `result.error`) ;
- seule `flags` est facultative (lue uniquement si c'est un nombre) ;
- un nom d'action inconnu lève `"Unknown action."`.

**Décision :** le plugin enveloppe chaque appel d'action dans `try/catch` et renvoie `INVALID_PARAMS` avec la liste des clés attendues. `packages/protocol` contient une table des clés par action, générée à partir du C++ (et non du `.d.ts`).

---

## S2 : actions de construction (partie lecture seule)

### Question
Noms exacts des arguments pour poser chemins, attractions plates, boutiques, entrées/sorties, entrée du parc et scénerie ; unités ; conventions de direction, de hauteur et de quadrant.

### Expérience
Lecture de `distribution/scripting/openrct2.d.ts` (l. 691-1656), de `src/openrct2/actions/**/*Action.{h,cpp}`, de `GameActionParameterVisitor.h` et de `ScriptEngine.cpp`.

### 2.1 Mécanique commune

- Coordonnées composites (`GameActionParameterVisitor.h`) :
  - `CoordsXY` → `x`, `y`
  - `CoordsXYZ` → `x`, `y`, `z`
  - `CoordsXYZD` → `x`, `y`, `z`, `direction`
  - `MapRange` → `x1`, `y1`, `x2`, `y2`
- **Toutes ces coordonnées sont en unités monde** (1 tuile = 32). `z` est aussi en unités monde, **sauf** pour `landsetheight.height` et `watersetheight.height`, exprimés en unités `baseHeight` (× 8) (`LandSetHeightAction.cpp:140`, `WaterSetHeightAction.cpp:53`).
- Résultat (`ScriptEngine.cpp:1490-1530`) : `error` est **toujours présent** (0 = ok). `errorTitle` et `errorMessage` ne sont présents qu'en cas d'échec. `cost`, `position` (`CoordsXYZ`) et `expenditureType` (chaîne) sont présents s'ils sont définis. En plus : `ride` pour `ridecreate`, `peep` pour `staffhire`, `bannerIndex` pour `bannerplace`, `largesceneryplace` et `wallplace`.
- Synchronisme (`ScContext.hpp:326-340`) : le callback de `queryAction` est appelé **de façon synchrone** (`GameActions::Query` puis le callback directement). `executeAction` passe par `GameActions::Execute` avec un callback ; il est probablement immédiat en solo, mais c'est **à confirmer en jeu**.

### 2.2 Écarts `.d.ts` ↔ C++ (le C++ gagne)

| Action | Le `.d.ts` dit | Le C++ lit réellement | Conséquence si on suit le `.d.ts` |
|---|---|---|---|
| `footpathlayoutplace` | `slope` (0 ou 4 à 7) | `slopeType`, `slopeDirection` (pas de `slope`) | Exception « Invalid action parameters ». |
| `parkentranceplace` | `x, y, z, direction, footpathSurfaceObject` | plus **`entranceObject`** (index de l'objet `park_entrance`) et **`footpathTypeIsLegacy`** (bool) | Exception. |
| `clearscenery` | `itemsToClear` seul | plus `x1, y1, x2, y2` | Exception. |
| `surfacesetstyle` | `x1..y2, surfaceStyle, edgeStyle` | plus **`surfaceColour1`**, **`edgeColour1`** | Exception. Valeurs neutres à confirmer en jeu. |

Ces écarts mériteraient une PR en amont pour corriger le `.d.ts`.

### 2.3 Arguments exacts des actions utiles au MVP

Les clés sont toutes obligatoires, plus `flags?` en option.

**Chemins**

| Action | Arguments | Notes |
|---|---|---|
| `footpathplace` | `x, y, z, direction, object, railingsObject, slopeType, slopeDirection, constructFlags` | `direction` = 0-3 ou `0xFF` (aucune). `object` = index d'un objet `footpath_surface` (ou d'un chemin legacy si le drapeau est mis). `slopeType` : `0` plat, `1` en pente (`2` raise et `3` irregular sont refusés). `constructFlags` : bit 0 (`1`) = file d'attente, bit 1 (`2`) = objet de chemin legacy (`world/Footpath.h:74-79`). Refusé si le terrain n'est pas possédé, sauf en `sandboxMode`. |
| `footpathlayoutplace` | `x, y, z, slopeType, slopeDirection, object, railingsObject, edges, constructFlags` | Pose avec des bords imposés (`edges` = masque de bits). |
| `footpathremove` | `x, y, z` | |
| `footpathadditionplace` | `x, y, z, object` | Objet `footpath_addition` (bancs, lampes, poubelles). |
| `footpathadditionremove` | `x, y, z` | |

**Attractions plates, boutiques, entrées**

| Action | Arguments | Notes |
|---|---|---|
| `ridecreate` | `rideType, rideObject, entranceObject, colour1, colour2, inspectionInterval` | `rideType` = type interne de ride (voir `RideObject.rideType[]`). `rideObject` = index de l'objet `ride` chargé ; `0xFFFF` = premier objet inventé de ce type (`Ride.cpp:5283`). `entranceObject` = index de l'objet `station` (→ `ride.entranceStyle`). **`colour1` et `colour2` sont des index de préréglages** (couleurs de piste et de véhicule), pas des couleurs. Résultat : `ride` = identifiant de l'attraction créée. |
| `trackplace` | `x, y, z, direction, ride, trackType, rideType, brakeSpeed, colour, seatRotation, trackPlaceFlags, isFromTrackDesign` | `trackPlaceFlags` : bit 0 (`1`) = lift, bit 1 (`2`) = inversé (`ride/RideConstruction.h:93-98`). |
| `trackremove` | `x, y, z, direction, trackType, sequence` | |
| `rideentranceexitplace` | `x, y, direction, ride, station, isExit` | **Pas de `z`** : la hauteur vient de la station (`RideEntranceExitPlaceAction.cpp:106`). |
| `rideentranceexitremove` | `x, y, ride, station, isExit` | |
| `ridesetstatus` | `ride, status` | `0` fermé, `1` ouvert, `2` test, `3` simulation. |
| `ridesetprice` | `ride, price, isPrimaryPrice` | |
| `ridesetsetting` | `ride, setting, value` | Énumération `RideSetSetting` dans `RideSetSettingAction.h`. |
| `ridedemolish` | `ride, modifyType` | `0` démolir, `1` rénover. |
| `parkentranceplace` | `x, y, z, direction, footpathSurfaceObject, entranceObject, footpathTypeIsLegacy` | Voir § 2.2. |
| `peepspawnplace` | `x, y, z, direction` | |
| `mazesettrack` / `mazeplacetrack` | voir `.d.ts` | Labyrinthes : à part. |

**Pièce de départ d'une attraction plate ou d'une boutique.** Chaque type de ride déclare une `StartTrackPiece` dans `src/openrct2/ride/rtd/**`. Le plugin n'y a pas accès, mais la table est fixe :

| `trackType` | Valeur | Exemples d'usage |
|---|---|---|
| `flatTrack1x1A` | 262 | boutiques, kiosques, toilettes (`rtd/shops/Shop.h:22`) |
| `flatTrack1x1B` | 264 | |
| `flatTrack2x2` | 258 | |
| `flatTrack3x3` | 266 | majorité des attractions plates (9 types) |
| `flatTrack4x4` | 259 | |
| `flatTrack1x4A/B/C` | 257 / 263 / 265 | |
| `flatTrack1x5` | 261 | |
| `flatTrack2x4` | 260 | |
| `towerBase` | 66 | tours |
| `maze` | 101 | labyrinthe |
| `endStation` | 1 | attractions à circuit (coasters, etc.) |

(Les valeurs 95, 110, 111 et 115 à 123 sont des alias legacy TD4/TD6, à ne pas utiliser pour `trackplace`.)

**Décision :** générer une seule fois `data/ride_start_piece.json` (`rideType` → `trackType`) à partir de `src/openrct2/ride/rtd/**`. Le spike S2 en jeu ne sert plus qu'à valider le placement et la position d'origine (centre ou coin de l'empreinte) et les règles d'entrée/sortie.

**Scénerie et terrain**

| Action | Arguments | Notes |
|---|---|---|
| `smallsceneryplace` | `x, y, z, direction, quadrant, object, primaryColour, secondaryColour, tertiaryColour` | **`z = 0` : hauteur automatique** (surface ou niveau de l'eau, `SmallSceneryPlaceAction.cpp:81-101`). |
| `smallsceneryremove` | `x, y, z, object, quadrant` | |
| `largesceneryplace` | `x, y, z, direction, object, primaryColour, secondaryColour, tertiaryColour` | Résultat : `bannerIndex`. |
| `largesceneryremove` | `x, y, z, direction, tileIndex` | |
| `wallplace` | `x, y, z, object, edge, primaryColour, secondaryColour, tertiaryColour` | `edge` = direction 0-3 (pas de `direction`). |
| `wallremove` | `x, y, z, direction` | |
| `clearscenery` | `x1, y1, x2, y2, itemsToClear` | Masque : 1 petite scénerie, 2 grande, 4 chemins, 8 murs, 16 additions de chemin. |
| `landsetheight` | `x, y, height, style` | `height` en unités `baseHeight` ; `style` = pente de la surface. |
| `landraise` / `landlower` | `x, y, x1, y1, x2, y2, selectionType` | `x, y` = centre (pour le son et le résultat) ; plage en unités monde. |
| `landsmooth` | `x, y, x1, y1, x2, y2, selectionType, isLowering` | |
| `surfacesetstyle` | `x1, y1, x2, y2, surfaceStyle, edgeStyle, surfaceColour1, edgeColour1` | Voir § 2.2. |
| `watersetheight` | `x, y, height` | `height` en unités `baseHeight`. |
| `waterraise` / `waterlower` | `x1, y1, x2, y2` | |
| `landbuyrights` | `x1, y1, x2, y2, setting` | `0` terrain, `1` droits de construction. |
| `landsetrights` | `x1, y1, x2, y2, setting, ownership` | `4` = fixer la propriété (`ownership` : drapeaux de `SurfaceElement.h`). |

### 2.4 Conventions établies par lecture

| Notion | Résultat | Source |
|---|---|---|
| Tuile → monde | 32 unités | `MapLimits.h:14` (`kCoordsXYStep`), `.d.ts` l. 93 |
| `baseHeight` → `z` | `z = baseHeight × 8` ; les deux sont exposés (`baseHeight`, `baseZ`) sur chaque élément | `MapLimits.h:16` (`kCoordsZStep`), `.d.ts` l. 1819-1824 |
| Marche de terrain | 16 unités monde = 2 `baseHeight` | `MapLimits.h:32` (`kLandHeightStep`), `.d.ts` l. 104 |
| Bornes de hauteur | terrain et eau : `baseHeight` de 2 à 254 | `MapLimits.h:25-28` |
| Direction 0-3 (repère carte) | 0 = −X, 1 = +Y, 2 = +X, 3 = −Y | `world/Map.cpp:59-63` (`CoordsDirectionDelta`) |
| Pente de surface | bits N=1, E=2, S=4, W=8 (coins relevés), 16 = diagonale « double hauteur » | `world/tile_element/Slope.h:19-25` |
| Pente de chemin | `slopeType` (0/1) + `slopeDirection` (0-3) à la pose ; `FootpathElement.slopeDirection` (ou `null`) en lecture | `Footpath.h:95`, `.d.ts` l. 1862 |

À confirmer en jeu : la correspondance entre ces directions et les points cardinaux à l'écran selon la rotation de caméra, la signification de `quadrant` (quel coin vaut 0), et l'origine du `trackplace` pour les empreintes 3×3 et 4×4.

### Décision S2 (partielle)
`coords.ts` peut être écrit dès maintenant à partir du § 2.4 (directions en repère carte). Les tests de marqueurs asymétriques en jeu restent nécessaires pour le lien avec l'écran et pour les quadrants.

---

## S5 : `TrackSegment` et parcours de circuit (partie lecture seule)

### Question
Noms réels des champs de `getAllTrackSegments()` ; sont-ils utilisables pour un marcheur de piste ?

### Expérience
Lecture de `.d.ts` l. 285-291 et 2642-2883.

### Résultat
`context.getTrackSegment(type): TrackSegment | null` et `context.getAllTrackSegments(): TrackSegment[]` existent.

Champs de `TrackSegment` (tous `readonly`) :

| Champ | Type | Sens |
|---|---|---|
| `type` | `number` | Identifiant `TrackElemType` (0 à 349 ; `count = 350`) |
| `description` | `string` | Description localisée |
| `beginZ`, `endZ` | `number` | Z relatif de début et de fin, par rapport à la base du premier bloc |
| `endX`, `endY` | `number` | Décalage de fin (`beginX = beginY = 0`) |
| `beginDirection`, `endDirection` | `Direction8` (0-7) | Direction relative ; 4 au début pour les diagonales |
| `beginSlope`, `endSlope` | `TrackSlope` | `None 0, Up25 2, Up60 4, Down25 6, Down60 8, Up90 10, Down90 18` |
| `beginBank`, `endBank` | `TrackBanking` | `None 0, Left 2, Right 4, UpsideDown 15` |
| `length` | `number` | Longueur approximative |
| `elements` | `TrackSegmentElement[]` | **Blocs occupés** : `{x, y, z}` relatifs |
| `nextSuggestedSegment`, `previousSuggestedSegment` | `TrackCurveType \| number` | Suite suggérée (`"straight"`, `"left"`, `"right"` ou un type) |
| `priceModifier` | `number` | |
| `mirrorSegment`, `alternateTypeSegment` | `number \| null` | Pièce miroir ; variante couverte ou toboggan |
| `trackGroup` | `number` | Groupe de pièces (pour savoir si un type de ride l'autorise) |
| `turnDirection` | `TrackCurveType` | |
| `slopeDirection` | `TrackSlopeType` (`"flat"`, `"up"`, `"down"`) | |
| `onlyAllowedUnderwater`, `onlyAllowedAboveGround`, `allowsChainLift`, `isBanked`, `isInversion`, `isSteepUp`, `startsHalfHeightUp`, `countsAsGolfHole`, `isBankedTurn`, `isSlopedTurn`, `isHelix`, `countsAsInversion` | `boolean` | Drapeaux |
| `getSubpositionLength(subType, dir)`, `getSubpositions(subType, dir)` | méthodes | Trajectoire des véhicules (`x, y, z, yaw, pitch, roll`) |

Écarts avec la spec 12.2 : il n'y a **ni `beginX`/`beginY`** (implicitement 0), ni `endZ` absolu (il est relatif à la base du premier bloc), et l'**inclinaison** s'appelle `beginBank`/`endBank`. La disponibilité par type de ride n'est pas exposée directement : elle passe par `trackGroup`, sans table `rideType → groupes` dans l'API.

`map.getTrackIterator(location: CoordsXY, elementIndex: number): TrackIterator | null`. `TrackIterator` expose `position: CoordsXYZD`, `segment: TrackSegment | null`, `previousPosition` et `nextPosition` (`CoordsXYZD | null`), `previous()` et `next()` (booléens). `nextPosition` donne directement la pose de la pièce suivante : c'est l'oracle idéal pour valider le marcheur.

Bonus pour S7 : `Ride` expose déjà `maxSpeed`, `averageSpeed`, `rideTime`, `rideLength`, `maxPositiveVerticalGs`, `maxNegativeVerticalGs`, `maxLateralGs`, `totalAirTime`, `numDrops`, `numLiftHills`, `highestDropHeight`, et `excitement`/`intensity`/`nausea` en centièmes (`.d.ts` l. 2439-2590). Il y a aussi le hook `vehicle.crash` et `context.gameSpeed` / l'action `gamesetspeed` (`speed` de 0 à 4).

### Décision S5 (partielle)
Les champs suffisent pour un marcheur (décalage de fin, direction, pente, inclinaison, blocs). **À faire en jeu :** exporter `data/track_segments.json` (350 entrées), puis comparer la pose calculée avec `TrackIterator.nextPosition` sur un circuit existant. Il reste aussi à établir la table `rideType → trackGroup` autorisés, de façon empirique (`queryAction('trackplace')`) ou en lisant `src/openrct2/ride/rtd/**` (champs `enabledTrackGroups` / `extraTrackGroups` de `TrackDrawerEntry`, `RideData.h:301-304`).

---

## S6 : placement de designs `.td6`

### Question
Une action ou une méthode de plugin permet-elle de placer un design de piste ?

### Expérience
Lecture de `.d.ts`, `src/openrct2/actions/track/TrackDesignAction.{h,cpp}`, `ScriptEngine.cpp`, `InteractiveConsole.cpp`.

### Résultat
- L'action **`trackdesign` existe** et est enregistrée (`GameActionRegistry.cpp:199`, `ScriptEngine.cpp:1743`), mais elle est **inutilisable depuis un plugin** :
  - `.d.ts` l. 1537-1545 : `TrackDesignArgs` porte `@todo Currently unsupported` et n'a que `x, y, z, direction` ;
  - `TrackDesignAction.cpp:40-44` : `AcceptParameters` ne visite que `_loc`, avec le commentaire `// TODO visit the track design (it has a lot of sub fields)`. Le membre `TrackDesign _td` reste donc vide (construit par défaut) quand l'action vient d'un script ;
  - `_placeScenery` et `_inspectionInterval` ne sont pas exposés non plus.
- Aucune autre API pour charger ou lire un `.td6` : rien dans le `.d.ts`, rien dans `InteractiveConsole.cpp`.
- `trackplace` a un argument `isFromTrackDesign` (bool). C'est utile pour un rejeu fidèle (cela modifie certains contrôles), mais à évaluer.

### Décision S6
**Plan B confirmé :** parser le `.td6` côté serveur, puis le rejouer avec `ridecreate`, une suite de `trackplace`, puis `rideentranceexitplace`, et éventuellement la scénerie. À noter : les `trackType` d'un TD6 sont des valeurs legacy (alias 95, 110, etc.) qu'il faut convertir vers `TrackElemType` (voir `rct12/TD46.h`). Exposer `trackdesign` aux scripts serait une petite PR amont candidate (section 18).

---

## Hooks de changement de carte (question de la spec 6.1)

### Résultat
Hooks disponibles (`.d.ts` l. 514-537, table réelle `HookEngine.cpp:19-39` (`HooksLookupTable`)) :
`action.execute`, `action.location`, `action.query`, `guest.generation`, `interval.day`, `interval.tick`, `map.change`, `map.changed`, `map.resize`, `map.save`, `network.authenticate`, `network.chat`, `network.join`, `network.leave`, `park.guest.softcap.calculate`, `ride.breakdown`, `ride.ratings.calculate`, `vehicle.crash`.

(Incohérence mineure du `.d.ts` : `map.resize` et `ride.breakdown` ont une surcharge de `subscribe` mais manquent dans l'union `HookType`.)

Sémantique (`Game.cpp:404-428`, `640-675`) :
- **`map.change`** : appelé **avant** le déchargement de la carte courante. Il est protégé contre les doubles appels par `_mapChangedExpected`.
- **`map.changed`** : appelé **après** le chargement de la nouvelle carte et le rechargement des scripts transients. **Réservé aux plugins `intransient`** (`HookEngine.cpp:104-110` refuse l'abonnement pour les autres types).
- Séquence typique d'un chargement : `map.change` → `GameUnloadScripts()` (ne stoppe **que** les plugins transients, `ScriptEngine.cpp:1107-1127`) → chargement → `GameLoadScripts()` → `map.changed`.

Indice pour S3 (à confirmer en jeu) : `UnloadTransientPlugins` ne stoppe pas les plugins `intransient`. Or l'arrêt d'un plugin (`StopPlugin`) est ce qui retire minuteries, sockets et abonnements. Le listener, la connexion et les `setInterval` d'un plugin `intransient` devraient donc survivre à un `load_park`.

**Décision :** s'abonner à `map.changed` pour la réinitialisation (tables d'objets, événement `map_changed`), et à `map.change` pour vider la file avant le déchargement.

---

## Cheats (question de la spec 6.4)

### Résultat
`cheats` (global, `.d.ts` l. 4841-4870) a des propriétés **en lecture et écriture** :

Booléens : `allowArbitraryRideTypeChanges`, `allowSpecialColourSchemes`, `allowTrackPlaceInvalidHeights`, `buildInPauseMode`, `disableAllBreakdowns`, `disableBrakesFailure`, `disableClearanceChecks`, `disableLittering`, `disablePlantAging`, `disableGrassGrowing`, `disableRideValueAging`, `disableSupportLimits`, `disableTrainLengthLimit`, `disableVandalism`, `enableAllDrawableTrackPieces`, `enableChainLiftOnAllTrack`, `fastLiftHill`, `freezeWeather`, `ignoreResearchStatus`, `ignoreRideIntensity`, `ignoreRidePrice`, `neverendingMarketing`, `makeAllDestructible`, `sandboxMode`, `showAllOperatingModes`, `showVehiclesFromOtherTrackTypes`, `allowRegularPathAsQueue`.
Nombre : `forcedParkRating`.

Écrire dans `cheats.*` est une **mutation directe** (solo seulement). La voie par game action est `cheatset { type, param1, param2 }`, avec `type` = `CheatType` (`src/openrct2/Cheats.h`, énumération séquentielle). Valeurs utiles : `0` sandboxMode, `1` disableClearanceChecks, `2` disableSupportLimits, `9` disableAllBreakdowns, `11` buildInPauseMode, `16` addMoney, `17` setMoney, `18` clearLoan, `31` fixRides, `33` tenMinuteInspections, `42` ownAllLand, `44` ignoreResearchStatus, `45` enableAllDrawableTrackPieces, `48` allowTrackPlaceInvalidHeights. Certains cheats n'existent **que** via `cheatset` (argent, `ownAllLand`, `fixRides`, `removeLitter`, etc.).

Rappel : `footpathplace` contourne le contrôle de propriété en `sandboxMode` (`FootpathPlaceAction.cpp`).

**Décision :** `session.cheats.set` passe par `cheatset` (valide aussi en mode B) ; `session.cheats.get` lit l'objet `cheats`. Profil `sandbox` = `0`, `11`, `44`, `42`, plus `setMoney`. Profil `strict` = aucun.

---

## Autres constats utiles (hors S2/S5/S6)

- `context.saveGame({ filename })` existe (`.d.ts` l. 243-248, chemin relatif au dossier des sauvegardes, `.park` ajouté automatiquement). C'est une **alternative officielle** à `console.executeLegacy("save_park …")`, qui est marqué `@deprecated`.
- `load_park` existe bien dans la console legacy (`InteractiveConsole.cpp:1833`, « from save directory or by absolute path »). Il n'y a pas d'équivalent dans l'API moderne.
- `CaptureOptions.zoom` et `.rotation` sont **obligatoires** ; `position` est un `CoordsXY` (sans `z`).
- `context.paused` est en lecture et écriture (« Readonly in network mode ») : pas besoin de `pausetoggle` en solo.
- `map.getPathNavigator(...)` / `PathNavigator` (graphe des chemins, `getConnectedPaths()`) : utile pour `path_check_connectivity`.
- `objectManager.load(id)` renvoie `LoadedObject | null` (avec `.index`) ; `getAllObjects(type)` liste les objets chargés.

---

# Résultats en jeu (7 octobre 2026)

> Binaire : `../build/openrct2` et `../build/openrct2-cli` (`v0.5.5-155-gc4aea2c72e`), Linux x86-64, X11 (`DISPLAY=:1`), fichiers RCT2 Steam.
> Dossier utilisateur isolé : `.userdata/` (créé par `node tools/game.mjs`, option `--user-data-path`). Parc : scénario « Build your own Six Flags Park » (154×154), puis checkpoints.
> Clients : `tools/spike.mjs` (NDJSON brut) et `packages/server/scripts/mcp-run.mjs` (vrai serveur MCP par stdio). Tests reproductibles : `packages/server/test/integration/game.test.ts`.

## Tableau de synthèse

| Hypothèse | Verdict | Détail |
|---|---|---|
| Un plugin `intransient` écoute en TCP sur 127.0.0.1 | **Confirmé** | S1 |
| `captureImage` fonctionne en mode A | **Confirmé**, avec une condition | Le dossier `screenshot/` doit exister (S1) |
| `captureImage` en `host --headless` | **Infirmé** (indisponible) | Capacité détectée à `false`, refus propre (S1) |
| CLI `screenshot` sur un `.park` (mode C) | **Confirmé** | 296 ms pour 1280×720 ; options globales refusées (S1) |
| `context.saveGame` | Confirmé en mode A, **échoue en mode B** | Repli `save_park` (S3) |
| Le plugin, sa connexion et ses minuteries survivent à `load_park` | **Confirmé** | S3 |
| `map.change` / `map.changed` appelés par `load_park` | **Infirmé** | Ni l'un ni l'autre (S3) |
| `queryAction`/`executeAction` suffisent pour poser entrée, chemins, attractions, boutiques, scénerie | **Confirmé** | S2 |
| Origine de la pièce `flatTrack*` | **Établie** | 3×3 : centre ; 2×2 et 4×4 : coin minimal ; 1×5 : centre de l'axe long (S2) |
| Quadrant 0 de la petite scénerie | **Établi** | Coin (−x, −y) (S2) |
| Projection isométrique de la spec 10.3 | **Confirmée** aux rotations 0 à 3 (zooms 0 à 2) | S2/S8 |
| `objectManager.load` à chaud | **Confirmé** | S4 |
| Accélération du temps depuis le plugin | **Confirmée** | ×4 ≈ 280 ticks/s (S7) |
| Latence aller-retour ≈ 1 frame | **Confirmée sous condition** | 50 ms, mais 1 000 ms si vsync + fenêtre masquée (S9) |

## S1 : pont TCP, captures, modes d'exécution

### Expérience
`node tools/game.mjs <scénario>`, puis `node tools/spike.mjs .userdata hello` et `capture_view` via `mcp-run.mjs`. Mode B : `openrct2-cli host <parc> --headless --port=11799 --user-data-path=… --openrct2-data-path=…`. Mode C : `openrct2-cli screenshot <parc> <png> 1280 720 <x> <y> <zoom> <rotation>`.

### Résultats
- **Mode A** : le plugin se charge (`Registered`, `Loaded`, `Started`), écoute sur `127.0.0.1:38491`, handshake OK (`apiVersion` 124, `networkMode: "none"`, `headless: false`). Le jeton est mémorisé dans `plugin.store.json` sous `{"claude-bridge":{"token":…}}` (clés pointées imbriquées).
- **`captureImage` exige que le dossier `screenshot/` existe.** `ResolveFilenameForCapture` (`Screenshot.cpp:597-625`) appelle `fs::create_directory(directory, screenshotDirectory)`, qui copie les attributs du dossier racine et échoue s'il n'existe pas (`filesystem error: cannot create directory`). Un dossier utilisateur neuf n'en a pas (le `~/.config/OpenRCT2` de l'utilisateur non plus). Un plugin ne peut pas créer de dossier : **le serveur crée `<userDir>/screenshot/` avant chaque capture** (`tools/observe.ts`). Seul un niveau de sous-dossier est créé : le plugin utilise des noms plats (`claude-<session>-<n>.png`).
- Capture 1920×1080 : ~100 ms côté plugin (rendu synchrone sur le thread du jeu).
- **Mode B** (`host --headless`, `networkMode: "server"`) : `captureImage` et `directEdit` détectés à `false`, refus `NOT_SUPPORTED_IN_MODE` ; les game actions (chemins, scénerie, `cheatset`) fonctionnent ; `context.saveGame` lève « Game state is not mutable in this context » (voir S3). Le hot reload des plugins ne s'applique pas en headless.
- **Mode C** : `openrct2-cli screenshot <parc.park> <out.png> <w> <h> <x> <y> <zoom> <rotation>` (coordonnées en unités monde ; variante `giant <zoom> <rotation>`) produit un PNG 8 bits en ~300 ms. La sous-commande **refuse les options globales** (`--user-data-path` : « Unknown option » ou « All options must be passed at the end ») : elle utilise le dossier utilisateur par défaut. Les entités du parc (étiquettes de coût, visiteurs) apparaissent sur l'image.

### Décision S1
Mode A recommandé (confirmé). Mode B utilisable pour construire sans images (cartes schématiques du serveur). Mode C viable comme repli de capture : `saveGame` puis CLI `screenshot`.

## S2 : construction

### Expérience
Via les outils MCP : `session_set_mode sandbox`, `park_set_entrance`, `path_build`, `ride_place` (Circus 3×3, Motion Simulator 2×2, Enterprise 4×4, Pirate Ship 1×5, Burger Bar 1×1), `scenery_place` avec quadrants, captures à rotation 0 et zoom 0.

### Résultats
- Toutes les recettes d'appels fonctionnent du premier coup en jeu : entrée de parc (niveau du terrain), 23 tuiles d'allée, attractions avec entrée, sortie et raccords posés automatiquement, boutique raccordée par sa face avant.
- **Origine de `trackplace` pour les attractions plates** : 3×3 → tuile **centrale** ; 2×2 et 4×4 → **coin minimal** (x et y les plus petits) ; 1×5 → centre de l'axe long (Pirate Ship en (30,40), direction 0 → x 28 à 32). Mesuré en direction 0 (et 1 pour la 3×3).
- **Quadrants** (`SceneryQuadrantOffsets`, `Scenery.cpp:60` : {8,8}, {8,24}, {24,24}, {24,8}) : 0 = coin (−x, −y), 1 = (−x, +y), 2 = (+x, +y), 3 = (+x, −y). À rotation 0, ce sont les coins haut, droite, bas et gauche du losange à l'écran. Les arbres occupent toute la tuile : un deuxième arbre sur la même tuile est refusé (`OBSTRUCTED`), quel que soit le quadrant.
- **Écran ↔ carte** (rotation 0) : +x va vers le bas à gauche, +y vers le bas à droite ; la tuile (0,0) est en haut. Au zoom 0, une tuile de plus en x décale de (−32, +16) px et en y de (+32, +16) px : la formule de la spec 10.3 est juste (vérifié sur les étiquettes de coût, à 1 px près).
- **Point d'apparition des visiteurs** : `peepspawnplace` exige une allée sous le point (« Can only be built on paths ») **et** un terrain hors du parc (« Must be outside park boundaries »). `park_set_entrance` trace donc l'allée extérieure jusqu'au point, puis le pose, et explique l'échec si le terrain appartient au parc.
- **Files d'attente fusionnées** : un raccord posé à côté de la file d'une autre attraction est relié automatiquement par le jeu (file de l'Enterprise branchée sur celle du Motion Simulator). Le planificateur de raccords évite désormais les tuiles voisines d'une file existante (`routeToNetwork`, test unitaire).
- **Avertissements en boucle** : lire `ride`/`station` sur un chemin qui n'est pas une file, `station` sur une pièce qui n'est pas une station, ou `sequence`/`colourScheme` sur un labyrinthe journalise « Cannot read … » dans la console du jeu (`ScTileElement.cpp`). Le plugin ne lit plus ces propriétés dans ces cas-là.

### Décision S2
`coords.ts` et les recettes de `ride_place` / `path_build` / `park_set_entrance` sont validés en jeu. Reste à mesurer : l'origine pour les directions 2 et 3 des empreintes non carrées (les rotations de caméra 1 à 3 sont tranchées, S8).

## S3 : checkpoints

### Expérience
`checkpoint_save`, démolition d'une attraction, `checkpoint_restore`, `list_rides`, `undo_last` ; puis la même chose en mode B.

### Résultats
- `context.saveGame({ filename })` écrit `save/<nom>.park` en ~100 ms (mode A).
- `load_park` (console legacy) recharge le parc ; **le listener, la connexion TCP, la minuterie `setInterval` et les abonnements du plugin survivent** (F15 confirmé). La même connexion sert après le chargement.
- **`load_park` n'appelle ni `map.change` ni `map.changed`.** La commande passe par `Context::LoadParkFromFile` → `LoadParkFromStream`, qui appelle `GameUnloadScripts()` (`Context.cpp:780`) mais pas `GameNotifyMapChange`, `GameLoadScripts` ni `GameNotifyMapChanged` (contrairement au chargement par l'interface, `Game.cpp:646-675`). Effets : le serveur attendait l'événement `map_changed` jusqu'au délai (30 s) ; les plugins **transients** ne sont pas relancés après un `load_park` par console. Correctif : la tâche différée de `checkpoint.restore` est marquée `changesMap`, et `main.ts` émet `map_changed` lui-même si le hook n'a pas été appelé. Restauration : **176 ms** au lieu de 30 s.
- Mode B : `context.saveGame` lève « Game state is not mutable in this context ». Repli `console.executeLegacy("save_park <nom>")` : fonctionne ; `load_park` aussi.

### Décision S3
Checkpoints natifs (pas de relance de processus). `checkpoint.save` : `saveGame`, sinon `save_park`. `checkpoint.restore` : `load_park` + `map_changed` émis par le plugin.

## S4 : objets

- Le scénario charge 626 objets ; listes par type et par rôle disponibles (`list_objects`).
- `objectManager.load` fonctionne **à chaud** : deux objets de scénerie non chargés deviennent utilisables immédiatement (indices 103 et 104), un identifiant inconnu est signalé proprement. Limite d'emplacements non atteinte (non mesurée).

## S7 : temps de jeu

- `run_time` à vitesse 4 : 400 ticks en 1,4 s (≈ 280 ticks/s, 7× le temps réel).
- Correctif : `time.run` laissait le jeu à la vitesse demandée ; il remet désormais la vitesse d'avant (et la pause, comme avant).
- Non mesuré : durée d'un test de montagnes russes (Phase 3).

## S9 : performance

| Mesure | Résultat |
|---|---|
| Ping aller-retour | **50 ms** (2 frames : lecture du socket après la pompe, puis réponse à la frame suivante) |
| `map.region` 64×64 / 128×128 | 192 ms / 484 ms |
| `queryAction` × 400 (`scenery.place_small` en simulation) | 573 ms (borné par *K* = 20 opérations par frame) |
| `objects.list` (25) | 76 ms |
| `captureImage` 1920×1080 | 101 ms |
| `path_check_connectivity` sur 154×154 | ~1 s (scan complet), puis cache |
| `ride_place` complet (attraction 3×3 + raccords) | ~1,5 s |

- **Piège majeur : vsync.** Avec `use_vsync = true` (valeur par défaut d'un `config.ini` neuf) et une fenêtre masquée ou sur un autre bureau, le compositeur limite la présentation à ~1 image/s, et **toute la boucle du jeu** avec : chaque requête prenait exactement 1 000 ms (0 % de CPU). `tools/game.mjs` impose `use_vsync = false`. À documenter pour tout utilisateur qui lance le jeu lui-même.
- La lecture des sockets est limitée à 16 Ko par frame (`ScSocket.hpp:209`) : ~640 Ko/s en entrée, sans conséquence pour des requêtes de quelques Ko.

### Décision S9
Valeurs par défaut conservées (*K* = 20, *T* = 4 ms). *K* pourra être relevé si les lots de scénerie deviennent un goulot (le budget de temps reste le garde-fou).

## S8 : projection des captures (tranché)

### Question
Relier les pixels d'une capture aux tuiles pour toutes les rotations et tous les zooms.

### Expérience
Lecture de `Translate3DTo2DWithZ` (`Viewport.cpp:1919`) et de `CaptureImage` (`Screenshot.cpp:631`) ; implémentation dans `render/projection.ts` ; captures annotées (`capture_view annotate: true`) et planche-contact R0 à R3 aux zooms 1 et 2 sur une colline et un lac créés pour l'occasion, avec deux tuiles surlignées.

### Résultat
- `captureImage` centre la vue sur la projection de `(position, TileElementHeight(position))` et couvre `width × 2^zoom` unités d'écran. Projection : `r = pos.rotate(rotation)` (`CoordsXY::rotate`), `sx = r.y − r.x`, `sy = (r.x + r.y) / 2 − z`.
- En jeu, la grille suit exactement les bords du lac et les terrasses de la colline, les tuiles surlignées tombent au centre du lac et au sommet de la colline, et les étiquettes désignent les mêmes éléments dans les quatre rotations.

### Décision S8
Pas de calibrage empirique : la formule du jeu suffit. Limite connue : la grille suit le terrain, un objet haut masque les tuiles derrière lui.

# Phase 2 en jeu (7 octobre 2026)

Parc « Build your own Six Flags Park » (154×154), mode A, mode sandbox, zone vide au nord-est, checkpoint pris avant et restauré après.

| Outil | Résultat | Durée |
|---|---|---|
| `landscape_audit { image: true }` (137×135 tuiles) | 6 zones vides, lampadaires manquants ; carte annotée lisible | 1,05 s |
| `terrain_shape` colline r7 h5 | 229 tuiles, 0 échec, niveaux 7 → 12, pentes toutes acceptées par le jeu | 5,8 s |
| `water_create_lake` 13×11 | 131 tuiles creusées, 115 remplies, 0 échec | 6,8 s |
| `path_build` 47 tuiles puis `path_add_furniture` | 12 bancs, 10 poubelles, 18 lampadaires, 0 échec | 1,4 s |
| `scenery_scatter_zone` (forêt, bordure, berge ; seed 4) | 213 éléments sur 512 tuiles, 0 échec | 5,5 s |
| `capture_view annotate` / `capture_contact_sheet` | grille alignée (S8) | 0,8 s / 1,4 s |
| `staff_hire` (2 agents avec patrouille, 1 mécanicien, 1 artiste) | ids renvoyés, patrouille de 247 tuiles, costume d'artiste trouvé | 75 ms par embauche |
| `undo_last` (mobilier, scénerie, personnel, colline, lac) | tout annulé | ≤ 1 s |

Constats :
- **`watersetheight` refuse une hauteur < 2** (« Too low ») : `terrain.set_water` avec `level: 0` (retrait de l'eau, utilisé par l'annulation d'un lac) échouait depuis la Phase 1. Le plugin envoie maintenant 2, ce qui retire l'eau (hauteur ≤ sol, `WaterSetHeightAction.cpp`). F31.
- **`landsetheight` ≈ 25 ms par tuile** : une seule action par image, chaque appel dépassant le budget de 4 ms. Acceptable pour des zones de quelques centaines de tuiles ; un 64×64 complet prendrait ~100 s. F35.
- Les règles des additions de chemin (F32) et l'empreinte des arbres (`occupiesFullTile`, F33) sont respectées par les planificateurs : aucun refus du jeu sur 253 placements.
- Rendu : la forêt générée est variée (conifères, feuillus, buissons, rochers), dégagée le long des allées ; la colline « dome » présente des terrasses (hauteurs entières : 5 niveaux sur 7 tuiles), aspect correct mais géométrique.
- L'impasse en bout d'allée de test est signalée ; l'allée extérieure vers le point d'apparition ne l'est pas (couloir menant à l'entrée du parc).

# Phase 3 en jeu : S5 et montagnes russes (7 octobre 2026)

## S5 : table des segments et marcheur de piste

### Expérience
`track.segments` (plugin, paginé) exporté par `node tools/export-segments.mjs` vers `data/track_segments.json` (350 segments, 235 Ko). Marcheur écrit dans `packages/server/src/planners/track.ts`, puis circuits construits avec `coaster_build_plan` et relus avec `track.circuit` (`TrackIterator`).

### Résultats
- **Modèle de pose** (repris de `TrackDesignPlaceVirtual`, `TrackDesign.cpp:1590-1735`) : pose = (x, y, z, rot 0-7, pente, inclinaison) à l'entrée de la pièce ; la pièce T se pose avec `trackplace { x, y, z: pose.z − T.beginZ, direction: rot & 3 }` ; pose suivante : `xy += rotate(endX, endY, rot)`, `z = origine.z + endZ`, `rot = ((rot + endDirection − beginDirection) & 3) | (endDirection & 4)`, puis un pas dans `rot` si la fin n'est pas diagonale. Compatibilité : `beginSlope`, `beginBank` et le bit diagonal de `beginDirection` doivent égaler ceux de la pose.
- **`TrackIterator.position` est exactement l'origine passée à `trackplace`** (`GetTrackSegmentOrigin`, `Track.cpp:427`). Pour `trackremove`, `z` = origine.z + `elements[0].z` (`TrackDesign.cpp:1612`).
- Validation : un circuit de 43 pièces (station 6, plan 23, fermeture 14) posé par le marcheur est lu **fermé** par `TrackIterator`, origines identiques à celles calculées. Test unitaire : `pieceEndingAt(endPose(p)) = p` pour les 350 pièces × 4 directions.
- **`trackplace` ne vérifie pas les groupes de pièces** (`TrackPlaceAction.cpp` : seule la chaîne sur pente raide est contrôlée) : une pièce non autorisée pour le type d'attraction serait acceptée. Les groupes autorisés sont générés depuis `enabledTrackGroups` / `extraTrackGroups` des RTD (`tools/gen-tables.mjs` → `RIDE_TYPES[].trackGroups`) et le serveur les impose.
- La hauteur de dégagement par bloc (`clearanceZ`) **n'est pas exposée** (`TrackSegmentElement` = x, y, z) : le serveur suppose 40 unités entre deux blocs d'une même tuile ; le jeu reste juge final (`queryAction`).
- Hauteurs : `z` d'origine multiple de 16, ou ≡ 8 (mod 16) pour les pièces `startsAtHalfHeight` (`TrackPlaceAction.cpp:211-225`), sauf cheat `allowTrackPlaceInvalidHeights`.
- **Le test exige entrée et sortie** (`Ride::test` → `RideCheckForEntranceExit`, `Ride.cpp:3813`) : `coaster_create` les pose sur les flancs de la station.
- Unités de `Ride` (`ScRide.cpp`) : `maxSpeed` en mph, `rideLength` en mètres, G déjà divisés par 100.

## Critère « Montagnes russes » (SPEC 1.3)

`test/integration/coaster.test.ts` : 10 plans de macros différents (4 orientations), Corkscrew Roller Coaster (`rct2.ride.arrt1`), terrain plat, mode sandbox ; création, plan, fermeture A*, test, démolition.

| Résultat | Nombre |
|---|---|
| Fermés, testés, sans accident ni calage | **8 / 10** |
| Refusés avant pose par le serveur (plan vers une colline ; hélice recoupant le circuit), message et tuile fournis | 2 |
| Accidents, trains calés | 0 |

Durée totale 84 s (essais ≈ 2 400 ticks par circuit à vitesse 4, ~8 s). Fermeture A* : < 1 s, 10 à 16 pièces. Notes obtenues : excitation 0,5 à 4,5 ; les plans courts et bas donnent des notes faibles, les circuits avec chute raide et inversion dépassent 4. G latéraux 2,2 à 3,4 : les virages serrés en sortie de chute restent le principal défaut (signalé par `coaster_test`).

## Designs `.td6` (SPEC 12.7, F40)

Hors jeu (`test/td6.test.ts`, bibliothèque RCT2 de l'installation Steam) : 204 fichiers, 201 lus (3 labyrinthes refusés), aucune pièce inconnue ; 186 circuits bouclent à l'origine dans les 4 rotations. Les 15 autres sont ouverts par nature : navettes (boomerang, `down60` en première pièce), tours (`towerBase`), lancements verticaux. Un contrôle strict de pente et d'inclinaison rejetait à tort les lay-down et flying (pièces posées avec le drapeau `inverted`) : le rejeu suit donc la géométrie seule, comme `TrackDesignPlaceRide`.

En jeu (parc « Six Flags », sandbox), `coaster_place_design` puis `coaster_test` :

| Design | Type | Pièces | Pose | Notes fichier → mesurées (E/I/N) |
|---|---|---|---|---|
| Steel Squeak | steel wild mouse, direction 1 | 110 | 5,0 s | 7,2/7,8/4,8 → 6,59/7,78/4,71 |
| Whitewash | wooden | 102 | 4,4 s | 7,6/8,1/4,8 → 7,17/8,17/4,58 |
| Evil Vultures | lay-down (objet chargé à la volée) | 89 | 4,2 s | 6,6/6,6/5,4 → 6,31/6,64/5,34 |
| Deja Vu | compact inverted, navette, direction 2 | 40 | 2,9 s | 6,6/9,4/7,5 → 6,06/9,46/7,34 |

Entrées et sorties posées à leur place, couleurs du design appliquées, aucun accident. L'excitation est plus basse sans la scénerie du design (non posée). La vitesse max d'un `.td6` vaut `v × 9 / 4` mph (`ToHumanReadableSpeed(v << 16)`).

## Restent à faire en jeu
- `.td6` : pose de la scénerie des designs (objets DAT, quadrants, murs).
- Localiser l'endroit d'un calage ou d'un pic de G (échantillonnage des véhicules pendant le test).
- S2 : origine des empreintes non carrées pour les directions 2 et 3.
- Évaluation agent (SPEC 15.1, niveau 4) : critères MVP, « Vision » et « Montagnes russes » avec Claude aux commandes, sur 10 essais.
