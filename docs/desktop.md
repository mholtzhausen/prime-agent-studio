# Application Linux

[English](en/desktop.md) · **Français** · [← Retour au README](../README.fr.md)

L’application **Prime Agent Studio**, construite avec Tauri 2, ouvre le Studio dans une fenêtre Linux dédiée (WebKitGTK). Son lanceur démarre le serveur en arrière-plan ou réutilise l’instance déjà ouverte. Depuis les sources, vous pouvez utiliser `scripts/start-studio.sh` / `make start-silent`.

## Installation et premier lancement

Téléchargez l’[AppImage](https://github.com/zerr0o/prime-agent-studio/releases/latest) ou le [deb](https://github.com/zerr0o/prime-agent-studio/releases/latest) amd64 depuis la dernière release. L’AppImage est portable ; le deb installe l’intégration bureau. Node.js est inclus. Les paquets s’appuient sur WebKitGTK du système — aucun runtime de navigateur séparé n’est à installer.

Les builds avec préparation guidée téléchargent **Prime Agent, npm privé, uv et Python** à la demande. Ces composants ne sont pas inclus dans le paquet. Aucune installation antérieure de Node, npm ou Python, modification du PATH ou commande de terminal n’est nécessaire. Une connexion réseau initiale est requise. **Un `bash` fonctionnel reste un prérequis distinct** pour les commandes shell du moteur ; son absence est signalée.

Au premier lancement, consultez l’état des composants puis choisissez **Installer les composants manquants**, **Choisir une installation existante** ou **Plus tard — ouvrir le Studio**. Le téléchargement nécessite le clic explicite sur le bouton d’installation. « Plus tard » conserve les réglages et l’historique ; les actions du moteur demandent de terminer la préparation. Après validation, configurez un fournisseur dans **Connexions** : la préparation ne connecte aucun compte et n’envoie aucun prompt payant. Si vous utilisiez déjà un checkout source, choisissez **Reprendre une installation existante** et sélectionnez son dossier, celui qui contient `server.mjs` et `.local`.

La migration copie les projets, les défauts des sous-agents, les pièces jointes et les réglages d’accès distant, y compris le PIN. L’installation d’origine reste intacte. Si son serveur tourne, l’application s’y connecte immédiatement et reporte la copie au premier lancement où ce serveur est arrêté. Elle n’interrompt aucune exécution. Les sessions Prime Agent restent à leur emplacement habituel. Après migration, utilisez l’application pour ouvrir le Studio ; l’ancien lanceur conserve sa propre copie des réglages.

Les préférences d’apparence et les brouillons du navigateur ne sont pas copiés : la fenêtre Tauri a son propre stockage persistant.

## Préparation, réparation et compatibilité

**Préférences → Système → Composants du Studio → Configurer**, ou **Réglages de l’application** depuis l’icône de notification, ouvre le même diagnostic. La sélection d’une installation existante accepte la racine du paquet Prime Agent, `uv` ou `python`. `PRIME_AGENT_CLI`, `PRIME_GUI_UV` et `PRIME_AGENT_KERNEL_PYTHON` ont priorité, suivis des sélections enregistrées, de l’installation gérée, puis des emplacements externes habituels. Un chemin explicite invalide doit être corrigé ; il n’est jamais remplacé en silence. Un Python externe valide n’est que validé, sans y installer quoi que ce soit ni exiger uv.

La politique versionnée dans `lib/desktop-components.mjs` associe Studio 3.4.1 à **Prime Agent 0.9.4**, **npm 10.9.4** et **uv 0.8.22**, avec Python 3.11. Le packaging cible Linux x86_64 avec Node 22 ≥ 22.16 ou Node 24 ; le moteur exige ≥ 22.8. Une prochaine version de Studio peut demander un autre moteur précis : le bouton installe alors cette version après accord explicite. Aucun suivi périodique, sélection aveugle de « stable », ni mise à jour des installations externes.

La préparation lit le contrat d’origine dans [l’installateur officiel](https://app.primeintellect.ai/prime-agent/install.sh), sans exécuter ce script. L’archive du moteur et les trois paquets Prime associés sont contrôlés contre l’inventaire `releases/v<version>/SHA256SUMS`. npm provient du [registre officiel versionné](https://registry.npmjs.org/npm/10.9.4), vérifié par son intégrité SHA-512 avant extraction ; il est exécuté avec le Node Studio par `npm-cli.js`. L’archive [uv Linux x86_64](https://github.com/astral-sh/uv/releases/tag/0.8.22) est vérifiée contre son fichier `.sha256`. Ces références HTTPS de même origine assurent l’intégrité du transfert, pas une signature indépendante. Les hôtes autorisés sont fixes et toute rotation d’origine échoue de façon fermée. Un moteur externe détecté automatiquement n’est pas exécuté : choisissez-le explicitement pour lui accorder votre confiance.

Les scripts npm sont désactivés (`--ignore-scripts`). Le postinstall de Prime ne prépare des outils optionnels et son propre kernel que sur demande ; le Studio utilise `ensureLocalKernel`. L’installation conserve les ressources et dépendances complètes, vérifie les imports natifs fournisseur, modèle, commande, MCP et Photon avant validation. npm conserve son lockfile pour diagnostiquer les dépendances transitives. uv télécharge le Python géré si besoin (`UV_PYTHON_DOWNLOADS=automatic`, `UV_PYTHON_PREFERENCE=only-managed`). Le code existant valide les imports Python, le protocole du kernel et les skills essentielles. Les outils optionnels, dont fd/rg et les intégrations de comptes, ne sont pas tous installés par cette préparation.

Les composants résident dans `engine/prime-agent/<version-id>`, `engine/uv/<version-id>`, `engine/npm/<version-id>` et `engine/python`, sous le dossier de données de l’application. `engine/prepared.json` conserve les composants validés pour une reprise ; `engine/installation.json` sélectionne atomiquement les chemins, versions, provenances et empreintes après validation Python. `engine/selection.json` contient les sélections explicites. Les noyaux restent dans `.local`. Les archives passent par un staging neuf, avec limites de taille et refus des traversées et liens. Les versions précédentes et les installations externes ne sont jamais supprimées.

La progression expose les étapes réelles et les octets reçus, sans pourcentage global inventé. Une annulation ou une erreur permet de réessayer sans perdre les composants déjà validés. Un verrou empêche deux préparations simultanées et récupère un propriétaire arrêté. Les journaux `engine/logs/components.log` contiennent seulement étapes, codes et octets. Les téléchargements ne démarrent ni à l’ouverture d’une page distante ni à une simple connexion.

Une préparation terminée ne redémarre qu’un serveur dont le Studio vérifie la propriété et l’inactivité. Si des agents travaillent ou qu’un autre lanceur possède le serveur, l’activation reste différée jusqu’à un redémarrage approprié. Aucun processus Node global n’est arrêté. Les générations de moteur et de kernel restent disponibles pour les processus existants.

## Fenêtre et travail en arrière-plan

- **Fermer la fenêtre** la masque et conserve l’icône de notification. Les agents, le serveur et l’accès mobile continuent.
- Un clic sur cette icône ou un nouveau lancement ramène la même fenêtre.
- Le menu de l’icône propose **Ouvrir le Studio**, **Réglages de l’application** et **Quitter l’application**. Quitter ferme Tauri mais laisse le serveur et les agents travailler.
- Dans **Réglages de l’application**, **Démarrer avec la session** est désactivé par défaut. L’activer lance le Studio en arrière-plan à votre connexion, sans ouvrir sa fenêtre. Une erreur de démarrage affiche la fenêtre pour permettre une nouvelle tentative.
- Les liens externes s’ouvrent dans votre navigateur habituel. Le LAN, Tailscale, HTTPS et la PWA mobile utilisent toujours le même serveur.

Pour reconnecter un serveur arrêté, ouvrez **Réglages de l’application → Ouvrir le Studio**. Ce bouton réutilise une instance existante et n’arrête jamais les agents.

Une entrée de bureau ou une commande de lancement peut utiliser l’argument `--settings` pour ouvrir directement les réglages de l’application, y compris lorsqu’elle fonctionne déjà en arrière-plan.

## Données et mises à jour

Les données de bureau utilisent le dossier de données d’application XDG / Tauri, en pratique `~/.local/share/com.primeagent.studio` :

| Emplacement    | Contenu                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `data`         | Projets, pièces jointes, PIN haché, réglages réseau et journaux serveur  |
| `.local`       | Kernels Python persistants                                               |
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

`npm run test:components` vérifie le résolveur, les téléchargements par serveur local, les empreintes, les archives hostiles, les verrous et le parcours FR/EN dans Chrome/Chromium sans installation réelle. `npm run test:components:download` exige les ressources `.desktop-build` : il lance le Node embarqué dans un dossier temporaire isolé avec un PATH local réduit, télécharge réellement les composants, prépare Python, vérifie `/api/version` et refuse tout téléchargement à la seconde préparation. Il conserve son dossier de diagnostic et ne masque ni ne supprime les outils de l’utilisateur. Il n’utilise aucun compte ni modèle payant. Pour valider les sessions avec un fournisseur simulé, exécutez `scripts/test-commands-native.mjs` avec `PRIME_AGENT_CLI` et `PRIME_AGENT_KERNEL_PYTHON` issus de ce manifeste isolé.

Ces contrôles ne remplacent pas une validation de l’assistant dans le binaire Tauri empaqueté, en FR/EN, sur une machine Linux x86_64 propre. Cette étape nécessite la chaîne Rust et les paquets de développement WebKitGTK.

Sous Linux, installez Rust et les [prérequis Tauri 2 pour Linux](https://v2.tauri.app/start/prerequisites/) (notamment `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`), puis :

```sh
npm ci
npm run desktop:build
```

Les paquets se trouvent dans `src-tauri/target/release/bundle/appimage` et `…/bundle/deb`. `npm run desktop:dev` prépare les ressources et démarre la compilation de développement. `npm run desktop:icons` régénère les icônes à partir du SVG.

La construction vérifie les références des modules, workers et assistants natifs avant de créer les paquets. `npm run test:desktop-runtime` teste les ressources préparées dans `.desktop-build` avec les vrais workers Prime Agent, un projet et des comptes isolés : skills Python, prompts et fournisseurs.

`npm run test:desktop` vérifie le binaire debug préalablement compilé : ressources extraites par l’exécutable, messages et noyau Python avec un modèle HTTP local simulé, API des fournisseurs et commandes, réutilisation d’un serveur avec un agent simulé actif, démarrage réel du serveur inclus, instance unique et survie du serveur à la fermeture du processus Tauri. Prime Agent et uv doivent être disponibles. Passez le chemin du binaire après `--` pour tester une autre compilation. `npm run test:desktop-ui` vérifie les adaptations de présentation dans Chrome/Chromium. Les tests ne lancent aucun appel payant à un modèle.

Pour les tests isolés, `PRIME_STUDIO_DESKTOP_DATA_ROOT` et `PRIME_STUDIO_DESKTOP_PORT` changent respectivement le dossier de données et le port. Ne les définissez pas pour un usage normal. Les installations depuis les sources peuvent utiliser `scripts/start-studio.sh` / `make start-silent`.

`npm run test:desktop-updates` et `npm run test:settings-updates` vérifient les deux panneaux en français et en anglais. `npm run test:desktop-lifecycle` valide un vrai redémarrage Tauri avec un serveur occupé, confirmation, données préservées et activation de la version installée. `cargo test --manifest-path src-tauri/Cargo.toml --locked` teste le client de mise à jour réel contre un serveur local : signature valide, fichier altéré, versions égales/plus anciennes et catalogue invalide. Les tests n’exécutent jamais un installateur.

Pour les tests natifs en parallèle de votre application, compilez une identité de test distincte : `TAURI_CONFIG='{"identifier":"com.primeagent.studio.interaction-test"}' cargo build --manifest-path src-tauri/Cargo.toml --locked`. Retirez ensuite la variable avant une compilation de distribution. `npm run test:desktop-interactions` teste les liens web et OAuth synthétiques, les pièces jointes, le presse-papiers, l’export et les permissions dans le webview WebKitGTK. Il ouvre des onglets de test dans le navigateur habituel, sans connexion à un compte.

## Préparer une release de mise à jour

La clé privée de signature reste hors du dépôt, par exemple dans `~/.tauri/prime-agent-studio.key` sur la machine de release. Sauvegardez-la de façon sûre : les applications installées font confiance à la clé publique embarquée, et une clé de remplacement incompatible empêcherait les mises à jour. `desktop:build` utilise cette clé locale ou `TAURI_SIGNING_PRIVATE_KEY` (chemin ou contenu) et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Sans clé, `npm run desktop:build -- --no-bundle` ne construit que l’exécutable.

Après une compilation signée, lancez `npm run desktop:manifest -- chemin/notes.md` (les notes sont optionnelles). `.local/desktop-release/v<version>` contient les fichiers à joindre ensemble à la release stable `v<version>` : l’AppImage au nom sans espace, sa signature `.sig`, `latest.json`, et en général le `.deb` correspondant. Ne renommez pas l’AppImage ensuite : le catalogue contient son URL exacte.

Le workflow GitHub **Linux desktop release** s’exécute manuellement avec une balise stable existante correspondant à `package.json`. Il teste, compile, signe et prépare une **release brouillon** contenant ces fichiers. Configurez les secrets du dépôt `TAURI_SIGNING_PRIVATE_KEY` et, pour une clé chiffrée, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Il refuse d’écraser une release publiée. Les workflows ne signent jamais un paquet téléversé manuellement : ils reconstruisent toujours depuis la balise avant de signer. Relisez le brouillon, puis publiez-le comme dernière release stable pour rendre la mise à jour disponible. Ne publiez pas ensuite une release stable sans son catalogue et son AppImage.
