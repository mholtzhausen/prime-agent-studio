# Application Linux

[English](en/desktop.md) · **Français** · [← Retour au README](../README.fr.md)

L’application **Prime Agent Studio Nix**, construite avec Tauri 2, ouvre le Studio dans une fenêtre Linux dédiée (WebKitGTK). Son lanceur démarre le serveur en arrière-plan ou réutilise l’instance déjà ouverte. Depuis les sources, vous pouvez utiliser `scripts/start-studio.sh` / `make start-silent`.

## Installation et premier lancement

Téléchargez l’[AppImage](https://github.com/mholtzhausen/prime-agent-studio/releases/latest) ou le [deb](https://github.com/mholtzhausen/prime-agent-studio/releases/latest) amd64 depuis la dernière release. L’AppImage est portable ; le deb installe l’intégration bureau. Node.js est inclus. Les paquets s’appuient sur WebKitGTK du système — aucun runtime de navigateur séparé n’est à installer. Le runtime AppImage fixerait autrement `PYTHONHOME`/`PYTHONPATH` sous `$APPDIR` ; le Studio les efface car il ne fournit pas Python.

Installez **Prime Agent** vous-même s’il n’est pas déjà disponible ; le Studio ne télécharge ni Prime Agent, ni npm, ni uv, ni Python. **Un `bash` fonctionnel reste un prérequis distinct** pour les commandes shell du moteur ; son absence est signalée.

Au premier lancement, consultez l’état des composants, puis choisissez **Choisir une installation existante** ou **Plus tard — ouvrir le Studio** selon le besoin. Après validation, configurez un fournisseur dans **Connexions**. Si vous utilisiez déjà un checkout source, choisissez **Reprendre une installation existante** et sélectionnez son dossier, celui qui contient `server.mjs` et `.local`.

La migration copie les projets, les défauts des sous-agents, les pièces jointes et les réglages d’accès distant, y compris le PIN. L’installation d’origine reste intacte. Si son serveur tourne, l’application s’y connecte immédiatement et reporte la copie au premier lancement où ce serveur est arrêté. Elle n’interrompt aucune exécution. Les sessions Prime Agent restent à leur emplacement habituel. Après migration, utilisez l’application pour ouvrir le Studio ; l’ancien lanceur conserve sa propre copie des réglages.

Les préférences d’apparence et les brouillons du navigateur ne sont pas copiés : la fenêtre Tauri a son propre stockage persistant.

## Préparation, réparation et compatibilité

**Préférences → Système** est le seul éditeur de chemin pour **Prime Agent** (identique dans le navigateur et le webview Studio de bureau). Le lanceur de bureau n’héberge plus de panneau de configuration des composants. Un champ vide est détecté automatiquement (PATH et emplacements usuels : `~/.local`, nvm) ; un chemin enregistré ou saisi n’est jamais écrasé. Les changements s’appliquent immédiatement avec un indicateur de statut ; **Réinitialiser** vide le champ et le redétecte. Installez Prime Agent vous-même — Studio ne le télécharge pas.

`PRIME_AGENT_CLI` a priorité, suivi de la sélection dans `engine/selection.json`. Un chemin explicite invalide doit être corrigé ; il n’est jamais remplacé en silence. Les contrôles de capacité couvrent la structure et les probes du moteur (les shims pyenv/shell sont acceptés s’ils fonctionnent). `PRIME_AGENT_KERNEL_PYTHON` optionnel est un remplacement d’environnement **Prime Agent** uniquement, pas un champ Système du Studio. Un diagnostic prêt écrit `installation.json` (activation) et lève la barrière des composants requis.

Le packaging cible Linux x86_64 avec Node 22 ≥ 22.16 ou Node 24 ; le moteur exige ≥ 22.8. Aucun suivi périodique ni mise à jour automatique des installations externes.

Le Studio n’exécute pas `ensureLocalKernel` et ne provisionne pas Python sous `.local`. Prime Agent possède son noyau de skills.

## Fenêtre et travail en arrière-plan

- **Fermer la fenêtre** la masque et conserve l’icône de notification. Les agents, le serveur et l’accès mobile continuent.
- Un clic sur cette icône ou un nouveau lancement ramène la même fenêtre.
- Le menu de l’icône propose **Ouvrir le Studio**, **Réglages de l’application** et **Quitter l’application**. Quitter arrête le serveur Studio géré et ferme Tauri. Fermer la fenêtre ne fait que masquer l’interface ; le serveur continue pour le LAN/mobile jusqu’à Quitter. Le daemon propre à Prime Agent peut continuer indépendamment.
- Dans **Réglages de l’application**, **Démarrer avec la session** est désactivé par défaut. L’activer lance le Studio en arrière-plan à votre connexion, sans ouvrir sa fenêtre. Une erreur de démarrage affiche la fenêtre pour permettre une nouvelle tentative.
- Les liens externes s’ouvrent dans votre navigateur habituel. Le LAN, Tailscale, HTTPS et la PWA mobile utilisent toujours le même serveur.

Pour reconnecter un serveur arrêté, ouvrez **Réglages de l’application → Ouvrir le Studio**. Ce bouton réutilise une instance existante et n’arrête jamais les agents.

Une entrée de bureau ou une commande de lancement peut utiliser l’argument `--settings` pour ouvrir directement les réglages de l’application, y compris lorsqu’elle fonctionne déjà en arrière-plan.

## Données et mises à jour

Les données de bureau utilisent le dossier de données d’application XDG / Tauri, en pratique `~/.local/share/com.primeagent.studio.nix` :

| Emplacement    | Contenu                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `data`         | Projets, pièces jointes, PIN haché, réglages réseau et journaux serveur  |
| `.local`       | Données Studio ; des marqueurs de kernel hérités peuvent exister ; Prime Agent possède son noyau |
| `versions`     | Copies immuables des fichiers serveur et de Node.js                      |
| `webview`      | Préférences et stockage de la fenêtre                                    |
| `desktop.json` | Préférences du lanceur et installation à migrer                          |

Une mise à jour installe la nouvelle application et prépare une nouvelle copie du serveur. **Préférences → Mise à jour** distingue la version d’application installée de la version du serveur en cours. Les anciennes copies ne sont pas supprimées automatiquement, pour préserver les processus qui les utilisent encore.

**Passage à la version 3.0.0 :** si l’ancien serveur reste actif après l’installation, le Studio affiche encore sa version et ses fonctions. Attendez la fin des agents, puis utilisez **Préférences → Mise à jour → Redémarrer le serveur** dans l’application Linux pour charger la V3. La [navigation par projets dépliables](navigation.md) et les [connaissances du projet](knowledge.md) deviennent alors disponibles ; les nouvelles exécutions et leurs sous-agents reçoivent les outils de recherche et de lecture de l’historique.

Dans le Studio, ouvrez **Préférences → Mise à jour → Vérifier les mises à jour**. Lorsqu’une version stable plus récente est publiée sur GitHub, ses notes et un bouton **Installer et relancer** apparaissent. La progression du téléchargement s’affiche, puis Tauri vérifie la signature avant l’installation. Celle-ci exige ce clic explicite.

L’option **Redémarrer le serveur après l’installation** applique la nouvelle version lorsque le serveur est libre. Si des agents travaillent encore, le serveur reste actif et les réglages s’ouvrent après la relance. **Redémarrer le serveur** affiche alors une confirmation : le redémarrage peut interrompre les exécutions et déconnectera temporairement les appareils. Les projets et l’historique enregistré sont conservés. L’activité est revérifiée avant l’arrêt ; un serveur démarré par une autre installation n’est pas arrêté.

Ces contrôles restent accessibles dans **Réglages de l’application**, depuis l’icône de notification, même si l’ancien serveur ne possède pas encore cette catégorie. Depuis un navigateur ou un téléphone, la page indique d’utiliser l’application Linux pour installer ou redémarrer.

Les liens web, y compris la connexion Codex, s’ouvrent dans le navigateur par défaut. Les dépôts de fichiers utilisent directement le compositeur HTML, sans autre pont de fichiers. Seules les commandes de mise à jour et de redémarrage sont autorisées depuis la fenêtre locale du Studio ; les autres réglages natifs restent réservés au lanceur.

Une erreur réseau, un catalogue manquant ou une signature invalide n’est jamais annoncée comme « à jour ». Vous pouvez réessayer ; les détails techniques sont dans `desktop-update-error.log` du dossier de données. Le catalogue devient disponible avec la première release contenant `latest.json`. La vérification est manuelle, sans interrogation périodique en arrière-plan.

Les mises à jour portent une signature cryptographique Tauri (minisign). Ce port n’utilise ni Authenticode Windows ni packaging NSIS.

## Construire et vérifier

`npm run test:components` vérifie la résolution des chemins, la détection automatique, la validation de capacité et l’UI du lanceur (sans panneau de composants) dans Chrome/Chromium. Aucun compte ni modèle payant n’est utilisé.

Sous Linux, installez Rust et les [prérequis Tauri 2 pour Linux](https://v2.tauri.app/start/prerequisites/) (notamment `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`), puis :

```sh
make init
make build            # AppImage/deb locaux sans signatures d’updater
make build-release    # clé de signature + paquets signés + catalogue .local/desktop-release
# notes de release optionnelles : make build-release NOTES=chemin/notes.md
```

Les paquets se trouvent dans `src-tauri/target/release/bundle/appimage` et `…/bundle/deb`. Une arborescence de release signée est aussi copiée dans `.local/desktop-release/v<version>` (AppImage sans espace, `.sig`, `latest.json`, et en général le `.deb` correspondant). `npm run desktop:dev` prépare les ressources et démarre la compilation de développement. `npm run desktop:icons` régénère les icônes à partir du SVG.

La construction vérifie les références des modules, workers et assistants natifs avant de créer les paquets. `npm run test:desktop-runtime` teste les ressources préparées dans `.desktop-build` avec les vrais workers Prime Agent, un projet et des comptes isolés : skills Python, prompts et fournisseurs.

`npm run test:desktop` vérifie le binaire debug préalablement compilé : ressources extraites par l’exécutable, messages et skills Python avec un modèle HTTP local simulé, API des fournisseurs et commandes, réutilisation d’un serveur avec un agent simulé actif, démarrage réel du serveur inclus, instance unique et survie du serveur à la fermeture du processus Tauri. Prime Agent doit être disponible. Passez le chemin du binaire après `--` pour tester une autre compilation. `npm run test:desktop-ui` vérifie les adaptations de présentation dans Chrome/Chromium. Les tests ne lancent aucun appel payant à un modèle.

Pour les tests isolés, `PRIME_STUDIO_DESKTOP_DATA_ROOT` et `PRIME_STUDIO_DESKTOP_PORT` changent respectivement le dossier de données et le port. Ne les définissez pas pour un usage normal. Les installations depuis les sources peuvent utiliser `scripts/start-studio.sh` / `make start-silent`.

`npm run test:desktop-updates` et `npm run test:settings-updates` vérifient les deux panneaux en français et en anglais. `npm run test:desktop-lifecycle` valide un vrai redémarrage Tauri avec un serveur occupé, confirmation, données préservées et activation de la version installée. `cargo test --manifest-path src-tauri/Cargo.toml --locked` teste le client de mise à jour réel contre un serveur local : signature valide, fichier altéré, versions égales/plus anciennes et catalogue invalide. Les tests n’exécutent jamais un installateur.

Pour les tests natifs en parallèle de votre application, compilez une identité de test distincte : `TAURI_CONFIG='{"identifier":"com.primeagent.studio.nix.interaction-test"}' cargo build --manifest-path src-tauri/Cargo.toml --locked`. Retirez ensuite la variable avant une compilation de distribution. `npm run test:desktop-interactions` teste les liens web et OAuth synthétiques, les pièces jointes, le presse-papiers, l’export et les permissions dans le webview WebKitGTK. Il ouvre des onglets de test dans le navigateur habituel, sans connexion à un compte.

## Préparer une release de mise à jour

`make build-release` suffit pour une arborescence signée complète : il assure l’existence de `~/.tauri/prime-agent-studio-nix.key`, synchronise la clé publique d’updater et l’URL du catalogue dans `src-tauri/tauri.conf.json`, construit l’AppImage/deb signés, et prépare `.local/desktop-release/v<version>`. Optionnel : `SET_SECRETS=1` envoie les secrets de signature GitHub Actions ; `NOTES=chemin/notes.md` remplit les notes dans `latest.json`.

Les étapes de bas niveau restent disponibles séparément :

```sh
make desktop-release-bootstrap
# optionnel : make desktop-release-bootstrap SET_SECRETS=1
make desktop-release-check
make desktop-build
make desktop-manifest
```

La clé privée de signature reste hors du dépôt. Sauvegardez-la de façon sûre : les applications installées font confiance à la clé publique embarquée, et une clé de remplacement incompatible empêcherait les mises à jour. Les builds signés utilisent cette clé locale ou `TAURI_SIGNING_PRIVATE_KEY` (chemin ou contenu) et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Pour une installation locale sans artefacts d’updater, utilisez `make build` (alias : `make desktop-build-unsigned`). Sans clé et sans `--unsigned`, `npm run desktop:build -- --no-bundle` ne construit que l’exécutable.

Ne renommez pas l’AppImage après le packaging : le catalogue contient son URL exacte.

Les téléchargements de release et le catalogue de mise à jour in-app sont publiés depuis [mholtzhausen/prime-agent-studio](https://github.com/mholtzhausen/prime-agent-studio/releases). Le workflow GitHub **Linux desktop release** s’exécute manuellement avec une balise stable existante correspondant à `package.json`. Il teste, compile, signe et prépare une **release brouillon** contenant ces fichiers. Configurez les secrets du dépôt `TAURI_SIGNING_PRIVATE_KEY` et, pour une clé chiffrée, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (le bootstrap peut les définir). Il refuse d’écraser une release publiée. Les workflows ne signent jamais un paquet téléversé manuellement : ils reconstruisent toujours depuis la balise avant de signer. Relisez le brouillon, puis publiez-le comme dernière release stable pour rendre la mise à jour disponible. Ne publiez pas ensuite une release stable sans son catalogue et son AppImage.

Pour monter la version du paquet avant une release, utilisez la skill Cursor `/version-bump` avec un type explicite (`major`, `minor`, `patch` ou `build`) afin d’aligner `package.json`, `src-tauri/Cargo.toml` et les journaux bilingues.
