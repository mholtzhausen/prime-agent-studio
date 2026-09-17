# Développement et fonctionnement

[English](en/development.md) · **Français** · [← Retour au README](../README.fr.md)

## Installation et développement

Prérequis : **Node.js 22.8 ou ultérieur** et **Prime Agent 0.9.2** installé. Configurez un fournisseur avant le premier message, dans Prime Agent ou dans le panneau local **Fournisseurs**. Cette version du Studio et son adaptateur de sous-agents sont validés avec **0.9.2**. Le GUI réutilise les comptes existants sans redemander leurs clés.

```sh
npm ci
npm start
```

Il n’y a pas d’étape de compilation. Les bibliothèques Markdown sont servies localement depuis `node_modules`, sans CDN. `npm start` / `make dev` gardent le serveur dans votre terminal ; utilisez `scripts/start-studio.sh` ou `make start-silent` pour un démarrage en arrière-plan qui réutilise une instance déjà ouverte et lance le navigateur.

Dans **Un projet à explorer.**, **Choisir un dossier** ouvre le sélecteur de dossier Linux (`zenity`, ou `kdialog` si zenity est absent) et remplit le chemin, sans ajouter le projet avant validation. Ce sélecteur est réservé au Studio local sous Linux. `npm run test:folders` vérifie la sélection, l’annulation, les erreurs et les réponses tardives. Les tests d’interface navigateur privilégient Chrome/Chromium sous Linux ; définissez `PRIME_STUDIO_TEST_BROWSER` pour remplacer le canal Playwright.

