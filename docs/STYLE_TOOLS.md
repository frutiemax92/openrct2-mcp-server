# Style Picker et Magic Fill Tool

> 10 octobre 2026. Implémente `instructions_style_picker.md`. Spécification de référence : `SPEC.md` § 13.7 ; faits F41 à F43 ; spike S10 (`SPIKES.md`).

Deux outils en jeu, ouverts depuis le **menu des plugins** (icône carte de la barre d'outils) :

- **Style Picker** : l'utilisateur peint une région au pinceau, la décrit, et clique **Save Style**. La région est relevée en entier (éléments, couleurs, rotations, hauteurs exactes, terrain) avec une capture où seule la région apparaît, et rangée dans une base de styles que le serveur MCP lit.
- **Magic Fill Tool** : l'utilisateur peint une région à remplir et écrit ce qu'il veut (« forêt de pins dense »). Au relâchement de la souris, la demande part chez Claude, qui choisit dans la base les styles qui conviennent à la consigne et au voisinage, puis remplit la région sans contrôle de dégagement et vérifie le résultat sur une capture comparée à celles des styles.

Le plugin ne peut ni écrire de fichiers ni appeler un modèle : il produit les données, le serveur MCP les range sur disque, et Claude fait les choix par les outils MCP.

---

## 1. Dans le jeu

### 1.1 Style Picker

| Commande | Effet |
|---|---|
| `-` / `+` | Taille du pinceau (carré de 1×1 à 15×15 tuiles). |
| **Paint** | Active ou coupe l'outil (actif à l'ouverture). Glisser sur la carte ajoute les tuiles du pinceau à la sélection, surlignée par le jeu, aperçu du pinceau compris. |
| **Erase** | Le pinceau retire des tuiles au lieu d'en ajouter. |
| **Clear** | Vide la sélection. |
| Champ de texte | Légende de la région (200 caractères) : ce que c'est, ce qui la rend réussie. |
| **Kind** | `Auto (detect)` (défaut : le serveur déduit la nature des empilements), `Structure` (construction : posée entière, en bloc rigide), `Natural` (nature : patchs coupables qui suivent le terrain). Enregistré dans `StyleRecord.kind` ; voir § 3.4. |
| **Save Style** | Relève la sélection (2 500 tuiles au plus) et la met en file pour le serveur. |
| **Clear all stored styles** | Vide toute la base de styles. Premier clic : le bouton s'arme (texte rouge) ; second clic : les styles en attente dans le plugin sont oubliés et le serveur supprime tous les dossiers `styles/<id>` à sa prochaine prise, avant de ranger les styles sauvés après le clic. Sans serveur connecté, la demande est gardée dans `plugin.store.json` et exécutée à la connexion suivante. |
| Ligne d'état | Résultat de la dernière sauvegarde (éléments, captures) et lien avec le serveur MCP (vert : connecté ; rouge : styles en attente). |

Sans serveur MCP connecté, les styles attendent dans le plugin (8 au plus) **et** dans `plugin.store.json` : ils survivent à la fermeture du jeu et partent à la connexion suivante.

### 1.2 Magic Fill Tool

| Commande | Effet |
|---|---|
| `-` / `+`, **Paint**, **Erase**, **Clear** | Comme le Style Picker. |
| Champ de texte | Ce qu'il faut faire pousser (« dense pine forest », « parterre de fleurs rouges »). |
| **Send when I release the mouse** (coché) | Chaque trait de pinceau envoie la demande au relâchement. Décoché : peindre en plusieurs traits puis cliquer **Fill**. |
| **Fill** | Envoie la sélection et la consigne. |
| Trois lignes de suivi | Les dernières demandes et leur état, mis à jour par le serveur : `pending` (dans le plugin), `received` (sur disque), `working` (Claude choisit ou pose), `done`, `failed`, `dismissed` (avec la raison). |

