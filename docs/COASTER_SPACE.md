# Compacité d'un circuit : ce que le serveur doit mesurer et imposer

> Rédigé le 7 octobre 2026, après la retouche de Nightmare Frenzy (COASTER_REFERENCE.md, « Suite »). L'excitation est passée à 0,16 de Frightmare, mais le circuit reste un anneau autour d'un intérieur vide, sur une emprise 1,3 fois plus grande. Ce document complète COASTER_REFERENCE.md (P3, P4, P6) et passe avant la suite de P4.

## 1. Constat mesuré

Mesures faites sur les deux circuits du parc (pièces gardées dans `claude-coaster-measures.json`), avec les définitions de la section 3 :

| | Frightmare (ride 5) | Nightmare Frenzy (ride 9) |
|---|---|---|
| Emprise | 24×17 = 408 tuiles | 28×19 = 532 tuiles |
| Couverture (tuiles de piste / emprise) | 45 % | 31 % |
| Tuiles empilées (la piste passe au-dessus d'une autre partie d'elle-même) | **80** | **20** |
| Plus grand rectangle vide dans l'emprise | 8×8 (16 %) | 19×6 (21 %) |
| Lift : tuiles avec de la piste dessous | 11 (écart min. 2,5 niveaux) | 0 (voisin à 3 tuiles) |
| Grande demi-boucle : voisin le plus proche | 0 tuile, 5 tuiles partagées (1,5 niveau) | 1 tuile, aucune partagée |
| Tire-bouchon : voisin le plus proche | 0 tuile, piste 10,5 niveaux dessous | 4 tuiles |
| Éléments à 0 tuile d'une autre partie du circuit | 21 sur 27 | 4 sur 14 |

Frightmare est un bloc. Presque chaque élément touche ou croise une autre partie du circuit, souvent à 1 ou 2,5 niveaux d'écart. La seconde moitié du parcours passe sous le lift, sous la première chute et à travers la boucle. Nightmare Frenzy pose ses éléments côte à côte, chacun isolé.

## 2. Pourquoi le serveur ne le voit pas

1. **Pas de lecture spatiale de la référence.** `coaster_describe` donne une séquence de pièces et des hauteurs. Il ne dit pas qui passe sous qui, à quelle distance, ni où est le vide.
2. **Pas d'objectif d'espace pendant la construction.** `coaster_build_plan` enchaîne les macros depuis le bout du circuit, comme une tortue. L'emprise et la densité ne sont données qu'après coup, sans avertissement d'élément isolé ni d'emprise dépassée. On ne peut ni dire « passe sous le lift » ni « reste dans ce rectangle ».
3. **Un contrôle de collision trop prudent.** Jusqu'au 7 octobre, le serveur imposait 2,5 niveaux d'écart entre deux blocs. Frightmare se croise à 1 et 1,5 niveau : son tracé était impossible à reconstruire. C'est corrigé pour l'essentiel (dégagement réel par bloc, `TRACK_BLOCK_CLEARANCE`). Les quarts de tuile occupés restent ignorés, si bien que certains croisements acceptés par le jeu sont encore refusés.
4. **Une recherche de section sans critère d'espace.** P4 prévoit de fermer une section sous contraintes de géométrie et de vitesse, mais ne cherche ni à croiser le circuit existant ni à rester compact.

## 3. Mesures à calculer (`planners/space.ts`, fonctions pures)

Toutes se calculent à partir des pièces (`pieceElements`, `TrackBlock` avec `cz`) et, pour le vide et le volume libre, du cache de carte. Unités : tuiles, niveaux (16 unités monde).

> **Fait (7 octobre 2026), étape 1.** `planners/space.ts` : `spaceElements`, `spaceProfile`, `largestEmptyRect`, `freeVolume`, `isClosed` ; tests dans `test/space.test.ts`. `tools/space-analysis.mjs` appelle désormais `spaceProfile` (sur les mesures gardées, ou sur des `.td6` passés en argument). Mesuré : Frightmare (ride 5, en jeu `112:a707f934`, et `Frightmare.TD6`) et Nightmare Frenzy (ride 9, `87:464ee5d4`) donnent exactement les chiffres de la section 1. Le `.td6` a les mêmes 112 pièces que le circuit du parc ; il commence 3 pièces plus tôt dans la boucle, d'où des indices décalés de 3.

**Éléments.** Découper le circuit en éléments : lift (pièces à chaîne), station, freins, puis chaque suite de pièces du même genre (`elementKind`, sans le côté ni le préfixe `banked`/`halfBanked`). Une pièce sans genre (droite ou transition : `flatToDown25`, `leftBankToFlat`…) ferme l'élément en cours et n'appartient à aucun élément. C'est la règle du prototype qui a produit la section 1. L'idée de rattacher les transitions à l'élément suivant n'a pas été retenue : elle changerait les chiffres de référence sans rien apporter de mesurable. Dans les croisements, une suite de pièces hors élément compte comme une seule « liaison » (`flat+onRidePhoto+flatToLeftBank`).

**Pièces voisines dans le parcours.** Deux pièces dont les indices diffèrent d'au plus 2, modulo la longueur du circuit, sont voisines. Elles ne comptent jamais dans les mesures de proximité. Sur un tracé en cours de construction (non fermé, détecté sur les poses par `isClosed`), les indices ne bouclent pas : sinon la première et la dernière pièce d'un tracé court passeraient pour voisines.

Par élément :

- `tiles` : tuiles occupées (ensemble des blocs).
- `nearestGap` : plus petite distance de Tchebychev (0 à 4, au-delà « > 4 ») entre une tuile de l'élément et une tuile portant une pièce non voisine hors de l'élément.
- `shared` : nombre de tuiles de l'élément qui portent aussi une pièce non voisine, et `minLevelGap` : plus petit écart vertical en niveaux entre les blocs concernés. 0 tuile partagée signifie que l'élément est posé à côté du reste, pas mêlé à lui.
- `crossings` : liste `{ autreÉlément, tuiles, écart min en niveaux, dessus | dessous | mêlé }`, triée par nombre de tuiles. C'est la donnée à imiter. Exemple mesuré sur Frightmare : le lift passe au-dessus de la liaison photo (7 tuiles, 4,5 niveaux), de la spirale descendante (4 tuiles, 5 niveaux), de l'hélice montante finale (4 tuiles, 8 niveaux) et de la grande hélice descendante (2 tuiles, 2,5 niveaux).

Pour le circuit :