Le Studio ne provisionne pas Python, n’exécute pas `uv`, ne gère pas `.local/kernel-venv/` et n’injecte pas `runtime/kernel-loader.mjs` pour préparer un noyau. **Prime Agent** amorce lui-même les skills Python. Les hôtes avancés peuvent définir `PRIME_AGENT_KERNEL_PYTHON` comme remplacement d’environnement Prime Agent ; le Studio n’y installe rien. Voir la [documentation native](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/skills.md#python-backed-skills).

`lib/kernel.mjs` expose encore les helpers `localKernelPython` et `execute` pour la découverte des probes MCP et l’exécution de processus lorsqu’un marqueur ou un interpréteur PATH est disponible. `npm run setup:runtime` / `make setup-runtime` est un reste sans effet. `test/kernel.test.mjs` couvre les helpers hérités `ensureLocalKernel` s’ils sont encore présents. `test:subagents:native` comprend aussi `scripts/test-kernel-messaging-native.mjs` : fournisseur simulé sur localhost, vrais kernels appartenant à Prime Agent, messages explicites dans les deux sens vérifiés dans les historiques **et** les contextes des modèles, puis reprise du même parent après arrêt du moteur. Une notification de fin d’enfant ne satisfait pas ce test.

## Sessions longues et synchronisation

`runtime/transport-loader.mjs` adapte en mémoire le transport OpenAI Codex du moteur lancé par le Studio. Les [connexions WebSocket OpenAI sont limitées à 60 minutes](https://developers.openai.com/api/docs/guides/websocket-mode). Une connexion inactive de plus de 50 minutes est renouvelée avant la requête suivante ; le cache de réponse précédent est abandonné et le moteur renvoie le contexte complet. Une requête occupée n’est jamais coupée par cet adaptateur. Les reprises restent celles de Prime Agent : le Studio ne rejoue pas lui-même les messages ou les outils. Une erreur suivie d’une reprise native réussie ne laisse plus l’exécution en échec. D’autres coupures réseau restent possibles. `test/transport.test.mjs` exerce les deux modules réellement installés avec une horloge accélérée, sans remplacer un essai réel d’une heure.

L’ordre des projets et les marqueurs de lecture partagés sont conservés dans `workspace.json`, sans modifier les historiques natifs. Les accusés de lecture désignent un identifiant de réponse précis, progressent uniquement sur la branche courante et sont autorisés aux appareils authentifiés en consultation. Les révisions de lecture et la fraîcheur des historiques sont traitées séparément pour supporter les réponses HTTP retardées. `npm run test:activity` vérifie deux navigateurs à stockages indépendants ; `npm run test:stability` couvre les cartes, les files protégées et l’ordre persistant sur PC/mobile. `node scripts/fixtures/session-stability.mjs` lance leur aperçu synthétique isolé.

## Modèle de processus

La gestion des fournisseurs utilise `lib/provider-service.mjs` et un processus d’arrière-plan `scripts/provider-auth-worker.mjs`. `lib/provider-auth.mjs` charge le catalogue et les flux OAuth natifs sans extension de projet. Les clés passent par stdin ; seules les informations d’affichage et les étapes de connexion reviennent au navigateur. Les écritures utilisent `FileAuthStorageBackend` et `AuthStorage`, avec une révision du fournisseur vérifiée sous verrou. La fermeture d’un parcours n’arrête que son processus de connexion. Les routes `/api/providers` et leurs sous-routes ne figurent pas dans la liste d’accès de la passerelle distante. Le panneau Fournisseurs peut activer la préférence Studio `includeExtensionProviders` ; une fois activée, `scripts/model-catalog-worker.mjs` exécute aussi `discoverAndLoadExtensions` pour `~/.prime/agent/extensions` et enregistre les fournisseurs en attente dans le sélecteur de modèles (toujours isolé ; les passerelles distantes ne gèrent pas cette surface).

`npm run test:providers` vérifie l’ajout et le retrait de clés dans un stockage natif temporaire, l’actualisation des modèles, le parcours OAuth simulé, la conservation du brouillon et le refus des routes sur mobile et PC distant. `test/providers.test.mjs` couvre les verrous, conflits, clés invalides, commandes de secrets non exécutées, annulations et délais OAuth. Aucun compte personnel n’est connecté ou déconnecté par ces tests.

Le serveur appelle directement le fichier JavaScript du CLI avec Node.

Le Studio démarre son propre superviseur Prime Agent en arrière-plan, sur une adresse de communication privée. Il ne réutilise pas le superviseur d’un terminal externe. À partir de prime-agent 0.9.5, le processus lancé peut créer un enfant superviseur ; le Studio l’accepte lorsque `daemon_hello` annonce la socket privée du Studio. Les demandes partagent ce moteur, mais chacune garde son client : **Arrêter** demande au client concerné de fermer proprement sa session et ses sous-agents. L’arrêt forcé de son processus reste un recours si le client ne répond plus.

Préférences → Système valide le moteur avec `scripts/component-probe.mjs`. Les échecs du probe renvoient `{ error, check, detail }` structurés pour qu’une dérive d’API apparaisse comme `engine_incompatible` (export nommé), et non comme une erreur de chemin générique.

Le chargeur local `runtime/headless-loader.mjs` active l’attente native de fin des sous-agents avant que le client JSON ferme sa session. La réponse du parent ne coupe donc pas les tâches qu’il vient de déléguer. Les exécutions interactives utilisent `runtime/studio-rpc-loader.mjs` pour exposer `studio_wait_for_completion` sur la boucle RPC. À partir de prime-agent 0.9.5, l’entrée npm `dist/bundle/cli.js` peut transmettre l’exécution à un binaire natif compilé (en perdant les `--import` / `--require` Node). Les exécutions interactives et headless du Studio démarrent donc `dist/bundle/cli-node.js` via `resolvePrimeAgentNodeEntry` pour conserver les correctifs en mémoire. Si un pont Node→Node réexécute encore le processus, les deux chargeurs conservent `PRIME_GUI_CLI_ROOT` jusqu’à cette entrée réelle. Les changements s’appliquent uniquement au mode d’exécution du Studio ; les fichiers installés de Prime Agent restent intacts. Si une mise à jour du CLI change un point d’intégration, le Studio affiche une erreur explicite plutôt que d’appliquer une transformation incertaine.

La fermeture d’un onglet ne tue pas l’agent. Le bouton **Arrêter**, lui, ferme l’exécution et ses descendants. Une fermeture ou un redémarrage du serveur interrompt les exécutions en cours ; les messages déjà enregistrés restent consultables et la conversation peut être reprise.

## Développement des préférences sans interruption

L’application native et ses paquets se construisent avec `make build` (non signé) ou `make build-release` (signé + catalogue d’updater) : voir [le guide de l’application Linux](desktop.md). Les tests natifs utilisent un dossier temporaire et un port dédié. L’interface ne possède aucun accès générique au shell Tauri ; les commandes du lanceur vérifient leur origine locale, et les liens externes s’ouvrent dans le navigateur.

Le Studio sert directement les fichiers du dépôt. Pour travailler pendant des sessions actives, utilisez un worktree séparé : modifier le checkout servi pourrait changer l’interface de ces sessions. `node scripts/preview-preferences.mjs --serve` lance un aperçu avec dossiers temporaires, moteur simulé et écoute exclusivement loopback ; les adresses affichées sont de démonstration. Ce script ne lance aucun agent et ne modifie aucun compte ou accès réel.

`lib/remote-network.mjs` gère séparément les passerelles et leur cycle de vie. Les modifications réseau et du PIN utilisent la même file d’écriture et une révision de configuration. Une nouvelle écoute doit réussir avant l’enregistrement et le remplacement de l’ancienne ; un échec annule les écoutes préparées. La fermeture d’une passerelle détruit ses connexions proxy, sans appeler l’annulation des agents. La passerelle distante ne relaie aucune route de configuration réseau ou système.

`lib/tailscale-https.mjs` prépare et vérifie Tailscale Serve avec `execFile`, sans shell. La passerelle loopback doit écouter avant toute modification Serve. L’annulation restaure uniquement la redirection préparée si elle appartient encore au Studio ; les services tiers et Funnel ne sont jamais remplacés. Les liens d’autorisation sont limités aux pages Serve/DNS HTTPS de `login.tailscale.com`. Désactiver HTTPS ferme la passerelle locale et conserve la redirection privée pour la prochaine activation.

`npm run test:https` vérifie l’autorisation, la nouvelle tentative, l’état d’attente, le PIN, le QR et les options HTTPS sur PC/mobile. `test/https-settings.test.mjs` vérifie les conflits, l’annulation et la continuité des agents. Ces tests et l’aperçu utilisent un émulateur Tailscale : aucune commande réelle de configuration n’est exécutée.

`npm run test:settings` vérifie la navigation, le focus, les changements réseau, le QR, les langues et les largeurs 390/320 px. `test/remote-network.test.mjs` vérifie la conservation du PIN, les échecs, les révisions concurrentes, les permissions et les agents toujours actifs. Les tests utilisent uniquement des données temporaires et des ports loopback. Les tests d’interface navigateur privilégient Chrome/Chromium sous Linux ; définissez `PRIME_STUDIO_TEST_BROWSER` pour remplacer le canal Playwright.

Les préférences d’apparence client (`theme`, `density`) vivent dans `prime-studio.preferences`. `public/theme.js` les applique avant le premier rendu ; les jetons d’espacement répondent à `html[data-density]` dans `public/styles.css`, `conversation.css` et `inspector.css`.

## Vérifications

```sh
npm run check
npm test
npm run test:ui
npm run test:i18n
npm run test:mobile
npm run test:layout
npm run test:attachments
npm run test:inspector
npm run test:reasoning
npm run test:remote-access
npm run test:subagents:native
npm run test:pwa
```

## Traductions de l’interface

`public/translations.js` contient la liste des langues et une table unique : une ligne par identifiant, avec toutes ses traductions. `public/i18n-core.js` fournit les paramètres, pluriels natifs `Intl`, la sélection de langue et le repli français, utilisables aussi par le serveur. `public/i18n.js` applique le choix du navigateur et actualise uniquement les textes et attributs liés à une traduction. Les champs de formulaire et les contenus des conversations ne sont pas remplacés lors du changement.

`npm run check` inclut la vérification des langues, des paramètres, des pluriels et des références du code et du HTML. `test/i18n.test.mjs` teste aussi volontairement une traduction absente pour vérifier le repli réel. `npm run test:i18n` teste le changement dans un vrai navigateur, la synchronisation entre onglets, les brouillons de connexion fournisseur et MCP, une réponse en cours sans annulation, les pièces jointes, la connexion mobile et la PWA hors ligne. Les autres tests graphiques déclarent explicitement leur langue française.

Pour ajouter un texte ou une langue, suivez [le guide de traduction](translations.md). Les textes du serveur restent dans la langue de référence dans les données natives ; le navigateur traduit uniquement les libellés et diagnostics appartenant au Studio. Aucun service de traduction externe n’est utilisé.

La documentation dispose également de deux versions. `npm run check:docs`, inclus dans `npm run check`, vérifie le registre des paires, les liens, les ancres et les empreintes de relecture. Après une modification, relisez les deux langues puis utilisez `npm run docs:sync -- identifiant` ; [le guide des traductions](translations.md#maintenir-la-documentation-bilingue) décrit cette procédure. Ce contrôle n’évalue pas automatiquement la qualité linguistique.

Les tests automatiques utilisent des données temporaires et un faux moteur, sans consommation de modèle. Les tests de lanceur vérifient la réutilisation du serveur et l’arrêt des descendants via les scripts shell. Les tests de navigateur privilégient Chrome/Chromium sous Linux et produisent des captures dans `test-results/`.

`test:subagents:native` utilise le vrai moteur et Python avec un fournisseur HTTP local simulé, sans compte ni appel payant. Il vérifie les arguments par défaut et explicites, le prompt existant, les niveaux en direct et dans l’historique, puis un changement par projet pendant que les premiers sous-agents travaillent encore.

Le chargeur `runtime/subagent-loader.mjs` est ajouté uniquement à l’environnement des processus du Studio. Son hook reconnaît les méthodes du moteur 0.9.2, dans les modules ou le bundle, et refuse une structure inconnue. Les arguments omis sont complétés avant la validation native ; l’instruction est ajoutée à la liste des compléments système et reconstruite avant les nouveaux tours. Les instantanés des enfants incluent leur `thinkingLevel` effectif. Aucun fichier de l’installation Prime Agent n’est modifié. Après une mise à jour de ce chargeur, il faut un redémarrage du Studio ; attendre la fin des sessions actives.

`test:reasoning` vérifie les trois modes d’affichage, le Markdown nettoyé, le suivi des deux dernières lignes à chaque delta et à la rotation, les valeurs du panneau Agents et la configuration globale/par projet. L’ancien booléen de préférence migre vers Masqué ou Détaillé ; une nouvelle installation utilise Aperçu.

Test réel facultatif avec le compte Luna déjà configuré (**consomme des appels au modèle**) :

```sh
node scripts/smoke-luna.mjs
```

Il utilise `openai-codex/gpt-5.6-luna` et des sessions isolées dans `.local/smoke-sessions`. Il vérifie un appel de l’outil Python vers un sous-processus shell avec le runtime du Studio chargé.

Le scénario réel de délégation, reprise avec outil et interruption se lance explicitement avec `node scripts/smoke-worker-recovery.mjs --run-luna`. Il utilise uniquement Luna et conserve ses sessions et rapports dans `.local/recovery-smoke-workspace/`.

## Panneau Session, Agents et Fichiers

`lib/session-inspector.mjs` reconstruit les délégations depuis les liens du registre natif, sans en créer ni en réparer. Pour une exécution active, `get_state` et `get_rlm_children` enrichissent l’historique ; le client vérifie le propriétaire, le projet et l’en-tête de session avant toute lecture. Aucun `attach`, `detach` ou arrêt n’est émis. Les instantanés sont partagés pendant deux secondes et le navigateur suspend le rafraîchissement quand le panneau est masqué.

`lib/project-files.mjs` limite les chemins aux projets enregistrés, vérifie les cibles réelles des liens et masque les dossiers techniques et privés. Git est exécuté sans shell ni fenêtre, avec limites de temps et de volume, sans verrouillage facultatif, diff externe ou textconv. Les routes `GET /api/inspector*` et `GET /api/project-files*` utilisent les protections d’origine et l’authentification existantes, y compris pour les téléchargements.

Les références de documents passent par `GET /api/project-files/resolve` et la même vérification du projet. `public/file-links.js` relie les liens Markdown et les chemins en code au visualiseur, sans navigation du navigateur. L’ouverture native utilise exclusivement `POST /api/project-files/open`, autorisé aux accès distants en contrôle complet. `lib/open-file.mjs` ouvre le chemin avec `xdg-open` sous Linux. Les exécutables et types non pris en charge sont refusés.

`npm run test:inspector` couvre une hiérarchie imbriquée, l’activité d’un agent réutilisé, les fichiers et diffs, le téléchargement exact, le mode distant en lecture seule, le clavier, les thèmes et les formats 1440, 390 et 320 pixels. Il vérifie que les fichiers natifs, l’index Git et le brouillon restent intacts. `npm run test:commands:native` vérifie aussi la lecture du nouvel instantané auprès du vrai moteur 0.9.2 pendant un outil Python, sans appel à un fournisseur payant.

## Messages pendant une exécution

Pendant une exécution, le champ permet **Réorienter** (après les outils de l’étape courante) ou **À la suite** (après la réponse courante). Les messages en attente peuvent être modifiés, réordonnés, retirés ou déplacés entre ces deux modes. Le carré d’arrêt reste une commande distincte. Une confirmation d’envoi signifie que le moteur a accepté le message ; sa transmission apparaît ensuite dans la conversation.

`lib/live-session-client.mjs` utilise les commandes du daemon existant, sans créer ni relancer de session. Les routes `/api/live/sessions/:id` restent protégées par l’authentification et les permissions de l’accès mobile habituel.

Les vérifications ciblées sont `node scripts/test-live-messages-ui.mjs` et `node scripts/test-live-integration.mjs`. Le test `node scripts/smoke-live-messages.mjs --run-native` utilise le Prime Agent installé avec un véritable outil Python et un fournisseur simulé sur localhost, sans appel à un compte de modèle.

## Pièces jointes

`lib/images.mjs` valide les images PNG/JPEG/GIF/WebP. Au lancement, le Studio utilise les arguments natifs `@chemin` du CLI avec les images conservées dans `.studio-images/` ; les commandes RPC `steer` et `follow_up` reçoivent directement les blocs `ImageContent`. Les deux chemins enregistrent les pixels dans les messages natifs. Les éditions de file omettent volontairement le champ `images`, ce qui conserve les images attachées selon le contrat natif de Prime Agent 0.9.1.

`lib/files.mjs` conserve les autres fichiers sous des identifiants aléatoires dans `.local/attachments/`. Les noms d’origine sont des métadonnées ; leurs octets ne sont pas interprétés comme du texte. Le message contient un bloc `prime_studio_files` listant les chemins locaux accessibles aux outils. L’historique affiche des liens de téléchargement authentifiés via `GET /api/files/:id`. L’édition d’un message en attente conserve ses références de fichiers.

Le navigateur propose deux sélecteurs, le dépôt dans la conversation et le collage des objets `File` du presse-papiers. Un chemin copié sous forme de simple texte n’est pas importé automatiquement. Les brouillons de pièces jointes utilisent IndexedDB et sont retirés après acceptation seulement. Le serveur annonce cette capacité dans le bootstrap pour éviter un envoi silencieusement ignoré par un ancien serveur encore en cours d’exécution.

```sh
npm run test:attachments
node scripts/smoke-live-messages.mjs --run-native --attachments
```

Le premier scénario vérifie les sélecteurs réels, le collage, le dépôt, les brouillons, les téléchargements, les deux modes d’envoi et la disposition mobile/PC via la passerelle authentifiée. Le second utilise le vrai moteur, un outil Python et un fournisseur simulé local : il vérifie les pixels reçus, la lecture des fichiers et leur conservation après édition de la file, sans consommer de compte modèle ni toucher aux sessions utilisateur.

## PWA et HTTPS privé

`public/manifest.webmanifest` décrit l’application autonome et ses icônes. `public/pwa.js` propose le dialogue natif d’installation ou une aide adaptée au navigateur, sur la page de connexion et dans le menu. Le service worker `/service-worker.js` conserve uniquement une liste fixe d’icônes, le manifeste, une feuille de style, les ressources de traduction et l’écran de reconnexion. Les API, les flux SSE, les soumissions et les fichiers utilisateur sont exclus. Les pages authentifiées ne sont jamais enregistrées dans Cache Storage.

`lib/pwa.mjs` définit les seules ressources publiques nécessaires à l’installation et valide l’origine HTTPS Tailscale. `lib/lan.mjs` accepte cette origine uniquement sur la passerelle loopback dédiée, conserve les contrôles Host/Origin et émet un cookie Secure. Les en-têtes de proxy ne définissent pas l’origine de confiance. `scripts/enable-pwa.mjs` préserve la configuration existante et pointe Tailscale Serve vers cette passerelle, jamais directement vers l’API locale.

`npm run test:pwa` utilise un profil Chrome/Chromium temporaire pour vérifier les critères d’installation via CDP, le service worker, l’absence de données privées dans le cache, le retour hors ligne, la conservation des brouillons et les instructions iPhone. Le dialogue d’installation est simulé pour ne pas installer réellement une application sur le PC pendant les tests. Les tests HTTP dans `test/pwa.test.mjs` couvrent l’authentification HTTPS, les ressources publiques, les origines et les conflits de configuration Serve.

`public/viewport.js` ajuste la hauteur du chat au viewport visible, y compris lorsque le clavier réduit seulement celui-ci. Le zoom tactile reste libre. Les marges système sont réservées autour de l’interface ; le pied de page secondaire est masqué sur mobile. `npm run test:layout` vérifie une longue conversation en portrait, paysage et avec des géométries simulées de clavier et de barre système. Ces simulations ne remplacent pas un test sur un téléphone physique.

Le test PWA couvre aussi une arrivée depuis un autre site suivie d’un rechargement avec le service worker actif. Ce relais conserve le mode de navigation mais peut transmettre `Sec-Fetch-Dest: empty`. La passerelle accepte ce cas uniquement pour les ouvertures GET de `/` et `/index.html`, tout en conservant les vérifications Host/Origin, l’authentification et les protections des API.

## Projets, déconnexion et MCP

`npm run test:workspace` vérifie les menus de projet et de session sur écran tactile, leur stabilité lors du redimensionnement, le retrait confirmé avec conservation des fichiers, les formulaires MCP et la déconnexion d’un navigateur pendant une exécution simulée. Les captures PC/mobile sont conservées dans `test-results/`.

Sous Linux, `lib/open-directory.mjs` ouvre les dossiers de projet avec `xdg-open`. Le chemin est transmis comme argument de données, sans shell.

`lib/mcp-config.mjs` valide le format natif, masque les secrets renvoyés au navigateur et écrit uniquement `mcpServers` avec `FileSettingsStorage.withLock`. Les valeurs par défaut des modèles utilisent le même verrou. Chaque modification MCP vérifie la révision de la configuration pour refuser un écrasement depuis un écran périmé. `lib/prime-native.mjs` charge les modules de l’installation Prime Agent résolue par le Studio ; une installation incompatible produit une erreur explicite.

`lib/mcp-service.mjs` possède uniquement ses processus de découverte et d’autorisation. `scripts/mcp-probe-worker.mjs` et `scripts/mcp-probe.py` utilisent le stockage OAuth et le client Python `rlm.mcp` natifs. `scripts/mcp-oauth-worker.mjs` utilise le fournisseur OAuth natif avec saisie de l’URL complète depuis un autre appareil. Les délais, annulations et arrêts sont limités aux processus du gestionnaire. Aucun arrêt de daemon ni rechargement d’une session utilisateur n’est déclenché.

`test/mcp.test.mjs` couvre les écritures concurrentes avec les réglages de modèles, les secrets, les conflits, les serveurs réservés, une connexion stdio et une connexion HTTP avec le véritable client Python, ainsi qu’un parcours OAuth HTTPS complet avec PKCE et retour mobile. Ces tests utilisent uniquement des serveurs, fichiers et certificats temporaires ; ils n’utilisent aucun compte de fournisseur. Ils nécessitent Prime Agent installé et un `python3` utilisable dans le PATH pour le worker de probe lorsqu’aucun marqueur de kernel n’est présent.

Les routes MCP sont `/api/mcp` (GET/POST/PATCH/DELETE), `/api/mcp/test`, `/api/mcp/login`, `/api/mcp/disconnect`, `/api/mcp/login/complete` (POST), et `/api/mcp/login/:id` (GET/DELETE). La passerelle les refuse en lecture seule. `POST /lan/logout` révoque le cookie courant et ses connexions de proxy, y compris SSE, sans arrêter les exécutions. `DELETE /api/projects` retire les métadonnées de projet ; un marqueur persistant empêche leur réimportation immédiate depuis les sessions natives.

## Organisation du code

`public/composer.js` conserve la commande sélectionnée séparément des arguments dans le textarea. `composerText()` sérialise le tout pour les brouillons et les deux chemins d’envoi ; `setComposerText()` synchronise l’édition et le chip. Les événements de collage des pièces jointes restent attachés au même textarea. Les raccourcis immédiats sont partagés entre interface et serveur dans `public/command-definitions.js`.

Le navigateur précharge le catalogue, mutualise les requêtes, conserve un cache par contexte pendant 30 secondes et invalide les réponses tardives lors d’un changement de session. La validation serveur reste native. Le menu propose les raccourcis sans attendre le réseau et le catalogue détaillé affiche des lots de 30 résultats. `scripts/test-command-chips.mjs`, inclus dans `npm run test:commands`, retient volontairement la réponse HTTP pour vérifier l’ouverture immédiate et utilise 801 skills pour tester pagination et recherche, puis les brouillons, le presse-papiers, les pièces jointes et les envois pendant un tour sur PC et mobile.

`lib/commands.mjs` expose le catalogue et valide les envois slash avant leur admission. `scripts/command-catalog-worker.mjs` utilise le gestionnaire de packages et les lecteurs de skills/prompts de l’installation native, dans un processus masqué et borné. Il ignore les packages absents et ne charge pas les extensions JavaScript. Pour une exécution active, `get_commands` fournit les ressources réellement chargées, après vérification de l’identité du worker.

Les commandes natives de session passent par `prompt` avec `streamingBehavior` et `queueIfBusy` : `steer` et `follow_up` seuls ne déclenchent pas leur analyse native. Les skills et prompts conservent ces chemins d’envoi ordinaires et sont développés par le moteur. Les résultats natifs `custom` avec `display: true` sont projetés comme messages de contexte. Le remplacement d’un message ordinaire par une commande en attente est refusé, car leur type d’action native est différent.

`npm run test:commands` vérifie les parcours PC/mobile via une passerelle authentifiée, le catalogue, la complétion clavier, les raccourcis, les contenus non fiables et la disposition du composeur. `npm run test:commands:native` utilise un véritable worker Prime Agent, son outil Python et un fournisseur factice local, dans des dossiers temporaires. Il vérifie les expansions de skills, les arguments de prompts, les commandes en cours de tour, leur historique et l’absence d’interruption des outils. Aucun compte ou daemon utilisateur n’est utilisé.

`server.mjs` expose l’API locale et les flux SSE. `lib/store.mjs` lit les sessions natives et conserve les préférences. `lib/agent.mjs` gère le CLI, les modèles, les événements et l’arrêt. `public/` contient l’interface. `runtime/` isole les correctifs de sous-processus. `scripts/` contient les lanceurs et outils de vérification.

Les principales routes sont `GET /api/bootstrap`, `GET /api/overview`, `GET /api/history?id=…`, les routes locales `/api/model-config` et `/api/model-defaults`, `POST /api/projects`, `PATCH /api/projects`, `PATCH /api/sessions`, `POST /api/runs`, `GET /api/runs/:id/events` et `POST /api/runs/:id/stop`. Les flux SSE acceptent `Last-Event-ID` pour reprendre les événements après une déconnexion.

## Régénérer les captures du README

`node scripts/capture-roadmap.mjs` régénère les illustrations de la Roadmap en français et en anglais, avec un projet fictif entièrement isolé. Le script capture l’interface réelle sans utiliser de projet utilisateur ni appeler de fournisseur.

```sh
node scripts/capture-readme.mjs
```

Le script ouvre la véritable interface dans Chrome/Chromium sans fenêtre visible, sur un serveur temporaire distinct. Les projets, conversations, modèles et événements sont des données de démonstration. Aucun agent natif ni compte de fournisseur n’est utilisé, et aucune session du Studio en cours n’est modifiée.

`npm run test:workspace -- --capture-docs` régénère la capture du gestionnaire MCP avec une configuration de démonstration isolée. Les comptes utilisateur sont conservés.

Les captures sont enregistrées dans `docs/screenshots/`. Cinq vues du bureau sont capturées en 1600 × 1000, dont une conversation avec pièces jointes et une nouvelle conversation avec les réglages des sous-agents. Quatre captures sont cadrées sur leur fenêtre : préférences en anglais avec sélecteur de langue, sélecteur de modèles, modèles par défaut et code mobile. La capture des préférences utilise une hauteur de fenêtre de 1200 pixels pour montrer tous les réglages. Les fichiers de démonstration restent dans le dossier temporaire du scénario. Le rapport se trouve dans `test-results/readme-captures.json`. `PRIME_STUDIO_BROWSER` permet de choisir un autre canal Playwright installé, par exemple `chrome`.

Pour régénérer les captures avec l’interface anglaise dans `docs/screenshots/en/`, sans remplacer les captures françaises :

```sh
node scripts/capture-readme.mjs --docs-en
node scripts/test-providers-ui.mjs --docs-en
node scripts/test-inspector-ui.mjs --docs-en
node scripts/test-workspace-ui.mjs --docs-en
```

`scripts/documentation-capture.mjs` applique temporairement l’anglais aux fenêtres de ces scénarios isolés et rétablit leur langue après la capture. Les exemples de conversations et de documents restent dans leur langue d’origine, comme dans l’application. Aucun serveur utilisateur n’est redémarré.