Claude ne reçoit pas de notification spontanée (le protocole MCP n'en offre pas au modèle) : il faut lui demander de traiter les demandes Magic Fill, ou le laisser en boucle de service (`magic_fill_requests { wait: 120 }`, par exemple avec `/loop`).

---

## 2. Ce qui est enregistré

### 2.1 Disposition sur disque

```text
<OPENRCT2_STYLES_DIR, défaut <dossier utilisateur>/claude-styles>/
  styles/<id>/style.json          relevé complet (format ci-dessous)
  styles/<id>/caption.txt         légende (éditable à la main : elle l'emporte sur style.json)
  styles/<id>/screenshot-r0..3.png  région seule, fond transparent, rotations 0 à 3
  magic-fill/<id>.json            demande Magic Fill, état et résultat
```

`<id>` = `style-<horodatage base 36><aléa>-<légende abrégée>`. Un dossier copié, renommé ou supprimé à la main est pris en compte au prochain appel.

### 2.2 Format `style.json` (`StyleRecord`, `packages/protocol/src/styles.ts`)

- `origin`, `size`, `tiles` : coin de la région (x, y minimaux) et tuiles peintes, relatives à ce coin (la région n'est pas forcément rectangulaire).
- `surfaces[]` : par tuile, `baseHeight`, `slope`, objets `terrain_surface` et `terrain_edge`, hauteur de l'eau (`water`, en baseHeight), longueur de l'herbe, propriété, clôtures du parc.
- `elements[]` : **tous** les éléments non fantômes, sans interprétation des dégagements : deux objets superposés avec le cheat Zero Clearances sont relevés l'un et l'autre. Champs communs : type `t`, tuile `dx, dy`, `baseHeight`, `clearanceHeight`, `dz` (écart à la surface de la tuile), `occupiedQuadrants`. Puis selon le type :
  - petite scénerie : `object`, `direction`, `quadrant`, `colours` [principale, secondaire, tertiaire], `age` ;
  - grande scénerie : `object`, `direction`, `sequence`, `colours`, `origin` (tuile 0 et sa hauteur), texte de bannière ;
  - mur : `object`, `direction` (bord), `slope`, `colours`, texte de bannière ;
  - bannière : `object`, `direction`, couleurs, texte, `isNoEntry` ;
  - chemin : surface (ou objet legacy), garde-corps, file d'attente, bords, coins, pente, addition (banc, lampe…), `isWide` ;
  - piste : attraction, type de ride, type de pièce, direction, séquence, schéma de couleurs, chaîne, inversée, vitesse de frein ou de booster, rotation des sièges, station ;
  - entrée : `kind` (ride_entrance, ride_exit, park_entrance), direction, attraction, station.
- `objects{}` : chaque objet cité, avec son type et son nom ; drapeaux et hauteur des petites scénerie ; décalages des tuiles des grandes scénerie.
- `rides[]` : attractions présentes dans la région : nom, type, classification, objet, **couleurs de piste par schéma** (main, additional, supports) et **de véhicules** (body, trim, tertiary), style de station.
- `screenshots[]` : rotation, zoom, taille, centre et hauteur du centre de chaque capture (pour reprojeter les tuiles sur l'image).
- `screenshotError` : raison si la capture a échoué (jeu sans fenêtre, multijoueur).

Les hauteurs sont en unités `baseHeight` (8 unités monde), la granularité réelle du jeu : les « niveaux » des autres outils (16 unités) perdraient les empilements fins.

### 2.3 Capture masquée

Faisable avec le système de plugins (S10, F41) :

1. Dans une seule frame, le plugin cache (`TileElement.isHidden`) tous les éléments des tuiles à moins de 16 tuiles de la région qui n'en font pas partie, surfaces comprises. Les grandes scénerie dont une tuile est dans la région restent entières.
2. `context.captureImage({ transparent: true, … })` pour chaque rotation : fond transparent, centrée sur la région, zoom choisi pour tenir dans 1 600 × 1 200 px.
3. Les éléments cachés sont rétablis (bloc `finally`), relus par position et non par poignée.
4. Le serveur efface ensuite tout pixel hors de l'emprise projetée de la région (colonne sol → plus haut élément de chaque tuile, `render/mask.ts`) : visiteurs et véhicules, qui ne sont pas des éléments de tuile, et éléments très hauts posés loin devant.

Limites : un visiteur ou un véhicule **dans** la région reste visible ; un objet de plus de 16 marches posé à plus de 16 tuiles devant peut encore masquer une partie de la région avant le masque du serveur. En multijoueur, `isHidden` est refusé : la capture est alors absente (`screenshotError`).

---

## 3. Outils MCP

| Outil | Rôle |
|---|---|
| `style_list { query?, limit, cursor }` | Styles de la base : légende, taille, densité de scénerie par tuile, objets dominants, empilements (`maxDz`, `stacked`), terrain. `query` classe par pertinence (légende × 3, noms d'objets × 1, pluriels tolérés). |
| `style_get { id, image, rotation? }` | Composition détaillée (objets, nombre, variantes de couleurs, écarts au sol), attractions et leurs couleurs, `layout` (hauteur de chaque tuile, rangées répétables), capture masquée (une rotation, ou planche des quatre). |
| `style_save { tiles \| rect, caption, kind }` | Claude annote lui-même une zone désignée par coordonnées, comme **Save Style** (`kind` : auto, structure, natural). |
| `style_update { id, kind?, caption? }` | Corrige la nature d'un style (`auto` la remet automatique) ou sa légende (§ 3.4). |
| `style_delete { id \| all }` | Supprime un style, ou toute la base avec `all: true` (à la demande de l'utilisateur). |
| `magic_fill_requests { wait, recent }` | Demandes ouvertes : consigne, région (tuiles, emprise, chemins, scénerie déjà là, terrain), voisinage (anneau de 4 tuiles : objets, densité, chemins, attractions) et styles candidats classés selon la consigne. `wait` attend une nouvelle demande (jusqu'à 600 s). Passe la demande à `working` dans la fenêtre du jeu. Tant qu'une demande est ouverte, le relief est modifiable dans son emprise (`target.bbox`) sans `session_set_landscape`. |
| `magic_fill_apply { request \| tiles \| rect, styles: [{ id, weight }], blocks?, relief, … }` | Remplit (voir § 4). `blocks` pose des constructions à une place donnée (§ 3.4) ; sans région, la région est l'emprise des blocs. `relief: "copy"` (défaut) recopie collines, creux et falaises du style par-dessus le terrain, adoucis vers le bord de la région ; `"keep"` garde le terrain. `texture: "copy"` (défaut) recopie surface et bordure de chaque tuile du style ; `"keep"` les garde. `reliefScale` multiplie la hauteur du relief recopié (2 : collines deux fois plus hautes). `dryRun` compte sans poser. Annulable par `undo_last` (relief compris). Avec `request` : checkpoint automatique avant le premier remplissage ; une demande déjà remplie est refusée sans `redo: true`, qui revient à ce checkpoint puis remplit. |
| `magic_fill_dismiss { request, reason }` | Ferme une demande ; la raison s'affiche en jeu. |
| `magic_fill_revert { request, reopen, discardLaterWork }` | Ramène le parc au checkpoint pris juste avant le premier remplissage de la demande (relief, textures, scénerie d'origine) et la rouvre. Refuse si d'autres opérations journalisées ont suivi, sauf `discardLaterWork: true` (accord de l'utilisateur). |

Les instructions du serveur (`INSTRUCTIONS`, `server.ts`) décrivent la boucle : `magic_fill_requests` → `style_get` des candidats → `magic_fill_apply` → comparaison des images → `undo_last` et autre choix si ça ne ressemble pas.

### 3.1 Refaire une demande (checkpoint)

Constat du 10 octobre : à « refais-le avec des collines plus hautes », Claude a supprimé tous les arbres puis aplani le terrain à la main avant de remplir de nouveau. C'était lent et inexact : le terrain d'origine n'était pas plat, la demande était fermée (relief verrouillé), et rien ne gardait l'état d'avant.

Désormais :

- `magic_fill_apply { request }` sauve le checkpoint `mf-<id demande>` juste avant sa première écriture, et note dans `magic-fill/<id>.json` le checkpoint et la dernière entrée du journal à ce moment (`checkpoint`, `checkpointJournalId`).
- Refaire : `magic_fill_apply { request, redo: true, … }` restaure ce checkpoint (`load_park`, journal et zones du serveur), rouvre la demande (relief permis dans son emprise), puis remplit avec les nouveaux réglages. Le checkpoint est gardé : chaque nouvelle tentative repart du même état d'origine.
- `magic_fill_revert` fait le retour seul (défaire sans refaire).
- Garde-fou : les opérations journalisées après le checkpoint, sauf les remplissages de cette demande, seraient perdues. L'outil les liste et refuse sans `discardLaterWork: true`. Les retouches faites à la main en jeu depuis ne sont pas journalisées : elles sont perdues sans avertissement.
- Remplir de nouveau une demande déjà remplie sans `redo` est refusé (on empilerait relief et scénerie sur l'ancien remplissage) ; pour ajouter par-dessus, `tiles`/`rect` avec `occupied: 'add'`.
- Une nouvelle demande peinte sur une région déjà remplie porte `previousFills` dans `magic_fill_requests` : `magic_fill_revert` de l'ancienne, puis remplir la nouvelle.
- Les demandes remplies avant cet ajout n'ont pas de checkpoint : `redo` répond `NOT_FOUND` et propose `undo_last`.

### 3.2 Eau et rivières [DÉCISION, 10 octobre 2026]

Constat du 10 octobre : consigne « A long river zigzaging through hills with trees, bushes and rocks », style « A river with trees, rocks and bushes » choisi. Résultat : forêt et rochers, **aucune eau** ; Claude (Haiku) a pourtant annoncé « un chenal d'eau sinueux », trompé par la capture du style à côté du résultat. Trois causes :

1. `matchWater` (défaut) écartait toute tuile d'eau du style tombant sur une cible sèche : le chenal du style n'était jamais tamponné.
2. Rien ne posait d'eau : seuls relief, textures et scénerie étaient recopiés.
3. Le résultat ne comptait pas l'eau : rien ne contredisait la capture du style.

Correction :

- `water: "copy"` (défaut, même permission que le relief) : une tuile d'eau du style peut tomber sur une tuile sèche ; elle est remise en eau au niveau du style relatif à son point le plus bas (× `reliefScale`), compté depuis le sol d'origine de la tuile d'ancrage du tampon. Confinement ensuite : une tuile dont un bord donne sur un sol plus bas que l'eau resterait « suspendue » ; elle reste sèche (`water.leaked`), jusqu'à stabilité. Hors de la région, le voisin est supposé au niveau d'origine du bord.
- `river` : les tampons étant tirés au hasard, l'eau des styles ne fait que des mares. Une rivière continue est tracée **avant** le tamponnage : ligne brisée (`path`) ou zigzag automatique de bord à bord le long du grand axe de la région (`bends` virages), `width` tuiles de large (reliée par les bords, jamais par un coin), lit à plat `depth` niveaux sous l'eau, eau au ras du sol le plus bas du tracé. Ces tuiles deviennent de l'eau pour le tamponnage (l'eau des styles et ses plantes y vont, `matchWater`) et pour le relief (berges fixées, collines qui montent à partir d'elles). Une tuile de rivière qui déborderait est rebouchée. Avec une rivière, l'eau des styles n'est posée que sur l'eau. `river: "auto"` (défaut) trace une rivière si la consigne de la demande dit rivière / river / stream / creek / ruisseau… ; `"none"` jamais.
- Pose : relief, textures, puis eau (`terrain.set_water` par segments de ligne au même niveau), puis scénerie. L'inverse retire l'eau avant de remettre le terrain.
- Résultat : bloc `water { tiles, fromStyles, river { tiles, level, bedLevel, path }, leaked }`, `changed.water`, et le résumé dit « Eau posée sur N tuile(s) » ou « Aucune eau posée ». Si la consigne parle d'eau et qu'aucune n'est posée : avertissement `AUCUNE EAU POSÉE … ne dis pas à l'utilisateur qu'il y a de l'eau`. `magic_fill_requests` le rappelle dans ses hints.

### 3.3 Bâtiments en terrain [DÉCISION, 12 octobre 2026]

Constat du 12 octobre : consigne « A city with tall buildings, in a dense forest with some hills and a river ». Deux styles « A tall building » étaient candidats. Ce sont des gratte-ciel à la RCT1 : un patch 4×4 dont la colonne 2×2 du centre est 16 niveaux plus haut que le reste, avec la bordure `rct1ll.terrain_edge.skyscraper_a/b`, et **aucun objet**. Claude (Haiku) les a écartés : le résumé montrait `objects: []`, `density: 0` et un `heightRange` de 16, présenté par les hints comme « collines, creux ». Résultat : une forêt sans ville. Trois autres défauts seraient apparus même en les choisissant :

1. Le résumé ne donnait pas les bordures : rien ne distinguait un immeuble d'une colline.
2. Un tampon de tour coupé (bord de la région, rivière, tuile prise par un autre tampon) collait la colonne au voisin. L'étape « coutures » de `copyRelief` faisait alors monter le voisin jusqu'au toit, ce qui donnait une colline de 16 niveaux, ou une rampe vers un bord fixé.
3. La capture masquée effaçait la face de la tour : la colonne de masque d'une tuile allait de son propre sol à son sommet, alors que la falaise est dessinée jusqu'au sol de la voisine. Il ne restait que le toit, qui semblait flotter.

Correction :

- `styles/structure.ts` : `terrainStructure` relève les tuiles plus hautes qu'une voisine du style d'au moins 4 niveaux sur tout un bord (les deux coins). La construction est `building` si la bordure de ces tuiles figure une façade (skyscraper, brick, iron, wood, glass…, d'après l'identifiant ou le nom), sinon `cliff`.
- Résumé (`style_list`, `style_get`, candidats de `magic_fill_requests`) : `terrain.edges` et `structure`, ex. « bâtiment en terrain : 4 tuile(s) surélevée(s) de 16 niveaux à pic (bordure rct1ll.terrain_edge.skyscraper_b) ». Les hints disent qu'un style sans objets n'est pas forcément vide.
- Planificateur : un style `building` n'est tamponné qu'entier, sur des tuiles libres, sèches, hors rivière et remodelables. Sinon le tirage est écarté et, si seuls des bâtiments sortent, on retire parmi les autres styles. Son relief est recopié à l'échelle 1 (`reliefScale` ne vaut que pour le relief naturel).
- Résultat : `buildings { stamps, misses }`. Avertissements : aucun bâtiment posé faute de place ; consigne qui demande des bâtiments (city, town, building, tower, ville, immeuble…) sans aucun style qui en contienne ; bâtiments non construits quand le relief est verrouillé.
- Masque (`columnsOf`) : chaque colonne descend jusqu'au sol de sa voisine la plus basse dans le style. Les captures déjà enregistrées gardent l'ancien masque : il faut annoter le style de nouveau pour le corriger.

### 3.4 Constructions en blocs rigides [DÉCISION, 12 octobre 2026]

Constat du 12 octobre : consigne « A castle, with many castle towers, interconnected by castle walls, on top of a hill with trees, and a small river at the bottom of the hill » sur 2 500 tuiles. Claude (Haiku) a bien choisi : « castle tower » (poids 3), « castle wall » (2), « small hill with trees » (2). Résultat : tours et pans de mur épars, des pièces flottantes. Ce n'était pas une erreur du modèle :

1. Le tamponnage au hasard ne relie rien : il fait des forêts, pas des enceintes.
2. Ces styles sont presque entièrement en l'air (tour : 257 éléments sur 281 au-dessus du sol, jusqu'à 22 marches ; mur : 96 sur 128). Chaque élément gardait l'écart au sol de **sa** tuile : sous la colline recopiée, les étages d'une même tour glissaient les uns par rapport aux autres.
3. Un tampon coupé (bord de la région, rivière, autre tampon) gardait les pièces hautes sans leurs appuis ; les grandes scénerie incomplètes étaient écartées, d'autres orphelines en plus.

Correction :

- **Nature d'un style** (`styleKind`, `styles/structure.ts`) : `structure` si c'est un bâtiment en terrain (§ 3.3) ou si au moins 6 éléments et 30 % de la scénerie sont surélevés (écart ≥ 2 sur tuile plate, ≥ 3 sur pente) ; sinon `natural`. Le choix de l'utilisateur l'emporte : liste **Kind** du Style Picker, `style_save { kind }`, `style_update { id, kind }`. Sur les styles du 12 octobre : tour et mur `structure`, collines et rivière `natural`, gratte-ciel `structure`. Le résumé (`style_list`, `style_get`, candidats) donne `kind`.
- **Bloc rigide** (`planners/magicFill.ts`) : une construction n'est tamponnée qu'entière (comme les bâtiments en terrain), et :
  - un niveau de base pour tout le bloc : la moyenne des coins du terrain sous son emprise, ou `level` ;
  - relief (`relief: "copy"`) : le sol du bloc est nivelé sur cette base, son relief propre recopié tel quel, coins fixés ; le terrain voisin garde son niveau d'origine contre le bloc (le bord devient une falaise de terrasse, sans rampe ni oscillation du lissage) ;
  - chaque élément est posé à une hauteur explicite : base × 2 + (baseHeight dans le style − point le plus bas du style × 2). Les étages restent alignés quelle que soit la pente ;
  - `density` ne l'éclaircit pas (une pièce retirée laisserait flotter celles du dessus) ;
  - relief verrouillé : le bloc reste rigide sur le terrain tel quel (enterré d'un côté, décollé de l'autre sur une pente) ; `structures.unlevelled` et un avertissement le disent.
- **Blocs explicites** : `magic_fill_apply { blocks: [{ id, x, y, rotation, level?, crop? }] }`. `(x, y)` = coin (x, y minimaux) de l'emprise après rotation et découpe ; `crop { x1, y1, x2, y2 }` garde une partie du style (coordonnées du style, avant rotation) ; `level` fixe la base (le même pour des pièces qui se raccordent). Les blocs sont posés avant la rivière et le tirage au hasard ; un bloc qui ne tient pas est refusé avec la raison (hors de la région, chemin, eau, scénerie gardée avec `occupied: "skip"`, autre bloc). Avec `occupied: "add"`, un bloc se pose par-dessus la scénerie existante (Zero Clearances) : c'est ainsi qu'on raccorde une construction déjà posée (prolonger un mur jusqu'au cœur d'une tour) ; le sol n'y est pas nivelé. Sans `request`, `tiles` ni `rect`, la région est l'emprise des blocs et `styles` peut être vide. Les grandes scénerie dont l'emprise sort de la découpe ne sont pas posées.
- **Layout** (`style_get`) : hauteur du plus haut élément de chaque tuile (niveaux, base 36), rangée par rangée, et rangées identiques consécutives (`repeatingBands`) avec le `crop` d'une rangée à répéter. Mur du 12 octobre : rangées y = 2..3 identiques.
- Résultat : `buildings` devient `structures { stamps, misses, blocks, unlevelled }`. Avertissements : blocs refusés ; plusieurs constructions tirées au hasard alors que la consigne parle de bâtiments (« elles ne sont pas reliées : place les pièces avec blocks »).

Assembler un mur de château (largeur 4 comme la tour) : tour 4×4 au coin ; le mur part juste après la tour sans sa rangée d'extrémité y = 0 (la bordure de la tour en tient lieu) : `crop` y = 1 (extrémité), puis N × `crop` y = 2 (rangée répétable), puis `crop` y = 4, puis la tour suivante ; tous au même `level`, ou en marches sur une colline. Un mode « enceinte » (contour → tours et murs posés par le serveur) reste à faire.

---

## 4. Remplissage (`planners/magicFill.ts`)

Claude **compose** (styles, poids, densité, graine), un planificateur déterministe **place** (SPEC 11.1). Il tamponne des patchs entiers des styles :

1. Les tuiles cibles sont relevées (`styles.extract`). Tuiles à chemin, piste ou entrée : évitées (`avoidPaths`). Tuiles déjà décorées : `occupied` = `skip` (défaut), `add` (par-dessus) ou `replace` (scénerie vidée d'abord par `clearscenery`, non annulable).
2. Rivière d'abord si `river` (§ 3.2). Puis, tant qu'il reste une tuile libre (ordre aléatoire) : un style est tiré selon les poids, une de ses tuiles et une rotation (`rotate`) ; toutes les tuiles du style tombent sur les tuiles cibles correspondantes. Une tuile de style sèche ne va pas sur l'eau ; une tuile d'eau du style va sur l'eau, ou sur une tuile sèche remise en eau si `water: "copy"` sans rivière (`matchWater`).
3. Chaque élément garde son objet, ses couleurs, son quadrant et sa direction (plus la rotation du patch : même règle que les designs, `TrackDesign.cpp`). Les vides du style restent vides : la densité du style est conservée ; `density` < 1 éclaircit.
4. Hauteurs : un objet posé au sol dans le style est posé au sol (hauteur automatique du jeu, qui suit pente et eau) ; un objet surélevé ou enterré garde son écart (`dz`) à la surface, ou à l'eau s'il flottait.
5. Une grande scénerie n'est posée que si toute son emprise tombe dans des tuiles du même patch.
5 bis. Constructions et blocs explicites : bloc rigide, un niveau de base, hauteurs explicites, sol nivelé, jamais éclairci (§ 3.4).
6. Seules petite scénerie, grande scénerie et murs sont posés. Chemins, pistes, entrées et bannières du style sont comptés dans `notPlaced` (les attractions d'un style restent lisibles dans `style_get`, pour `ride_place`).

Pose : les objets absents du parc sont chargés (`objects.load`) : un style relevé dans un autre parc s'applique tel quel. Si le parc n'a plus d'emplacement libre pour un type d'objet (limite d'`ObjectLimits.h` : 2 047 pour la scénerie et les murs ; `objects.load` répond `reason: "limit"`), une boîte d'avertissement s'ouvre en jeu (`ui.alert`), les éléments de ces objets sont écartés et le reste est posé ; la réponse porte `objectLimit { objects, discarded }` et l'état de la demande « N skipped (object limit) ». Ensuite, le cheat **Zero Clearances** (`disableClearanceChecks`) est activé le temps de la pose s'il ne l'était pas, puis rétabli, même en cas d'erreur. Les hauteurs exactes passent par le nouveau champ `baseHeight` des méthodes `scenery.place_*`. Le journal garde l'inverse de chaque élément posé (`smallsceneryremove`, `wallremove`, `largesceneryremove`) pour `undo_last`.

Vérification : sauf `compare: false`, la région remplie est capturée de la même façon que les styles (`capture.masked`, rotation `rotation`) et renvoyée en planche **RESULT | STYLE 1 | STYLE 2** (les deux styles les plus utilisés, même rotation). La demande passe à `done` (ou `failed`) dans la fenêtre du jeu.

---

## 5. Protocole plugin ⇄ serveur

Nouvelles méthodes (`MethodMap`, `packages/protocol/src/methods.ts`) :

| Méthode | Rôle |
|---|---|
| `styles.capture { tiles, caption, screenshot?, rotations?, source? }` | Relevé + captures masquées (ce que fait **Save Style**). |
| `styles.extract { tiles }` | Relevé seul (région à remplir, voisinage). |
| `inbox.take {}` | Ce qui attend dans le plugin : au plus un style (quelques Mo possibles) et toutes les demandes Magic Fill. |
| `inbox.ack { styles, fills }` | Le serveur a rangé ces éléments : le plugin les oublie. |
| `capture.masked { name, tiles, rotations? }` | Capture masquée de tuiles quelconques. |
| `magic_fill.status { id, status, message? }` | État affiché dans la fenêtre du Magic Fill Tool. |
| `ui.alert { title, message }` | Boîte d'avertissement en jeu (`ui.showError`) ; `shown: false` sans interface. |

Événement `inbox { styles, fills, clearStyles? }` : le plugin l'émet à chaque nouvel élément et à chaque connexion d'un serveur s'il reste des éléments ou un effacement demandé. `inbox.take` rend `clearStyles: true` après **Clear all stored styles** ; le serveur vide la base puis acquitte avec `inbox.ack { clearedStyles }`, et la fenêtre affiche le nombre supprimé.

Champ ajouté : `reason` (`not_installed`, `limit`, `error`) dans les résultats d'`objects.load`. Le serveur (`styles/inbox.ts`) vide alors la boîte d'envoi : `take`, enregistrement, `ack`, jusqu'à ce qu'elle soit vide.

Champ ajouté : `baseHeight?` (hauteur exacte en unités de 8, prioritaire sur `level`) dans les éléments de `scenery.place_small`, `scenery.place_large`, `scenery.place_wall` et `scenery.remove_small`.

---

## 6. Fichiers ajoutés ou modifiés

| Fichier | Changement |
|---|---|
| `packages/protocol/src/styles.ts` (nouveau) | Types `StyleRecord`, `MagicFillRequest`…, constantes (plafonds, clé de stockage), `surfaceCenterZ`, `rotateQuarter`, `slugify`. |
| `packages/protocol/src/methods.ts`, `index.ts` | Six méthodes ; `baseHeight` dans les éléments de scénerie. |
| `packages/plugin/src/styles/extract.ts` (nouveau) | Relevé d'une région (job découpé par tranches de 48 tuiles), origine des grandes scénerie, sans lire les propriétés qui journalisent des avertissements (F29). |
| `packages/plugin/src/styles/capture.ts` (nouveau) | Capture masquée (cacher, capturer, rétablir dans une frame). |
| `packages/plugin/src/styles/inbox.ts` (nouveau) | Boîte d'envoi : styles persistés dans `sharedStorage`, demandes en mémoire, états, abonnements des fenêtres. |
| `packages/plugin/src/ui/brush.ts`, `ui/windows.ts` (nouveaux) | Pinceau partagé, fenêtres Style Picker et Magic Fill Tool, entrées du menu des plugins. |
| `packages/plugin/src/handlers/styles.ts` (nouveau), `handlers/index.ts` | Méthodes du protocole. |
| `packages/plugin/src/handlers/build.ts` | `baseHeight` pour la pose et le retrait de scénerie. |
| `packages/plugin/src/main.ts` | Menus, événement `inbox`, état de connexion pour les fenêtres. |
| `packages/server/src/styles/store.ts`, `styles/inbox.ts` (nouveaux) | Base de styles sur disque (résumés, recherche, masquage des captures reçues), réception et file des demandes Magic Fill. |
| `packages/server/src/planners/magicFill.ts` (nouveau) | Planificateur de remplissage. |
| `packages/server/src/render/mask.ts` (nouveau) | Masque d'une capture à l'emprise projetée d'une région. |
| `packages/server/src/tools/styles.ts` (nouveau), `server.ts` | Sept outils MCP ; règle d'usage dans `INSTRUCTIONS`. |
| `packages/server/src/config.ts` | `stylesDir` (`OPENRCT2_STYLES_DIR`). |
| `packages/server/src/tools/observe.ts`, `tools/helpers.ts` | `waitForFile` exporté ; `chunks` accepte une taille quelconque (le type était figé à 500). |
| `fake-plugin/src/*` | Méthodes des styles et de la boîte d'envoi, `pushInbox` pour les tests, pose sans dégagement quand le cheat est actif, `baseHeight`. |
| `packages/server/test/magic-fill.test.ts` (nouveau) | 16 tests : planificateur (copie, rotation, graine, densité, chemins, eau, grande scénerie), résumé et pertinence, masque, parcours complet contre le faux plugin (style reçu, demande remplie, cheat rétabli, couleurs gardées, `undo_last`, `style_save`, `magic_fill_dismiss`, limite d'objets avec boîte d'avertissement, « Clear all stored styles »). |

---

## 7. Vérifié et à vérifier

- **Vérifié** : typage des trois paquets, bundle du plugin (pas d'`import`/`export` ni d'`Intl`), 16 tests (dont limite d'objets et effacement de la base, ajoutés le 10 octobre au soir) ; toute la suite passe sauf `timber-ridge-drop.test.ts`, qui échoue aussi sans ces changements (recherche bornée à 90 s).
- **Pas encore vérifié en jeu** : le jeu ouvert le 10 octobre n'avait pas le rechargement à chaud (`enable_hot_reloading = false`) et le pont était tenu par le serveur MCP de la session. Le plugin est installé dans `~/.config/OpenRCT2/plugin/` : il se charge au prochain lancement du jeu ; les outils apparaissent après redémarrage du serveur MCP (`/mcp`). À confirmer alors (S10) : rendu sans les éléments cachés et fond transparent, aucun élément resté caché, codes de couleur `{GREEN}`/`{RED}` dans les libellés, surbrillance du pinceau, boîte `ui.showError` de la limite d'objets, bouton à deux clics.