- `coverage` = tuiles de piste distinctes / tuiles de l'emprise.
- `stackedTiles` : tuiles portant au moins deux pièces non voisines.
- `largestVoid` : plus grand rectangle de l'emprise sans aucune piste, à n'importe quelle hauteur (taille, position, part de l'emprise).
- `isolated` : éléments dont `nearestGap ≥ 2` et `shared = 0`.
- `freeVolume` (P6) : pour chaque tuile d'un rectangle, les intervalles de niveaux libres entre le sol et un plafond, compte tenu du dégagement réel des blocs (`blockSpan`) et, avec le cache de carte, du terrain, de l'eau, des chemins (3 niveaux, comme `blockProblem`) et des pièces d'attraction déjà posées (`ri`). Il sert à proposer où empiler. Pas encore utilisé par un outil (étapes 4 et 5).
- Écart vertical : plus petit écart entre deux blocs quelconques de la tuile, et non entre le bloc le plus bas de l'élément et les autres comme dans le prototype. Les chiffres de la section 1 n'en changent pas.

Valeurs de référence à figer dans les tests unitaires, calculées sur `Frightmare.TD6` relu par `designLayout` : couverture ≈ 45 %, 80 tuiles empilées, vide 8×8, lift 11 tuiles partagées. Comparer avec une tolérance, car le `.td6` et le circuit posé dans le parc peuvent différer d'une pièce.

## 4. Ce que les outils doivent exposer

### 4.1 Lecture : `coaster_describe` et `coaster_compare`

- `space` dans `coaster_describe` (circuit ou `.td6`) : profil global (emprise, couverture, empilement, plus grand vide) et tableau par élément (`nearestGap`, `shared`, `minLevelGap`, croisements). Rester sous le budget de réponse : 1 ligne par élément.
- Une image du plan, comme `get_region_map { format: png }` : couleur = niveau, numéro d'élément, hachures sur les tuiles empilées, vide le plus grand encadré. Le texte seul ne suffit pas pour voir le vide.
- `coaster_compare` ajoute ces mesures côte à côte et des **leviers d'espace**, rédigés comme ceux des notes : « grande demi-boucle isolée (voisin à 1 tuile, 0 partagée) ; dans la référence, 0 tuile et 5 partagées à 1,5 niveau » ; « emprise 1,3 × la référence » ; « vide 19×6 au centre ».

> **Fait (8 octobre 2026), étape 2 sans l'image.** `coaster_describe` (circuit ou `.td6`) renvoie `space` (`spaceView` : emprise, `coveragePct`, `stackedTiles`, `largestVoid`, `liftShared`, éléments isolés et une ligne par élément avec son croisement principal) et `suggestedBounds` (emprise + 10 %, Frightmare : 27×19). `coaster_compare` renvoie `space` côte à côte, `spaceLevers` (`planners/space.ts`) et l'emprise, la couverture et les tuiles empilées dans son résumé. L'image du plan reste à faire.

### 4.2 Construction : `coaster_build_plan`, fermeture, recherche de section

> **Fait (8 octobre 2026), étape 4.** `coaster_build_plan { bounds: { x1, y1, x2, y2, minLevel?, maxLevel? } }` : toute pièce du plan dont un bloc sort du rectangle (ou des niveaux absolus) est refusée avant simulation, avec la pièce fautive (`boundsProblem`). La fermeture A* ne pose rien hors de `bounds`. `bounds` est gardé en mémoire du serveur pour les appels suivants sur le même circuit (`null` l'efface ; un `dryRun` ne l'enregistre pas). La réponse donne `space` (vue sans le détail par élément, plus le rectangle en vigueur) et un avertissement `ISOLÉ` par élément du plan posé à 2 tuiles ou plus du reste sans rien partager. La fermeture A* préfère, à coût égal, les pièces posées sur une tuile déjà occupée par le circuit (bonus de 0,4 par pièce). Reste à faire : citer, dans l'avertissement `ISOLÉ`, ce que fait la référence pour le même genre d'élément.

- **`bounds`** (rectangle de tuiles, et en option niveaux min et max) sur `coaster_build_plan`, sur la fermeture A* et sur `coaster_search_section` (P4). Une pièce hors du rectangle est refusée avant toute simulation, avec l'élément fautif. Valeur conseillée pour imiter une référence : son emprise, majorée de 10 % au plus.
- **Mesures après chaque appel** : `layout` gagne `coverage`, `stackedTiles`, `largestVoid` et la liste des éléments isolés. Un avertissement `ISOLÉ` part pour tout élément posé à 2 tuiles ou plus du reste sans rien partager, avec ce que fait la référence pour le même genre d'élément.
- **Objectifs de la recherche de section (P4)** : en plus de la géométrie et de la vitesse, classer les variantes par tuiles partagées gagnées, puis par emprise, et rejeter celles qui sortent de `bounds`. Paramètre `prefer: { under: <indices de pièces>, through: <élément> }` pour viser un passage sous le lift ou à travers une boucle.
- **Fermeture A*** : respecter `bounds` et, à coût égal, préférer les pièces qui passent au-dessus ou au-dessous du circuit existant.

### 4.3 Collision : finir P6

- Générer aussi `quarterTile` (quarts de tuile occupés, rotation selon la direction) par bloc dans `gen-tables.mjs`, et ne déclarer un conflit que si les quarts se recoupent, comme `MapCanConstructWithClearAt`. Sans cela, certains croisements serrés de Frightmare restent refusés par le serveur alors que le jeu les accepte.
- Appliquer le dégagement réel dans `blockProblem` (terrain, chemins, entrées).
- Valider en jeu : reconstruire à blanc (`dryRun`) les sections de Frightmare qui se croisent à 1 et 1,5 niveau ; le serveur ne doit en refuser aucune que le jeu accepte.

## 5. Méthode de construction compacte (guide pour Claude, à reporter dans SPEC 14)

1. Lire la référence : `coaster_describe` (séquence, notes et `space`), puis `coaster_compare` si un essai existe déjà. Relever l'emprise, la couverture, l'empilement et les croisements marquants : ce qui passe sous le lift, à travers la boucle, sous la première chute.
2. Fixer `bounds` = emprise de la référence × 1,1 au plus, placée sur une zone libre et possédée (`get_region_map`).
3. Poser la station et le lift sur un bord de `bounds`, et laisser le côté sous le lift libre : la seconde moitié du parcours y passera.
4. Construire la première moitié (chute, grande inversion, premiers virages) en restant dans `bounds` et en tournant vers l'intérieur plutôt que vers l'extérieur.
5. Pour la seconde moitié, demander à la recherche de section des variantes qui passent sous le lift et à travers ou sous la grande inversion, puis empiler hélices et virages en pente dans le vide restant (`largestVoid`).
6. Après chaque appel : lire `space` et les avertissements `ISOLÉ`, et corriger tout de suite, pas à la fin. Tester (`coaster_test`) puis comparer (`coaster_compare`) : notes **et** espace.
7. Ne jamais sacrifier une fenêtre de vitesse pour gagner de la place : un élément mal placé en vitesse coûte plus que de la densité.

## 6. Critère de réussite

En partant d'une zone libre et de la consigne « dans le style de Frightmare », en moins de 40 appels d'outils, sur un circuit du même type :

- emprise au plus 1,2 × 408 tuiles, et chaque côté au plus 1,2 × celui de la référence ;
- couverture d'au moins 40 % et au moins 50 tuiles empilées ;
- plus grand vide d'au plus 20 % de l'emprise ;
- au plus 2 éléments isolés, hors station et lift ;
- en plus des critères de COASTER_REFERENCE section 4 : excitation à 0,3 près de la référence mesurée, intensité sous 8, un seul lift droit, aucun élément hors de sa fenêtre de vitesse ;
- relief (section 8) : au moins la moitié des pièces à 90° de la référence, au plus 2 éléments hauts de moins qu'elle, et un point haut à 4 niveaux près du sien dans chaque cinquième du parcours après le lift.

## 7. Ordre de mise en œuvre proposé

| Étape | Contenu | Validation |
|---|---|---|
| 1 — **fait** | `planners/space.ts` + tests (valeurs de la section 1 sur Frightmare.TD6) | tests unitaires, puis en jeu sur les rides 5 et 9 : mêmes chiffres que la section 1 (vérifié, voir section 3) |
| 2 — **fait sauf l'image** | `space` dans `coaster_describe`, `coaster_compare` (mesures, leviers d'espace, image) | lecture en jeu des deux circuits |
| 3 | Quarts de tuile dans le dégagement (fin de P6, collisions) | `dryRun` des croisements serrés de Frightmare |
| 4 — **fait** | `bounds`, mesures et avertissements `ISOLÉ` dans `coaster_build_plan` et la fermeture | construction en jeu d'une section dans un rectangle imposé |
| 5 — **fait** | `coaster_search_section` (P4) avec `bounds` et objectifs d'empilement | fermeture d'une seconde moitié qui passe sous le lift |
| 6 | Essai complet : critère de la section 6 | circuit construit en jeu, comparé à Frightmare |

## 7 bis. Night Terror : 3 trains, mais pas compact (8 octobre 2026)

Construit « dans le style de Frightmare » en respectant ses sections de bloc (COASTER_REFERENCE P9), avant les étapes 2 et 4. Notes à 0,04 de la référence (7,36 / 8,10 / 4,22), 3 trains, mais l'utilisateur a relevé que le circuit n'avait pas la compacité de la référence. Mesures (`spaceProfile` sur les pièces relevées par `coaster_test`) :

| | Frightmare | Night Terror (ride 10) |
|---|---|---|
| Emprise | 24×17 = 408 tuiles | 29×26 = **754** tuiles (1,85 ×) |
| Couverture | 45 % | 30 % |
| Tuiles empilées | 80 | **11** |
| Lift : tuiles avec de la piste dessous | 11 | 1 |
| Éléments isolés | 1 | **8** |

Cause : le serveur ne donnait l'emprise et la densité qu'après coup, sans objectif ni avertissement. Le circuit a été construit élément par élément vers l'espace libre, puis ramené à la station par l'extérieur. `spaceLevers` rédige aujourd'hui ces écarts : « emprise 1,85 × la référence : reconstruis dans bounds 27×19 », « tuiles empilées 11 contre 80 », « lift : 1 tuile partagée contre 11 », « éléments isolés 8 contre 1 ». Leçon : fixer `bounds` dès le premier plan, garder le dessous du lift libre pour la seconde moitié, et réserver le couloir d'arrivée en gare.

## 7 ter. Longueur de piste imposée par la référence (8 octobre 2026)

### Constat

Night Terror refait dans `bounds` 27×19 (checkpoint `night-terror-compact`) : emprise 26×16 = 416 tuiles, 1,02 × Frightmare. Le circuit paraît pourtant bien moins compact, et l'utilisateur l'a relevé. Les mesures étaient justes, recomptées tuile par tuile sur la carte du jeu : 159 tuiles de piste sur 416 pour Night Terror (38 %), 183 sur 408 pour Frightmare (45 %). L'erreur était dans ce que le serveur imposait :

- **L'emprise seule ne dit rien de la densité.** Frightmare pose 205 tuiles de piste (1140 m, 112 pièces) dans son rectangle. Night Terror n'en pose que 150 (832 m) : c'est un contour fin qui remplit la même boîte. Densité 0,36 contre 0,50.
- **`bounds` borne sans remplir.** Un circuit court tient toujours dans le rectangle de la référence. Rien n'obligeait à poser autant de piste qu'elle.
- **`spaceLevers` ignorait la longueur.** Couverture, empilement et dessous du lift étaient signalés, mais pas l'écart de longueur, qui est le plus gros. Claude a lu « emprise 1,02 × » comme un succès.

### Fait

- `planners/target.ts` : `referenceTarget` tire d'un circuit fermé (ride du parc ou `.td6`) sa longueur de piste (`lengthTiles`), son nombre de pièces, son emprise, sa densité, sa couverture, ses tuiles empilées, le dessous du lift (`liftShared`), ses inversions et ses trains permis. `checkTarget` compare le circuit en cours à ces cibles, et `targetLevers` rédige les écarts.
- `coaster_build_plan { reference: { ride } | { design } }` : la référence est gardée pour les appels suivants sur le même circuit (`null` l'efface ; un `dryRun` ne l'enregistre pas). Chaque réponse donne `target` : longueur actuelle / référence avec le minimum pour fermer, `remainingTiles`, densité, tuiles empilées, dessous du lift et trains, chacun sous la forme « actuel / référence ». Sur un circuit ouvert, l'avertissement `LONGUEUR` dit combien de tuiles il reste à poser.
- **Fermeture refusée** si le circuit fermé fait moins de 90 % de la longueur de piste de la référence (`LENGTH_MIN`), ou s'il permet moins de trains qu'elle. Avec `dryRun`, la réponse porte « REFUSÉ À LA POSE ». `allowBelowReference: true` passe outre. Au-delà de 120 % (`LENGTH_MAX`), simple avertissement. Les écarts de densité (moins de 85 % de la référence), d'empilement (moins de 60 %) et de dessous du lift (moins de la moitié) deviennent des avertissements à la fermeture.
- `coaster_describe` renvoie `target`, et `suggestedBounds.hint` propose `bounds` et `reference` ensemble. `coaster_compare` ajoute à `spaceLevers` les leviers de longueur et de densité.
- Vérifié hors jeu sur les pièces relevées de Night Terror (ride 10) : `target` donne « 150 / 205 (73 %, minimum 185 pour fermer) », et la fermeture aurait été refusée (« circuit trop court »).
- Consigne de construction (instructions du serveur) : laisser de la place des deux côtés du lift, car la seconde moitié passe dessous. Night Terror avait son lift collé au bord de `bounds`, si bien qu'aucun passage dessous n'était possible.

### Reste à faire

- Vérifier en jeu que des croisements refusés par le serveur (« croise le circuit » à 2,5-4 niveaux) le sont aussi par le jeu. Sinon, finir les quarts de tuile (section 4.3, étape 3) : un contrôle trop prudent écarte la piste d'elle-même et empêche la densité de la référence.

## 7 quater. Compacité bloquante (8 octobre 2026)

### Constat

Troisième clone raté de la même façon. « Red Recluse » (style Black Widow, ride 8) a fermé avec 162 tuiles sur 169 (96 %), 31×36 = 1116 tuiles d'emprise contre 322 (3,5 ×), densité 0,15 contre 0,52, 3 tuiles empilées contre 52, 1 tuile sous le lift contre 11. Notes 6,53 / 8,12 / 4,57 contre 6,90 / 8,23 / 4,61 : les notes cachent l'écart, comme pour Night Terror (7 ter) et « Venom Weaver » (1,57 × et 2 empilées). Claude l'a pourtant présenté comme un succès.

Causes côté serveur :

1. La section 7 ter rendait bloquantes la longueur (90 %) et les trains seulement. Densité, empilement et dessous du lift restaient des avertissements à la fermeture : la liste « DENSITÉ / EMPILÉES / DESSOUS DU LIFT » s'affichait dans une réponse où le circuit était déjà posé. Un avertissement de plus au milieu d'une réponse de 4 000 caractères ne change pas ce que l'agent fait.
2. Rien n'interdisait une emprise 3,5 × celle de la référence : `bounds` était facultatif et l'absence de `bounds` n'était qu'un libellé (« aucun »).
3. `coaster_search_section` (P4) existe, mais rien ne la recommandait quand `LONGUEUR` apparaissait : le retour à la station a été routé à la main, par des hills et des virages en U sur le bord de la zone.

### Fait

- `planners/target.ts` : `checkTarget` rend **bloquants**, à la fermeture, quatre écarts de plus : emprise > 1,3 × la référence (`FOOTPRINT_MAX`), densité < 75 % (`DENSITY_MIN`), tuiles empilées < 40 % (`STACKED_MIN`), dessous du lift < 25 % quand la référence en a un (`LIFT_SHARED_MIN`). Avec `dryRun`, la réponse porte « REFUSÉ À LA POSE » ; sans, l'appel échoue. `allowBelowReference: true` passe outre (à n'utiliser que sur demande explicite de l'utilisateur).
- L'avertissement `LONGUEUR` d'un circuit ouvert renvoie à `coaster_search_section` pour la fin du circuit.
- Tests (`test/target.test.ts`) : le circuit court est refusé aussi pour densité, empilement et dessous du lift ; Frightmare lui-même reste accepté.

### Consigne de construction

Un clone ne se présente comme réussi que si `target` montre emprise ≤ 1,3 ×, densité ≥ 75 %, empilement ≥ 40 % et dessous du lift ≥ 25 % de la référence, en plus des notes. Les notes seules ne prouvent rien. `bounds` = `suggestedBounds` dès le premier appel, puis `coaster_search_section` pour la seconde moitié.

## 7 quinquies. Référence gardée, recherche bloquée expliquée (8 octobre 2026)

### Constat

« Black Widow XXL » (Haiku, ride 3 ; demande : plus haut, plus rapide, plus long que Black Widow, 3 trains, compact) a fermé à 54×29 contre 23×14 (4,9 ×), 72 km/h contre 87, 6,09 / 7,12 / 4,06 contre 6,90 / 8,23 / 4,61. Il a des droites de 8, 14 et 9 tuiles, et sa première chute ne descend que de 12 niveaux sur les 17 possibles.

L'enchaînement :

1. Station en (56,110) vers +x, `bounds` x1 = 54. Le premier `coaster_search_section` avec la référence renvoie « 0 éléments essayés ». La cause : l'arrivée imposée (2 brakes + block_brakes derrière la station, pour les trains de la référence) tombait en x 53, hors de `bounds`. `searchSection` le savait (`approachBlocked`), mais l'outil ne le renvoyait pas.
2. L'agent a deviné une autre cause (« un seul train possible ») et a passé `reference: null`. Cela a coupé **toutes** les cibles : longueur, emprise, densité, empilement, dessous du lift et trains (7 ter, 7 quater).
3. La suite a été bâtie à la main. L'agent a élargi `bounds` à chaque refus, et aucun contrôle n'a joué à la fermeture.

### Fait

- `planners/search.ts` : `approachBlocked` nomme la tuile, son niveau et la cause (« (53,110) niveau 7 : hors de bounds (54,102)-(84,119) », « piste », « chemin »…). `approachBrakes` donne le nombre de freins droits imposés.
- `coaster_search_section` : si l'arrivée est bloquée, le résumé le dit (« Recherche impossible : l'arrivée en gare … est bloquée en … »), la réponse porte `approachBlocked`, et `next_hints` dit que ce n'est ni la référence ni le nombre de trains : il faut reculer `bounds` derrière la station ou libérer la tuile. Les autres échecs ne conseillent plus de « relâcher la référence ».
- `coaster_build_plan` et `coaster_search_section` refusent `reference: null` sur un circuit qui garde une référence (`guardReferenceDrop`, `INVALID_PARAMS`), sauf avec `allowBelowReference: true`. Ce paramètre est à réserver au cas où l'utilisateur abandonne la ressemblance. `coaster_search_section` accepte maintenant `allowBelowReference`.
- Test (`test/search.test.ts`) : avec `bounds` qui coupe l'arrivée, la recherche ne tente rien, et `approachBlocked` nomme la tuile hors de `bounds`.

### Consigne de construction

Un échec de recherche se diagnostique par `approachBlocked` et les `warnings`, jamais en retirant la référence. Laisser au moins la longueur du train + 2 tuiles de `bounds` derrière la station.

## 7 sexies. Référence modifiée : plus haut, plus rapide, plus long, plus de trains (8 octobre 2026)

### Constat

La demande « comme Black Widow, mais plus haut, plus rapide, plus long, à 3 trains, compact » ne s'exprimait pas. `reference` imposait les chiffres de la référence, rien de plus. Black Widow ne fait tourner que 2 trains, donc `coaster_search_section` cherchait des fins à 2 trains. Hauteur et vitesse n'étaient pas suivies. Black Widow XXL a fermé avec une première chute de 12 niveaux et 72 km/h contre 87 sans qu'aucun outil ne le signale.

### Fait

- `reference { ride | design, trains?, taller?, faster?, longer? }` dans `coaster_build_plan` et `coaster_search_section` :
  - `trains` : trains au total (au moins ceux de la référence). La fermeture est refusée avec moins de sections de bloc, et la recherche impose l'arrivée en gare et, depuis 7 septies, les freins de bloc de mi-parcours qu'il faut.
  - `taller` : niveaux de plus sur l'écart de hauteur du circuit (niveau max − niveau min, `heightLevels`), donc un lift plus haut ou une chute plus basse.
  - `faster` : km/h de plus sur la vitesse de pointe prédite (`topSpeedKmh`). La référence est simulée avec le modèle et le train **du circuit construit** (`topSpeedOf`), pour comparer la même physique.
  - `longer` : % de piste en plus. L'emprise permise (1,3 × la référence) grandit d'autant, et la densité visée reste celle de la référence.
- `planners/target.ts` : `applyMods` (le nom de la cible porte les modifications), `heightLevels`, `topSpeedKmh` et `mods` dans `ReferenceTarget`. `checkTarget` reçoit la vitesse de pointe du circuit et :
  - avertit, sur un circuit ouvert dont le lift est posé : « HAUTEUR : … » et « VITESSE : … au plus jusqu'ici contre … visés » ;
  - refuse la fermeture si l'écart de hauteur ou la vitesse n'est pas atteint. Ces deux contrôles ne jouent que si `taller` ou `faster` est demandé ; un clone simple n'est pas jugé dessus.
- `coaster_search_section` donne `heightLevels` et `topSpeedKmh` par variante et écarte celles qui manquent l'écart (circuit entier, début compris). Si toutes sont écartées, le résumé dit que le début (lift, première chute) fixe la hauteur et la vitesse, et qu'il faut le refaire.
- Le serveur garde la cible modifiée pour le circuit, comme une référence simple (7 quinquies).
- Tests (`test/target.test.ts`) : Frightmare + 5 niveaux, + 8 km/h, + 10 % et 4 trains refuse Frightmare lui-même (hauteur, vitesse, trains) ; sans modification, ni la hauteur ni la vitesse ne bloquent ; HAUTEUR et VITESSE sur circuit ouvert.

### Consigne de construction

Traduire la demande en modifications dès le premier `coaster_build_plan`. Exemple : `reference: { ride: 4, trains: 3, taller: 4, faster: 8, longer: 15 }`. Ensuite, régler HAUTEUR et VITESSE au lift et à la première chute, avant de chercher la seconde moitié.

## 7 septies. Recherche à 3 trains : le frein de bloc de mi-parcours manquait (8 octobre 2026)

### Constat

Haiku a demandé « Black Widow, mais plus haut, plus rapide, plus long, à 3 trains » (`reference { ride: 3, trains: 3, taller: 4, faster: 13, longer: 15 }`). Il a posé la station (147,128) vers −x, un lift droit de 21 niveaux, puis appelé `coaster_search_section` sur trois sites. Chaque recherche trouvait des centaines de fermetures (189, 452, 461) et n'en gardait aucune, même avec `reference { ride: 3, trains: 3 }` seul. Haiku en a conclu que l'emprise et l'empilement bloquaient, et s'est arrêté.

La vraie cause était un bug. Pour 3 trains, il faut 4 sections de bloc. La station, le sommet du lift et le frein d'arrivée imposé (`approachPieces`) n'en font que 3. Le vocabulaire par défaut n'avait pas de `block_brakes` (la description de l'outil disait le contraire), donc aucune branche ne pouvait créer la 4e section. `tryClose` écartait alors chaque fermeture sur `maxTrains < minTrains`, sans le dire : le résumé comptait les fermetures tentées comme « fermetures ». Le texte de 7 sexies (« la recherche impose l'arrivée en gare et les freins de bloc qu'il faut ») n'était vrai que pour le frein d'arrivée.

Reproduction hors jeu (début de Venom Weaver, même faisceau) : 69 fermetures tentées, 3 variantes à 2 trains, 0 à 3 trains.

### Fait

- `searchSection` calcule `midBlocks` = trains exigés + 1 − sections du début − frein d'arrivée. S'il en manque, le vocabulaire reçoit `blockElements()` : `brakes { length: 1..4 }` ou `straight { length: 2..4 }`, puis `block_brakes`. Le plat ou les freins avant le frein de bloc portent la queue du train arrêté (« FREIN DE BLOC AU SOMMET D'UNE MONTÉE », SPEC 12.8).
- Contraintes dans le faisceau :
  - au plus `midBlocks` freins par branche ;
  - un frein seulement à `minSection` tuiles au moins de la dernière limite de section (sommet du lift, frein précédent). `minSection` = max(2 × train, longueur visée / sections / 2), le seuil de `blockSpacing`. Sans ce seuil, la récompense `W_BLOCK` (20) faisait poser le frein collé au lift, et la fermeture le refusait ensuite ;
  - après un frein de bloc, l'élément suivant doit descendre (`drop`, virage en descente, hélice descendante).
- Contrôles à la fermeture : un frein de bloc manquant est écarté avant l'A*. L'espacement est vérifié sur la longueur réelle (seuil × 0,9). Le circuit entier passe par `blockBrakeRestartWarnings`, via `simulateFrom` que fournit l'outil (`simulate(…, { startPiece })`).
- Diagnostic : `SearchResult.rejected` compte les fermetures écartées par cause (frein de bloc de mi-parcours manquant, fermeture A* introuvable, longueur hors cible, trop peu de sections de bloc, frein de bloc avant le lift, freins de bloc mal espacés, frein de bloc qui ne repart pas, calage, G latéraux > 2,8). Sans variante, l'outil renvoie `rejected`, et le résumé dit « N fermetures tentées, écartées : … ». `midBlocks` est aussi renvoyé, et `next_hints` le rappelle.
- `maxDepth` par défaut : 16, ou une macro par 5 tuiles qui restent à poser (30 au plus). Avec un lift droit de 21 tuiles, 16 macros n'atteignaient jamais la longueur minimale : 0 fermeture tentée au faisceau par défaut.
- Test : `test/search.test.ts`, « pose le frein de bloc de mi-parcours qu'exigent 3 trains ». Il vérifie 3 trains, un frein de mi-parcours suivi d'une descente et aucun avertissement de repartie.

### Résultat sur le site de Haiku (hors jeu, terrain plat, bounds (111,118)-(152,140))

| Faisceau | 2 trains | 3 trains, avant | 3 trains, après |
|---|---|---|---|
| 40 × 16 | 0 fermeture tentée | 0 | 0 (profondeur ; corrigé par le défaut adaptatif) |
| 40 × 29 | 2 variantes | 0 | 0 : A* introuvable 39, longueur 2, repartie 3 |
| 120 × 30 | 3 variantes | 0 (461 tentées) | 3 variantes, 216 tuiles, 39×8, 81 empilées, `lift@28, block@126, block@136` |

Sur ce site long et étroit, il reste à élargir le faisceau (`beamWidth: 120`) pour 3 trains. Le résumé le montre maintenant : les rejets sont dominés par « fermeture A* introuvable ».

Leçon pour qui construit : « 189 fermetures, 0 variante » ne voulait pas dire « référence trop stricte ». Lire `rejected` avant de toucher à la référence ou au site.

## 7 octies. Forme de la première chute et pièces raides (8 octobre 2026)

### Constat

Haiku a construit « Black Widow XXL » (ride 5) avec `reference { ride: 4, trains: 3, taller: 3, faster: 8, longer: 25 }` : lift droit de 20 niveaux, virage incliné à plat de 180° au sommet (`turn { size: large, quarters: 2 }`), puis chute de 16 niveaux à 25°. Black Widow plonge dès le sommet : virage en descente à 25°, puis chute à 60°, 17 niveaux. Le serveur l'a dit, mais seulement par des avertissements (TROP LENT AU SOMMET, 8 km/h dans le virage ; VITESSE 83 km/h contre 93). Ces avertissements ne bloquaient rien sur un circuit ouvert, et Haiku a posé le début quand même. La recherche de la seconde moitié a ensuite échoué (A* introuvable).

La cible de la référence ne mesurait que des quantités (longueur, emprise, densité, empilement, dessous du lift, trains, hauteur, vitesse). Rien ne mesurait la forme : l'ordre des éléments, leur pente, ce qui suit le lift. Un circuit pouvait « tenir » la référence sans lui ressembler.

### Fait

- `firstDrop(table, pieces)` (planners/target.ts) : après la dernière pièce de chaîne du premier lift, `topRun` (tuiles de piste avant la première pièce qui descend), puis la chute jusqu'à la première pièce qui ne descend plus : `height` (niveaux), `steep` (pièces à 60° ou 90°), `complete`. Black Widow : 0 tuile à plat, 17 niveaux, 4 pièces raides.
- `ReferenceTarget.firstDrop` et `steepPieces` (21 pour Black Widow). `taller` ajoute ses niveaux à la hauteur de chute visée.
- `firstDropProblems` refuse le plan dès que la chute est finie, **circuit ouvert compris**, si :
  - SOMMET : `topRun` > celui de la référence + 3 tuiles ;
  - PREMIÈRE CHUTE PAS RAIDE : la référence a des pièces à 60° dans sa chute, le circuit aucune ;
  - PREMIÈRE CHUTE TROP COURTE : moins de 80 % de la hauteur de chute de la référence.
  Seul le plan qui finit la chute est jugé ; une chute déjà posée ne bloque ensuite que la fermeture. `coaster_search_section` refuse de chercher la fin d'un début qui échoue (« Début de circuit refusé »).
- Fermeture refusée sous 50 % des pièces raides de la référence. La recherche reçoit `minSteep`, écarte les fermetures « trop peu de pièces raides » et récompense les pièces raides dans le faisceau (`W_STEEP` = 8 par pièce manquante ; à 2 ou 5, aucune variante sur le début de Venom Weaver).
- `target.firstDrop` (« la tienne / la sienne ») et `target.steepPieces` dans la réponse de `coaster_build_plan`.
- Tests : `test/target.test.ts` (« forme de la première chute » : Black Widow passe, le début de Haiku est refusé sur SOMMET et PAS RAIDE) et `test/search.test.ts` (« minSteep »).

Reste : la forme au-delà de la première chute (ordre des éléments, collines à 60° en milieu de parcours) n'est jugée que par le nombre de pièces raides.

## 7 nonies. Recherche qui ne rentre pas à la station, chemins en travers de l'emprise (8 octobre 2026)

### Constat

Haiku a construit « Black Widow Plus » (ride 5) avec `reference { design: 'Black Widow', taller: 3, longer: 20, faster: 5, trains: 3 }` : station de 6 tuiles en (56,110) vers +x au niveau 7, 2 tuiles plates, lift droit de 20 niveaux, bounds (50,101)-(100,119). Trois `coaster_search_section` (faisceau 60 à 120, `timeMs` jusqu'à 120 s) ont échoué en 7 à 17 s, presque tout en « fermeture A* introuvable ». Haiku a conclu que le site était trop petit et proposé d'acheter du terrain.

Première hypothèse (fausse) : trop peu de place derrière la station pour l'arrivée imposée (6 tuiles). Reproduite hors jeu, sur terrain plat, la recherche ferme avec 6 tuiles, même avec la file d'attente en travers, et échoue parfois avec 15. La place derrière la station n'était pas la cause.

Causes réelles, dans `searchSection` :

1. **Rien ne ramenait le faisceau vers la station.** La note récompensait la longueur sans plafond (`W_TILE × tuiles`) et ignorait la distance à la station. Une fermeture n'est tentée qu'à 14 tuiles au plus de l'arrivée. Avec un faisceau de 120, toutes les branches avaient la longueur voulue à la profondeur 11-12, mais à 21-31 tuiles de la station ; elles erraient jusqu'au plafond de longueur et mouraient (9 fermetures tentées). Un faisceau plus large faisait donc **moins** bien : il laissait les branches qui s'éloignent évincer celles qui rentrent. Le succès dépendait de la largeur, sans ordre (40 fermait, 24, 60, 90, 120 et 160 non).
2. **Une seule passe.** La recherche s'arrêtait à `maxDepth` ou quand le faisceau s'éteignait, en quelques secondes. `timeMs` n'était qu'un plafond : le conseil de l'outil (« augmente timeMs ») ne changeait rien.

Cause secondaire : `coaster_create` raccordait aussitôt entrée et sortie au chemin (`connectToPath: true` par défaut). La file d'attente traversait l'emprise encore vide, du sud de la station au chemin existant (25 tuiles). Déjà noté après Black Widow XXL, mais seulement dans une note de session, que Haiku n'a pas lue. Sur la reproduction, la file réduit les fermetures tentées (37 contre 43) sans à elle seule empêcher de fermer.

### Fait

- Terme de retour dans la note des branches (`rescore`) : `W_HOME` (3) par tuile de distance Manhattan à l'arrivée que la longueur encore à poser (jusqu'à `minTiles`) ne couvre plus ; la longueur ne rapporte plus au-delà de `minTiles`. Une branche dont la longueur + la distance à l'arrivée dépasse `maxTiles` est coupée.
- Passes successives : tant qu'il manque des variantes distinctes et qu'il reste du temps, la recherche repart avec un faisceau doublé (`beamWidth` est la largeur de la première passe, 640 au plus). `SearchResult.passes` les compte. `timeMs` par défaut de l'outil : 90 s (au lieu de 45) pour laisser le temps à une passe plus large.
- `coaster_create` : `connectToPath` vaut `false` par défaut. Entrée et sortie sont gardées en attente (`pendingAccess`, effacé par `forgetRide`) et raccordées quand `coaster_build_plan` ou `coaster_append` ferme le circuit, en contournant d'abord l'emprise de la piste (`connectEntrances { footprint }`, comme `coaster_place_design`). La réponse donne `connections` ; un raccord manqué ajoute un avertissement (path_build). Le raccord est une entrée de journal à part (undo_last).
- Tests : `test/search-home.test.ts` (faisceau 90 : aucune variante avant, une après) et `test/search.test.ts` (« élargit le faisceau » : la passe à 25 échoue, celle à 50 ferme). Site commun : `test/black-widow-plus.ts`. Les deux fichiers rendent la main entre deux tests (`beforeEach` + `setTimeout`) : sans cela, les recherches de 30-50 s à la suite faisaient expirer le RPC de vitest (onTaskUpdate).

### Résultat sur le site de Haiku (hors jeu, terrain plat, bounds (41,101)-(100,119), 183-240 tuiles, 3 trains, 11 pièces raides, profondeur 30)

| Faisceau (une passe) | avant | retour seul |
|---|---|---|
| 24 | 0 (37 tentées) | 0 (243) |
| 40 | 1 | 0 (410) |
| 60 | 0 (52) | 0 (672) |
| 90 | 0 (9) | 1 (1035) |
| 120 | 0 (9) | 1 (1465) |
| 160 | 0 (16) | 1 (1796) |

Avec les passes : départ à 25, variante à la 2e passe (27 s) ; départ à 40 (défaut), 3 variantes à la 3e passe (60 s). Les fermetures tentées croissent maintenant avec la largeur. Reste : 70 % des rejets sont encore « fermeture A* introuvable » (A* limité à 16 pièces et 4000 expansions), et le résultat reste sensible à la largeur d'une passe à l'autre.

Pas encore testé en jeu.

## 7 decies. Impasse au bout du début, inversions par type de piste (8 octobre 2026)

### Constat

Haiku a voulu « Black Widow, plus rapide, plus long, plus haut, 3 trains, avec une boucle verticale ». Deux erreurs :

1. **Type de piste.** Haiku a quitté le bois pour `looping_roller_coaster` (`rct2.ride.scht1`), en écrivant que le bois n'a pas de boucle verticale. C'est faux : `wooden_roller_coaster` a `verticalLoop`, `halfLoopMedium` et `halfLoopLarge` (`WoodenRollerCoaster.h`), soit `loop(small/medium/large)`. Le parc avait déjà une « Black Mamba Loop » en bois. `coaster_describe` de Black Widow renvoyait bien `inversionsAvailable: ["loop(small/medium/large)"]`, mais en fin de réponse, après 6,5 Ko de JSON. Le looping, lui, n'a ni chaîne raide ni grand virage incliné, et seulement la petite boucle.
2. **Impasse.** Station (57,134) vers +x, lift de 21 niveaux, chute raide de 20 jusqu'en (102,134) niveau 8. En x = 102, y 126-134, une file d'attente court au sol. Aucune pièce ne peut partir du bout de la chute. `coaster_search_section` a essayé 228 éléments sans une fermeture, trois fois (faisceau 120 à 200, bounds élargi jusqu'à x = 118), et conseillait « élargis bounds, augmente timeMs ou beamWidth ». Il aurait fallu retirer la chute (`coaster_undo`) et la refaire ailleurs.

### Fait

- `exitProblem` (track.ts) : depuis le bout d'un circuit ouvert, essaie une droite, une montée et des virages small et medium des deux côtés. Si aucun ne passe, il renvoie l'obstacle le plus fréquent (« (102,134) niveau 8 : file d'attente »). `blockProblem` distingue maintenant file d'attente et chemin.
- `searchSection` s'arrête tout de suite sur `exitBlocked`, avant le faisceau. `coaster_search_section` le renvoie dans le résumé et dans `exitBlocked`. Le conseil n'accuse plus bounds ni la référence : `coaster_undo { count }` des pièces qui suivent le sommet du lift (la chute), puis refaire l'élément pour qu'il débouche sur des tuiles libres, ou `path_remove`.
- `coaster_build_plan` avec `close: false` (dryRun compris) refuse un plan qui finit dans une impasse (OBSTRUCTED, `details.exitBlocked`). C'est un refus, pas un avertissement : les petits modèles ignorent les avertissements (7 octies).
- Inversions par type de piste plus visibles : le résumé de `coaster_describe` les cite (« inutile de changer de type pour celles-ci »), `list_objects` donne `inversions` pour chaque montagne russe, et les consignes du serveur disent que le bois a la boucle verticale.
- Test : `test/exit-blocked.test.ts` (site de Haiku : la file d'attente est nommée, la recherche fait 0 expansion ; le bois a `loop(small/medium/large)`).

Pas encore testé en jeu.

## 7 undecies. Boucle verticale qui cale, recherche qui l'abandonne (8 octobre 2026)

### Constat

« Black Widow Apex » de Haiku (ride 9) : même demande que 7 decies (3 trains, boucle verticale). Le début (lift 23, chute raide jusqu'à 95 km/h) est posé, puis Haiku renonce : « la boucle ne rentre pas ». Trois causes, aucune liée à la place :

1. **Taille par défaut.** `inversion{kind:'loop'}` sans `size` prend la plus grande (large). Avec le train de bois réel, le simulateur exact fait caler la boucle large même à 80 km/h, et la medium sous ~80 km/h. La boucle des designs RCT2 en bois (Great White Wail, Ricochet) est `leftVerticalLoop`/`rightVerticalLoop`, soit `size: 'small'`, abordée à 68-71 km/h. Après `block_brakes` (repartie à ~7 km/h), une descente raide de 8 niveaux suffit pour la passer.
2. **Consigne des freins.** Haiku a écrit `brakes{speed: 6}` en croyant viser 68 km/h. C'est une consigne du jeu : sortie ≈ consigne × 3,6 km/h, donc ≈ 22 km/h. Le train sortait des freins à 68 km/h (la queue y était encore), tombait à 19 km/h dans le virage et calait dans la boucle. Le paramètre n'avait aucune description.
3. **Recherche.** `coaster_search_section { inversions: true }` ajoutait chaque inversion sans taille, donc la large : toutes les branches avec boucle calaient et étaient coupées en silence. Rien n'exigeait non plus d'inversion, et la seule variante rendue n'en avait pas. Avec un vocabulaire imposé (boucles medium), aucune variante.

### Fait

- `defaultVocabulary({ inversions })` (search.ts) ajoute chaque inversion en `small`, `medium` et `large`. Les tailles absentes du type sont écartées à la compilation.
- `searchSection { minInversions }` : inversions du circuit fermé, préfixe compris. Elles sont récompensées dans le faisceau (`W_INV` 20, comme un frein de bloc manquant), et la fermeture est refusée en dessous (`rejected` : « trop peu d'inversions »). `coaster_search_section { minInversions }` vaut par défaut les inversions de la référence et implique `inversions: true`. Il est refusé si le type n'a aucune inversion.
- `brakes.speed` décrit sa conversion (6 → 22 km/h, 18 → 65 km/h, 24 → 87 km/h). La consigne de `inversion` dit que la plus grande taille demande le plus d'élan et donne la boucle small comme celle des designs en bois.
- CALAGE dans une inversion qui n'est pas `small` : le message conseille la taille au-dessous (`smallerInversion`, coasters.ts).
- Test `test/search-loop.test.ts`. Après bloc + 8 niveaux raides, la boucle small passe et les boucles medium et large calent. Le vocabulaire contient les trois tailles. Black Widow Plus (lift 20, chute 20) avec `minInversions: 1` et 3 trains donne une variante en 100 s.

Pas encore testé en jeu.

## 7 duodecies. Frein de bloc condamné qui envahit le faisceau (8 octobre 2026)

### Constat

Haiku n'a fermé aucun circuit pour « Black Widow Loop » (ride 9) : station de 6 tuiles en (18,66) vers +x, lift de 16, chute raide de 14, `reference { ride: 4, trains: 3 }`, une boucle, bounds (12,56)-(55,72). Sur quatre recherches, aucune variante : « fermeture A* introuvable » et « frein de bloc qui ne repart pas ». Haiku en a conclu que l'emprise libre était trop serrée. Elle ne l'était pas. Les mesures d'espace (emprise, couverture, densité, empilement) ne comptent que les pièces du circuit lui-même, et les autres attractions ne bloquent que les blocs qu'elles occupent vraiment (`otherRideClash`).

Reproduction hors jeu (terrain plat, même début), puis diagnostic :
- Les fermetures A* échouées ne venaient pas d'un manque de place. Avec un budget A* plus large (25 000 expansions au lieu de 4 000), la moitié aboutissait en 16 pièces au plus.
- Avec ce budget, 493 fermetures sur 745 tombaient sur « frein de bloc qui ne repart pas », toutes pour le **même** frein de mi-parcours en (43,70). Il était suivi d'une montée où le train, relâché à 7 km/h, calait. La repartie n'était contrôlée qu'à la fermeture. Le faisceau gardait donc des centaines de descendantes de cette branche condamnée, qui en chassaient les autres.

### Fait

- Dans le faisceau, chaque branche retient l'indice de son dernier frein de bloc de mi-parcours (`Branch.blockAt`). À chaque élément posé dans la fenêtre de repartie (`RESTART_WINDOW`, 40 pièces), `blockBrakeRestartWarnings` est rejoué sur le frein et les pièces qui le suivent, avec `TAIL_CONTEXT` pièces avant lui. Une branche qui cale est écartée tout de suite : un calage ne disparaît pas avec les pièces suivantes.
- Budget A* inchangé (4 000) : avec ce contrôle, 12 000 ne donne pas plus de variantes.
- Test : `test/search-block-restart.test.ts`.

### Résultat (hors jeu, faisceau 80, profondeur 30)

| | Fermetures tentées | Variantes | Rejets principaux |
|---|---|---|---|
| Avant, 30 s | 917 | 0 | A* introuvable 752, repartie 165 |
| Après, 16 s | 592 | 3 (8 avec `results: 8`) | A* introuvable 466, calage 56 |

Le test « élargit le faisceau » de `search.test.ts` passe de la largeur 25 à 8 : à 25, la première passe ferme maintenant.

Leçon pour qui construit : « aucune fermeture » sur un site assez grand pour la référence est un défaut du serveur, pas une raison de changer de site.

## 7 terdecies. Choix du site : le lac jamais pris (8 octobre 2026)

### Constat

Dans toutes les tentatives « Black Widow » de Haiku (7 octies à 7 duodecies, mémoire « Black Widow Apex XL »), le site est choisi à l'œil sur get_region_map : bandes de 17 à 30 tuiles coincées entre Midnight Maw, Black Mamba Loop, des files d'attente et le relief. La moitié des échecs (impasse, A* introuvable, chute sous le terrain) en découlent. Pendant ce temps, le lac de Six Flags (x 50-96, y 62-101, environ 46×40) est le plus grand espace libre de la carte. Haiku ne l'a jamais envisagé : la carte texte le montre en `~`, que rien ne présente comme constructible. Pourtant le jeu pose la piste au-dessus de l'eau (TrackPlaceAction refuse seulement sous la surface, comme `blockProblem` via `groundTopZ`), l'eau est plate, et la proximité de l'eau compte dans l'excitation (`waterOver`, `waterTouch`). Les consignes disaient « choisis une zone libre de cette taille » sans outil derrière.

### Fait

- `planners/site.ts` (`findSites`) : sur toute la carte, rectangles de w×h et h×w dont les tuiles sont libres (ni chemin, ni attraction, ni entrée, ni grande scénerie, possédées hors sandbox ; tolérance 0,5 %). Sommes cumulées pour les obstacles et l'eau. Note : 100 + 30 × part d'eau − 3 × relief au-delà de 2 niveaux − 8 × obstacles − ½ coût de station. Les rectangles retenus se chevauchent à 25 % au plus.
- Station proposée : sur un grand bord, une rangée à l'intérieur (la rangée du bord reçoit entrée et sortie), dans le sens du grand côté, partant au quart du côté (arrivée derrière, au moins 15 tuiles devant). Le flanc est pris de préférence sur la terre ferme, car la file ne se pose pas sur l'eau, et près d'un chemin. Niveau = sol ou eau le plus haut sous la station et son flanc.
- Outil `coaster_find_site { reference: { ride | design, longer, taller } | w, h, stationLength, area, results }`. La taille vient de `suggestedBounds` de la référence, côtés × √(1 + longer), et le grand côté reçoit `taller` tuiles de plus. Si rien ne tient, la taille est réduite par pas de 10 % jusqu'à 70 %, et le résumé le dit. L'outil renvoie bounds et les arguments de coaster_create.
- Consignes du serveur : coaster_find_site avant coaster_create (« ne choisis pas le site à l'œil »). Le conseil d'échec de coaster_search_section renvoie vers lui quand bounds ne peut pas grandir.
- Test `test/site.test.ts` : carte encombrée avec un lac, le lac est choisi et la station posée sur la rive.

Pas encore testé en jeu.

## 7 quattuordecies. Emprise d'une référence modifiée (8 octobre 2026)

### Constat

Tentative 5 de « Black Widow Loop » (Haiku ; Black Widow +3 niveaux, +8 km/h, +25 %, 3 trains). Pour atteindre 95 km/h, il a fallu un lift et une chute de 23 niveaux au lieu de 17. Le lift occupe à lui seul 23 tuiles sur un axe, et le retour en gare traverse lift et station (≈ 36 tuiles). `applyMods` n'agrandissait l'emprise permise que par `longer` (× 1,25 → 403, plafond 1,3 × = 523), avec la densité de la référence (minimum 0,39). Une boucle de 218 tuiles sur 37×23 = 851 était refusée, et aucune recherche ne pouvait réussir : les seuils de compacité ignoraient `taller`, `faster` et `trains`. `coaster_find_site` utilisait une autre formule (grand côté × √k + taller).

### Fait

- `grownFootprint` (target.ts), seule formule pour la cible et pour coaster_find_site. Côtés × √k (longer). Grand côté + 1,5 tuile par niveau de chute en plus (1 de lift à 25°, ½ de chute raide). Petit côté × (hauteur visée / hauteur de la référence), car les virages s'élargissent comme v² à G latéraux égaux. + 10 % au petit côté par train au-delà de la référence (frein de bloc à plat puis descente). Niveaux en plus = max(taller, hauteur × (((v + faster) / v)² − 1)), avec v simulé, ou 21 × √hauteur à défaut.
- `applyMods` : emprise permise et densité visée en découlent (densité × k / croissance de l'aire). Avec longer seul, rien ne change (× k, densité inchangée).
- `allowedSpace` : à la fermeture, si taller ou faster et que la première chute posée est plus haute que l'estimation, l'emprise se recalcule sur la chute réelle. Plafond : 2 × l'estimation + 3 niveaux. Utilisé par `checkTarget`, qui affiche `target.footprint` (emprise / permise).
- coaster_find_site accepte `faster` et `trains`.
- Black Widow, modifications ci-dessus : a priori 31×21, densité 0,33 ; avec la chute réelle de 23 niveaux, plafond 1 051 tuiles et densité minimale 0,20. Le circuit refusé passe ; empilement (≥ 40 %) et dessous du lift (≥ 25 %) restent exigés. Test `test/target.test.ts`.

Pas encore testé en jeu.

## 7 quindecies. Place d'entrée dans l'arrivée en gare (9 octobre 2026)

### Constat

« Black Widow Vortex XL » (Haiku ; mêmes modifications, tracé différent) : station en (80,98) vers −y, à 4 tuiles du bord sud de bounds (y2 = 102 ; le site de coaster_find_site avait sa station ailleurs, 9 tuiles devant le bord). Pour 3 trains, l'arrivée imposée (2 brakes + block_brakes) occupe (80,99)–(80,101). La dernière pièce de la fermeture doit entrer en (80,101) depuis (80,102), et la pièce d'avant depuis y ≥ 103, hors de bounds. Aucune fermeture n'était donc possible. Trois recherches de 120 s ont donné 5 000 « fermeture A* introuvable », et le conseil « élargis bounds » a été suivi vers l'est et le nord, jamais au sud. Les rangées y 99–104 étaient libres (Black Widow Max commence en y 105). Le contrôle `approachBlocked` ne vérifiait que les pièces d'arrivée, pas la place pour y entrer.

### Fait

- `leadInProblem` (track.ts) est le pendant d'`exitProblem` côté gare. Il cherche à rebours au plus 3 pièces du catalogue de fermeture qui finissent à l'entrée de l'arrivée, dans bounds, sur un terrain libre et hors du circuit. Sinon il renvoie l'obstacle le plus fréquent.
- `arrivalFor` (search.ts) regroupe l'arrivée imposée par les trains et sa place. searchSection s'arrête avant le faisceau (`approachBlocked` : « entrée de l'arrivée en (80,101) : aucune pièce n'y mène, (80,103) … hors de bounds »). coaster_build_plan refuse un plan ouvert (OBSTRUCTED) avant de poser le début, avec le même conseil : reculer bounds derrière la station (freins + 3 tuiles) ou déplacer la station.
- Hors jeu, sur le même début et le même site (terrain plat), y2 = 104 suffit : 1 variante (boucle, 3 trains) en ~27 s. Test `test/search-lead-in.test.ts`.

Pas encore testé en jeu.

## 7 sexdecies. Frein de bloc du début non contrôlé par la recherche (9 octobre 2026)

### Constat

« Black Widow Sidewinder » refait sans virage au sommet (Haiku) : la chute droite finissait au sol en (100,102), à 3 tuiles de Black Widow Max, entre deux chemins (x 101, y 96). Recherche : 150 fermetures, 119 « A* introuvable », 31 calages, aucune variante. Corrigé à la main : chute arrêtée au niveau 14 puis virage large incliné vers l'est, au-dessus des chemins. Le frein de bloc de mi-parcours a ensuite été posé dans le début (niveau 10, 3 au-dessus du sol). midBlocks valait alors 0 et `midBlockProblem` n'était plus appelé. La recherche a proposé une fin qui calait à 3 trains sur la colline suivante. Seul coaster_build_plan l'a signalé (FREIN DE BLOC AVANT UNE MONTÉE).

### Fait

- searchSection contrôle la repartie (`blockBrakeRestartWarnings`) dès que le début contient un frein de bloc, pas seulement quand elle en pose un. Une variante qui cale est rejetée (« frein de bloc qui ne repart pas » dans `rejected`).
- Test `test/search-prefix-block.test.ts` (échoue sans la correction).

Testé en jeu (ride 10, fin cherchée avec le frein de bloc posé par la recherche) : 7,56 / 9,09 / 5,13, 1 009 m, 82 km/h, 3 trains, ni calage ni accident.

## 7 septdecies. Repli quand le bout du circuit est une poche (9 octobre 2026)

### Constat

Même « Black Widow Sidewinder » (7 sexdecies). La première chute droite de Haiku finissait au sol en (100,102). La poche libre au niveau 7 faisait ~40 tuiles : chemins en x 101 et y 96, Black Widow Max en y 105. Il restait ~150 tuiles de piste à poser. `exitProblem` ne voyait rien, puisqu'un virage à gauche passait. La recherche concluait « A* introuvable » et conseillait d'élargir bounds, ce qui ne pouvait pas aider. La sortie de la poche, trouvée à la main : retirer la chute (10 pièces après le sommet du lift), la refaire moins haute pour finir au-dessus des chemins, puis tourner vers la zone libre. Un petit modèle ne fait pas ce raisonnement spatial.

### Fait

- `retreatOptions` (planners/backtrack.ts) : coupes sur une pose plate et droite, jamais dans le lift, au plus 40 pièces et 3 coupes. Si la coupe retire la première chute, la relance est `drop { height, steep }` de 3 en 3 niveaux sous la hauteur posée, jusqu'à `dropMin` (80 % de la chute de la référence, sinon 60 % de la sienne). Sinon la fin est cherchée depuis la coupe. Chaque relance est vérifiée : circuit gardé, terrain, chemins, attractions, bounds. Une relance qui viole `firstDropProblems` est écartée.
- coaster_search_section `backtrack` (vrai par défaut) : 40 % de timeMs pour le bout actuel. Sans variante (impasse comprise, sauf arrivée en gare bloquée ou chute trop petite pour les modifications), les replis sont essayés en deux tours : une courte part chacun, puis le reste pour ceux arrêtés par le temps. Une hauteur sans issue peut épuiser son faisceau lentement : 27 s hors jeu pour 20 niveaux, contre 3,7 s pour 17 qui réussit. La réponse dit « REPLI NÉCESSAIRE » dans summary, avec `undo`, `retreat` et des variantes dont le plan commence par la nouvelle chute. next_hints : coaster_undo { count } puis coaster_build_plan.
- `roomAhead` : tuiles libres atteignables au niveau du bout (remplissage 4-connexe, mêmes obstacles que `blockProblem`, circuit et bounds). coaster_build_plan close: false ajoute l'avertissement POCHE, dans summary et en tête des warnings, sous max(30, 50 % de la piste qui reste).
- Consignes du serveur (server.ts) : POCHE et REPLI NÉCESSAIRE, appliquer undo puis le plan, ne pas élargir bounds. Le conseil d'impasse ne propose plus de « virage au sommet » (virage incliné au pas, refusé).
- Test `test/backtrack.test.ts` : même site hors jeu, 198 à 262 tuiles, 3 trains, une boucle. Aucune fin depuis la poche ; `roomAhead` < 60 au sol, et plein au niveau 14 ; replis sans toucher le lift ; une relance (chute de 17) referme avec 3 trains.

Pas encore testé en jeu par Haiku.

## 8. Verticalité (relief)

> Ajouté le 8 octobre 2026, à la demande de l'utilisateur, après le second essai compact de Nightmare Frenzy (7,37 / 8,06 / 4,23 sur 24×19, `nf-compact-2`).

### 8.1 Constat

La première inversion de Frightmare est une grande demi-boucle, puis un quart de boucle qui plonge à la verticale, un virage d'1 tuile à 90° sur cette verticale, et la ressource. Le circuit remonte aussitôt à la verticale, passe sur le dos par un quart de boucle et sort en tire-bouchon. Le circuit généré commence lui aussi par une grande boucle, mais tout ce qui suit reste entre −7 et +5 niveaux : il paraît plat.

| | Frightmare | Nightmare Frenzy (`nf-compact-2`) |
|---|---|---|
| Pièces à 90° / à 60° | **6** / 7 | **0** / 8 |
| Pièces qui passent ou restent à l'envers | 10 | 8 |
| Éléments hauts (écart de hauteur ≥ 8 niveaux) | **8** | **1** |
| Point haut par cinquième du parcours (niveaux / station) | 17 / **16 / 9** / 5 / 0 | 17 / **11 / 5** / 7 / 3 |
| Montée totale sur l'élan, hors chaîne | 75 niveaux | 64 niveaux |
| Hauteur moyenne au-dessus du point bas | 7,6 | 7,5 |

La hauteur moyenne ne distingue pas les deux circuits. Ce qui compte : Frightmare reconvertit sa vitesse en hauteur, à la verticale et au-dessus de la station, dans les deux premiers cinquièmes.

### 8.2 Pourquoi le serveur ne le voyait pas

1. `coaster_describe` donnait la séquence des pièces avec leurs hauteurs, mais aucune mesure de relief. `coaster_compare` comparait notes, vitesses et G, pas les hauteurs : un circuit plat à 0,03 d'excitation de la référence passait pour réussi.
2. Les macros ne savaient pas poser de verticale. `inversion` ne propose que des inversions complètes de pièces à 25° ou à plat. Les pièces de Frightmare (`invertedFlatToDown90QuarterLoop`, `up90ToInvertedFlatQuarterLoop`, `quarterTurn1TileDown90`…) n'étaient accessibles que par `piece`, une à une.
3. La recherche de section (prototype hors serveur) ne notait que l'empilement, la couverture et les inversions. Elle choisissait donc des hélices et des virages au ras du sol.

### 8.3 Ce qui est fait (8 octobre 2026)

- **Mesure** : `reliefProfile` (`planners/space.ts`) donne les pièces à 60° et à 90°, les pièces à l'envers, la montée totale sur l'élan, la hauteur moyenne, le point haut par cinquième du parcours et l'écart de hauteur de chaque élément. `reliefLevers` rédige les écarts à la référence (« pièces verticales (90°) 0 contre 6 dans la référence : dive, quarter_loop ou vertical_drop », « 2e cinquième du parcours : point haut L11 contre L16… »). `coaster_describe` renvoie `relief`, et `coaster_compare` renvoie `relief` côte à côte et `reliefLevers`.
- **Macros** (`planners/track.ts`) :
  - `dive{dir, size?, height?, turn?}` : demi-boucle montante (grande par défaut), `invertedFlatToDown90QuarterLoop`, verticale descendante (`height`, 2 niveaux par `down90`), virage d'1 tuile à 90° si `turn`, `down90ToDown60` et ressource.
  - `quarter_loop{exit, dir, height?, turn?}` : montée jusqu'à 90° (transitions automatiques), verticale (`height`, 2 par défaut), virage d'1 tuile à 90° si `turn`, `up90ToInvertedFlatQuarterLoop`, puis une sortie qui commence à l'envers : `corkscrew`, `large_corkscrew`, `half_loop`, `medium_half_loop`, `large_half_loop`, `barrel_roll`, `zero_g_roll` ou `dive` (quart de boucle vers la verticale descendante).
  - `vertical_drop{height, turn?}` : `height` est la chute totale, entrée à 60° et ressource comprises (18 niveaux au moins depuis le plat).
  - Vérifié : depuis la pose de Frightmare avant sa première inversion, `piece flatToUp25`, `piece up25`, `dive{right, turn: right}` et `quarter_loop{corkscrew, right}` redonnent ses 12 pièces, aux mêmes positions.
- Tests : `test/vertical.test.ts` (reproduction de Frightmare, chaque sortie de `quarter_loop`, hauteur de `vertical_drop`, relief et leviers de Frightmare).

### 8.4 Premier essai en jeu (8 octobre 2026)

Nightmare Frenzy refait avec `dive` puis `quarter_loop` (sortie en tire-bouchon), comme la première moitié de Frightmare. La seconde moitié vient d'une recherche hors serveur (prototype de l'étape 5) avec ces macros, un objectif de relief et un garde-fou de G latéraux. Checkpoint `nf-vertical-3`.

| | Frightmare | `nf-compact-2` (plat) | `nf-vertical-3` |
|---|---|---|---|
| Notes | 7,40 / 7,82 / 4,63 | 7,37 / 8,06 / 4,23 | **7,26** / 8,42 / 4,38 |
| Emprise | 24×17 | 24×19 | **24×17** |
| Pièces à 90° / éléments hauts | 6 / 8 | 0 / 1 | **8 / 9** |
| Point haut par cinquième | 17/16/9/5/0 | 17/11/5/7/3 | 17/16,5/12/12/12 |
| Couverture / empilées / vide | 45 % / 80 / 16 % | 46 % / 40 / 9 % | 43 % / 41 / 29 % |
| Inversions / chutes | 5 / 6 | 5 / 11 | 6 / 7 |

`reliefLevers` est vide. Restent hors critère : l'intensité (8,42, demi-boucle finale prise à 88 km/h, 4,25 G) et le vide de 9×13 à droite de l'emprise. Leçons de l'essai :

- **G latéraux.** Une fermeture A* a posé deux virages de 3 tuiles non inclinés à 78 km/h. Résultat : 3,58 G latéraux, pénalité d'intensité, excitation 2,23. Le serveur l'avait signalé (« virage non incliné à grande vitesse »). La recherche de section (étape 5) doit rejeter ces virages, pas seulement avertir.
- **Fenêtres sans données.** Les pièces de quart de boucle n'apparaissent que dans 3 ou 4 designs RCT2, et le modèle les y fait passer presque à l'arrêt (fenêtre « 1-1 km/h »). Les fenêtres tirées de moins de 5 occurrences sont désormais ignorées.
- **Entrée et sortie de la station.** Le prototype hors serveur ignorait leurs tuiles et a fait refuser un plan. La recherche du serveur doit lire le cache de carte comme `blockProblem`.

### 8.5 Reste à faire

| Étape | Contenu | Validation |
|---|---|---|
| V1 | Vérifier en jeu les trois macros (`dryRun` puis pose), et que le modèle de vitesse passe les sommets de quart de boucle (fenêtre `quarterLoop` relevée sur les designs RCT2) | `coaster_build_plan` sur un circuit d'essai, puis `coaster_test` |
| V2 | Nightmare Frenzy : remplacer la grande boucle et la suite plate de la première moitié par `dive` puis `quarter_loop`, comme Frightmare, puis refaire la seconde moitié | `coaster_compare` : `reliefLevers` vides ou presque, critère de la section 6 |
| V3 | `coaster_search_section` (étape 5) : vocabulaire avec `dive`, `quarter_loop` et `vertical_drop`, et un objectif de relief (point haut par cinquième, éléments hauts) en plus de l'empilement | fermeture d'une seconde moitié qui remonte au-dessus de la station |

