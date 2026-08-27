# Prompt complet à transmettre à l'assistant de certification RC2

Ce document est une consigne d'exécution. L'assistant doit rendre un rapport
factuel et les preuves brutes, sans publier ni déployer quoi que ce soit.

## Mission et identités immuables

Terminer les gates externes de `@bozz/routeros` RC2 avec exactement :

- dépôt : `https://github.com/bozz33/-bozz-routeros.git` ;
- candidat SDK : `8a3cd500aa5013577ca1f8179c916dc7807cf392` ;
- tooling à exécuter : `9c7e539b6e7ad565165905ab514b29d674479608` ;
- Node : `v24.19.0` ;
- npm : `11.17.0` ;
- tarball normalisé SHA-256 : `343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5` ;
- RouterOS cible : `7.24.1 (stable)`.

Deux environnements strictement séparés doivent être utilisés :

1. le VPS du HotSpot Wi-Fi personnel et son routeur physique pour
   la conformance, le gate passif, le soak 24 h, le marqueur `.dead` et
   `active/remove` ;
2. un ordinateur Linux local avec `/dev/kvm` pour la VM CHR jetable ;

TANDA n'est pas utilisé dans cette mission. Sa preuve 2 h existante est
conservée ; aucun nouveau test, reboot, write ou changement TANDA n'est permis.

## Interdictions absolues

- Ne modifier ni le projet historique déjà déployé sur le VPS personnel, ni
  BOZZ-CENTER, ni ses conteneurs, volumes, bases, réseaux ou ports.
- Ne faire aucun merge, tag, GitHub Release, `npm publish` ou déploiement.
- Ne jamais redémarrer TANDA ou le routeur physique personnel. TANDA est
  entièrement hors périmètre de cette exécution.
- Ne jamais utiliser un client, un voucher ou une session appartenant à un
  client réel. Utiliser un compte HotSpot personnel dédié et contrôlé.
- Ne jamais lancer `active/remove` si le filtre ne retourne pas exactement une
  session pour ce compte dédié.
- Ne jamais écrire un mot de passe dans Git, une commande, une variable
  d'environnement persistante, un rapport, une capture ou un message.
- Ne jamais exposer les ports API/CHR sur une adresse publique. Le CHR reste
  sur `127.0.0.1`; le routeur physique doit être atteint par son chemin privé.
- Ne pas mettre à jour RouterOS. Si la cible physique n'est pas exactement en
  `7.24.1 (stable)`, relever la version et demander une décision à l'opérateur.

Arrêter immédiatement et rendre `BLOCKED` si un SHA, une version, un hash, un
pré-requis ou la portée exacte d'une action destructive ne correspond pas.

Dans chaque terminal Bash utilisé pour les gates, commencer par :

```bash
set -Eeuo pipefail
```

Ainsi, un échec de `docker run` ne peut pas être masqué par `tee`.

L'ancien monorepo/architecture solo du VPS personnel n'est pas une cible de
test. Ne pas le copier, le migrer ou le mettre à jour. Le seul prérequis de ce
VPS est Docker et un chemin réseau privé vers son MikroTik.

## Dossier de preuves attendu

Créer un dossier privé, par exemple :

```bash
install -d -m 0700 /var/lib/bozz-routeros-cert/rc2
```

Chaque rapport doit indiquer l'horodatage UTC, l'hôte d'exécution, le SHA du
tooling, l'ID complet de l'image Docker, la version RouterOS et le code de
sortie. Les adresses privées peuvent être masquées. Les secrets doivent être
absents. Calculer `sha256sum` pour chaque preuve brute.

Conserver au minimum :

- `host-inventory.txt` ;
- `image-inspect.json` et `software-gate.log` ;
- `physical-conformance.tap` et `physical-passive.jsonl` ;
- `physical-soak-24h.jsonl`, son inspection Docker et sa validation ;
- `physical-dead-watch.jsonl` ;
- `physical-active-remove.jsonl` ;
- le diagnostic existant `FINDING-dead-attribute.md` et la capture
  `raw-dead-wire-capture.jsonl`, avec leurs SHA-256 complets ;
- les hashes archive/raw/overlay metadata CHR ;
- `chr-conformance.tap`, `chr-network-reconnect.jsonl`,
  `chr-proxy.jsonl`, `chr-reboot-reconnect.jsonl` et les sorties QMP ;
- `FINAL-VERDICT.md` avec un tableau PASS/FAIL/BLOCKED.

## A. Image de certification sur chaque hôte Docker

Cloner dans un nouveau dossier qui n'est pas celui de l'ancien projet :

```bash
git clone https://github.com/bozz33/-bozz-routeros.git bozz-routeros-cert-rc2
cd bozz-routeros-cert-rc2
git checkout --detach 9c7e539b6e7ad565165905ab514b29d674479608
test "$(git rev-parse HEAD)" = 9c7e539b6e7ad565165905ab514b29d674479608

docker build --pull --no-cache \
  --file certification/container/Dockerfile \
  --tag bozz-routeros-cert:rc2-9c7e539 \
  .

docker image inspect bozz-routeros-cert:rc2-9c7e539 \
  > /var/lib/bozz-routeros-cert/rc2/image-inspect.json

docker run --rm --network none bozz-routeros-cert:rc2-9c7e539 \
  | tee /var/lib/bozz-routeros-cert/rc2/software-gate.log
```

Le gate logiciel doit produire 47/47 tests génériques, 5/5 stress, un build,
un package/consumer smoke et `status=PASS` avec le SHA candidat exact.

### Reprise après le diagnostic `.dead=true`

Le précédent tooling `9f831ded…` a correctement exécuté A, C et le soak D,
car leurs critères de réussite ne dépendent pas du prédicat `.dead`. Si le
conteneur 24 h est toujours continu, ne pas l'arrêter ni fabriquer un nouveau
départ : conserver son ID/image et sa preuve brute. Son sous-compteur `dead`
peut être sous-évalué, mais les compteurs `re`, tags, queues, diagnostics,
durée et mesures mémoire restent les critères du soak et sont inchangés.

En revanche, l'ancien E est uniquement un diagnostic `BLOCKED`, et F n'a pas
été exécuté. Rebuilder obligatoirement l'image depuis `9c7e539…`, vérifier son
gate logiciel, puis rejouer E et F. Ne jamais modifier le tooling dans le
checkout opérateur et ne jamais présenter le diagnostic comme une preuve PASS.

## B. Préparation sûre du routeur physique personnel

Depuis une console d'administration existante, avec l'accord de l'opérateur :

1. relever `/system resource print` et confirmer `7.24.1 (stable)` ;
2. confirmer le chemin privé entre le VPS et le routeur ;
3. créer un groupe/API temporaire `read,api` pour tous les tests passifs ;
4. limiter le champ `address` de cet utilisateur à l'adresse source du VPS ;
5. préparer un compte HotSpot dédié, par exemple `BOZZ-RC2-LAB`, que
   l'opérateur peut connecter physiquement ;
6. ne créer le compte API temporaire `read,write,api` qu'au dernier moment,
   uniquement pour `active/remove`, limité lui aussi à l'adresse du VPS ;
7. ne jamais réutiliser l'identifiant API de l'ancien projet.

Gabarit RouterOS sans secret, à adapter uniquement après confirmation de
l'adresse source exacte du VPS :

```routeros
/user group add name=bozz-cert-read policy=read,api
/user add name=bozz-cert-read group=bozz-cert-read address=<VPS_SOURCE_IP>/32

/user group add name=bozz-cert-remove policy=read,write,api
/user add name=bozz-cert-remove group=bozz-cert-remove address=<VPS_SOURCE_IP>/32 disabled=yes
```

Définir les mots de passe depuis une interface/console protégée, hors capture,
puis n'activer `bozz-cert-remove` que pour l'étape F. Si un objet de même nom
existe déjà, ne pas l'écraser : choisir un nom neuf et le consigner.

Ne pas ajouter `policy`, `sensitive` ou `reboot` aux groupes de certification.
Ne pas changer globalement `/ip service`, le firewall ou le service HotSpot si
cela peut affecter l'ancien projet. En cas d'incertitude, arrêter.

Le premier gate doit confirmer `7.24.1 (stable)`. Si le routeur personnel est
sur une autre version, arrêter avec `BLOCKED` et demander une décision de
maintenance à l'opérateur. Ne pas continuer sur TANDA et ne pas mettre à jour
le routeur sans accord explicite séparé.

## C. Premier gate passif sur le Wi-Fi personnel et sélection de la route

Exporter seulement les paramètres non secrets dans le terminal du VPS :

```bash
export ROUTEROS_HOST='<adresse-privee-du-routeur>'
export ROUTEROS_PORT=8728
export ROUTEROS_USERNAME='<api-cert-readonly>'
```

Fournir le mot de passe par l'entrée standard et non dans la commande :

```bash
read -r -s -p 'Mot de passe API read-only: ' CERT_PASSWORD; echo
printf '%s\n' "$CERT_PASSWORD" | docker run --rm -i --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e ROUTEROS_HOST -e ROUTEROS_PORT -e ROUTEROS_USERNAME \
  --entrypoint sh bozz-routeros-cert:rc2-9c7e539 \
  certification/container/run-conformance.sh \
  | tee /var/lib/bozz-routeros-cert/rc2/physical-conformance.tap
unset CERT_PASSWORD
```

Répéter avec le harness HotSpot passif :

```bash
read -r -s -p 'Mot de passe API read-only: ' CERT_PASSWORD; echo
printf '%s\n' "$CERT_PASSWORD" | docker run --rm -i --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e ROUTEROS_HOST -e ROUTEROS_PORT -e ROUTEROS_USERNAME \
  --entrypoint sh bozz-routeros-cert:rc2-9c7e539 \
  certification/tanda/run.sh passive \
  | tee /var/lib/bozz-routeros-cert/rc2/physical-passive.jsonl
unset CERT_PASSWORD
```

Exiger 4 tests de conformance réussis, `emptyActive=true`, `emptyUsers=true`,
deux listeners annulés, zéro pending tag et tous les diagnostics à zéro.

Exiger également `routerOSVersion=7.24.1 (stable)`. Sinon, rendre `BLOCKED` et
ne pas poursuivre les autres gates physiques.

## D. Soak physique 24 heures sur le VPS personnel

Le soak est uniquement `print/listen/cancel` et ne déconnecte personne ni ne
modifie un compte/session. Pour résister à une coupure SSH, l'exécuter dans un
conteneur détaché avec un secret temporaire monté en lecture seule depuis
`/run` (RAM), puis retirer immédiatement son chemin hôte après le démarrage.

```bash
export ROUTEROS_SOAK_SECONDS=86400
export ROUTEROS_SOAK_SAMPLE_SECONDS=60
export CERT_SECRET_FILE=/run/bozz-routeros-cert-rc2-password

sudo bash -c 'umask 077; read -r -s -p "Mot de passe API read-only: " p; echo; printf "%s\n" "$p" > /run/bozz-routeros-cert-rc2-password; unset p'

docker run -d --name bozz-routeros-cert-rc2-physical-soak24h \
  --network host --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 256m --pids-limit 128 \
  --mount type=bind,src="$CERT_SECRET_FILE",dst=/run/secrets/routeros-password,readonly \
  -e ROUTEROS_HOST -e ROUTEROS_PORT -e ROUTEROS_USERNAME \
  -e ROUTEROS_SOAK_SECONDS -e ROUTEROS_SOAK_SAMPLE_SECONDS \
  -e ROUTEROS_PASSWORD_FILE=/run/secrets/routeros-password \
  --entrypoint sh bozz-routeros-cert:rc2-9c7e539 \
  certification/tanda/run.sh soak

for attempt in $(seq 1 60); do
  if docker logs bozz-routeros-cert-rc2-physical-soak24h 2>&1 \
    | grep -q '"type":"soak-start"'; then
    break
  fi
  sleep 1
done
docker logs --tail 5 bozz-routeros-cert-rc2-physical-soak24h \
  | grep '"type":"soak-start"'
sudo unlink "$CERT_SECRET_FILE"
unset CERT_SECRET_FILE
```

Ne retirer le chemin secret qu'après la présence de `soak-start`. Attendre la
fin sans supprimer le conteneur :

```bash
docker wait bozz-routeros-cert-rc2-physical-soak24h
docker inspect bozz-routeros-cert-rc2-physical-soak24h \
  > /var/lib/bozz-routeros-cert/rc2/physical-soak-container-inspect.json
docker inspect bozz-routeros-cert-rc2-physical-soak24h \
  --format 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}} image={{.Image}}' \
  | tee /var/lib/bozz-routeros-cert/rc2/physical-soak-exit.txt
docker logs bozz-routeros-cert-rc2-physical-soak24h \
  > /var/lib/bozz-routeros-cert/rc2/physical-soak-24h.jsonl

sha256sum /var/lib/bozz-routeros-cert/rc2/physical-soak-24h.jsonl

docker run --rm --network none \
  -e CERT_EXPECTED_CANDIDATE=8a3cd500aa5013577ca1f8179c916dc7807cf392 \
  -e CERT_EXPECTED_DURATION_SECONDS=86400 \
  -v /var/lib/bozz-routeros-cert/rc2/physical-soak-24h.jsonl:/evidence/soak.jsonl:ro \
  --entrypoint node bozz-routeros-cert:rc2-9c7e539 \
  certification/evidence/validate-soak.mjs /evidence/soak.jsonl \
  | tee /var/lib/bozz-routeros-cert/rc2/physical-soak-validation.json
```

Exiger `exit=0`, `oom=false`, au moins 1439 échantillons, 86 400 secondes,
deux tags pendant le run, zéro tag/queue/diagnostic final et `status=PASS` du
validateur. Conserver le conteneur arrêté jusqu'au verdict final.

## E. Marqueur `.dead=true/yes` avec le client Wi-Fi physique

Utiliser uniquement `BOZZ-RC2-LAB`. L'opérateur doit pouvoir fermer sa propre
session. Le logout normal par la page HotSpot est préférable à une expiration.

```bash
export ROUTEROS_TEST_USER='BOZZ-RC2-LAB'
export ROUTEROS_DEAD_TIMEOUT_MS=300000

read -r -s -p 'Mot de passe API read-only: ' CERT_PASSWORD; echo
printf '%s\n' "$CERT_PASSWORD" | docker run --rm -i --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e ROUTEROS_HOST -e ROUTEROS_PORT -e ROUTEROS_USERNAME \
  -e ROUTEROS_TEST_USER -e ROUTEROS_DEAD_TIMEOUT_MS \
  --entrypoint sh bozz-routeros-cert:rc2-9c7e539 \
  certification/tanda/run.sh dead-watch \
  | tee /var/lib/bozz-routeros-cert/rc2/physical-dead-watch.jsonl
unset CERT_PASSWORD
```

Quand le watcher l'indique, connecter si nécessaire le client physique avec ce
compte, puis effectuer un logout HotSpot normal. Sur RouterOS 7.24.1, la valeur
observée sur le fil est `.dead=true`; le harness accepte également `yes` pour
compatibilité. Exiger un marqueur corrélé au `.id` exact, la valeur brute dans
le rapport, `status=PASS`, zéro pending tag et diagnostics propres.

## F. `active/remove` borné à la session personnelle

Cette étape est la seule écriture sur le routeur physique. Avant de l'exécuter :

- connecter physiquement `BOZZ-RC2-LAB` ;
- confirmer qu'il existe exactement un compte HotSpot portant ce nom ;
- confirmer qu'il existe exactement une session ACTIVE portant ce nom ;
- utiliser le compte API temporaire `read,write,api`, limité à l'IP du VPS ;
- obtenir l'accord immédiat de l'opérateur pour déconnecter cette session.

```bash
export ROUTEROS_USERNAME='<api-cert-active-remove-temporaire>'
export ROUTEROS_ALLOW_ACTIVE_REMOVE='I_UNDERSTAND_TEST_SESSION_ONLY'
export ROUTEROS_REMOVE_TIMEOUT_MS=30000

read -r -s -p 'Mot de passe API temporaire write: ' CERT_PASSWORD; echo
printf '%s\n' "$CERT_PASSWORD" | docker run --rm -i --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e ROUTEROS_HOST -e ROUTEROS_PORT -e ROUTEROS_USERNAME \
  -e ROUTEROS_TEST_USER -e ROUTEROS_ALLOW_ACTIVE_REMOVE \
  -e ROUTEROS_REMOVE_TIMEOUT_MS \
  --entrypoint sh bozz-routeros-cert:rc2-9c7e539 \
  certification/tanda/run.sh active-remove \
  | tee /var/lib/bozz-routeros-cert/rc2/physical-active-remove.jsonl
unset CERT_PASSWORD
```

Le harness doit refuser automatiquement zéro ou plusieurs sessions. Pour un
PASS, il doit prouver : suppression du seul `.id` ACTIVE, marqueur `.dead`
corrélé (`true` ou `yes`) et valeur brute consignée,
absence de session après l'action, compte HotSpot toujours présent et même
`.id`, zéro pending tag et diagnostics propres. L'opérateur reconnecte ensuite
le compte pour confirmer le fonctionnement, puis se déconnecte normalement.
Enfin, désactiver/supprimer uniquement l'utilisateur API write temporaire et
son groupe temporaire, après vérification qu'ils ne sont utilisés nulle part.

## G. CHR 7.24.1 local sous QEMU/KVM

Le CHR n'est pas un conteneur. Il doit être une VM complète sur un hôte Linux :

```bash
uname -a
lscpu | sed -n '/Virtualization/p'
test -c /dev/kvm
test -r /dev/kvm -a -w /dev/kvm
command -v qemu-system-x86_64 qemu-img curl unzip docker
```

Si `/dev/kvm` manque, arrêter. Ne pas émuler lentement et ne pas prétendre que
WSL/Hyper-V remplace ce gate. Demander l'accord avant d'installer QEMU.

Préparer une première archive officielle, transmettre son SHA-256 à
l'opérateur pour approbation, puis refaire la préparation dans un nouveau
dossier avec le digest épinglé :

```bash
export CHR_VERSION=7.24.1
sh certification/chr/prepare-image.sh ./.certification/chr-7.24.1-discovery

# Après approbation humaine du digest affiché :
export CHR_ARCHIVE_SHA256='<sha256-approuve>'
export CHR_WORKDIR=./.certification/chr-7.24.1-pinned
sh certification/chr/prepare-image.sh "$CHR_WORKDIR"
grep '^archive_verification=pinned-match$' "$CHR_WORKDIR/metadata.txt"
```

Démarrer le CHR dans un terminal dédié :

```bash
CHR_VERSION=7.24.1 sh certification/chr/run-qemu.sh "$CHR_WORKDIR"
```

Depuis la console CHR, changer immédiatement le mot de passe `admin`, activer
le DHCP sur `ether1`, créer un groupe `read,api` et l'utilisateur
`conformance`, puis limiter cet utilisateur à `10.0.2.2/32`. Activer seulement
l'API 8728 pour cette origine virtuelle. Aucun droit `write`, `policy`,
`sensitive` ou `reboot`. Ne jamais capturer les mots de passe.

Exécuter la conformance dans le conteneur, via le forward local 18728 :

```bash
export ROUTEROS_HOST=127.0.0.1
export ROUTEROS_PORT=18728
export ROUTEROS_USERNAME=conformance

read -r -s -p 'Mot de passe CHR conformance: ' CERT_PASSWORD; echo
printf '%s\n' "$CERT_PASSWORD" | docker run --rm -i --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e ROUTEROS_HOST -e ROUTEROS_PORT -e ROUTEROS_USERNAME \
  --entrypoint sh bozz-routeros-cert:rc2-9c7e539 \
  certification/container/run-conformance.sh \
  | tee /var/lib/bozz-routeros-cert/rc2/chr-conformance.tap
unset CERT_PASSWORD
```

## H. Coupure réseau CHR et reconnexion

Lancer le proxy de coupure local devant le CHR :

```bash
docker run -d --name bozz-routeros-cert-rc2-proxy --network host \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint node bozz-routeros-cert:rc2-9c7e539 \
  certification/chaos/tcp-cut-proxy.mjs
```

Dans un autre terminal, lancer la probe contre le proxy 28728 :

```bash
export ROUTEROS_PORT=28728
read -r -s -p 'Mot de passe CHR conformance: ' CERT_PASSWORD; echo
printf '%s\n' "$CERT_PASSWORD" | docker run --rm -i --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e ROUTEROS_HOST -e ROUTEROS_PORT -e ROUTEROS_USERNAME \
  -e ROUTEROS_RECONNECT_TIMEOUT_MS=180000 \
  --entrypoint sh bozz-routeros-cert:rc2-9c7e539 \
  certification/tanda/run.sh reconnect \
  | tee /var/lib/bozz-routeros-cert/rc2/chr-network-reconnect.jsonl
unset CERT_PASSWORD
```

Après `reconnect-probe-ready`, couper uniquement le proxy :

```bash
docker kill --signal USR1 bozz-routeros-cert-rc2-proxy
```

Attendre le PASS de la probe, puis seulement collecter et arrêter le proxy :

```bash
docker logs bozz-routeros-cert-rc2-proxy \
  > /var/lib/bozz-routeros-cert/rc2/chr-proxy.jsonl
docker stop bozz-routeros-cert-rc2-proxy
```

Exiger au moins un disconnect, deux online, une génération supérieure, une
lecture post-reconnect, zéro orphan et zéro erreur protocole.

## I. Reboot de la VM CHR et reconnexion

Relancer la probe dans un premier terminal, cette fois directement contre
`127.0.0.1:18728` :

```bash
export ROUTEROS_PORT=18728
read -r -s -p 'Mot de passe CHR conformance: ' CERT_PASSWORD; echo
printf '%s\n' "$CERT_PASSWORD" | docker run --rm -i --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e ROUTEROS_HOST -e ROUTEROS_PORT -e ROUTEROS_USERNAME \
  -e ROUTEROS_RECONNECT_TIMEOUT_MS=180000 \
  --entrypoint sh bozz-routeros-cert:rc2-9c7e539 \
  certification/tanda/run.sh reconnect \
  | tee /var/lib/bozz-routeros-cert/rc2/chr-reboot-reconnect.jsonl
unset CERT_PASSWORD
```

Après `reconnect-probe-ready`, envoyer depuis un second terminal un reset
uniquement au QMP local :

```bash
export ROUTEROS_PORT=18728

docker run --rm --network none \
  --mount type=bind,src="$(realpath "$CHR_WORKDIR")",dst=/chr \
  --entrypoint node bozz-routeros-cert:rc2-9c7e539 \
  certification/chr/qmp-control.mjs /chr/qmp.sock reset \
  | tee /var/lib/bozz-routeros-cert/rc2/chr-qmp-reset.jsonl
```

La probe doit produire les mêmes invariants de reconnexion et une lecture
RouterOS réussie après le reboot. Enregistrer sa sortie dans
`chr-reboot-reconnect.jsonl`. Ce reset ne cible que la VM CHR jetable.

## J. Verdict final

Calculer les SHA-256 de toutes les preuves et produire un tableau contenant :

- software/container ;
- physique conformance/passif ;
- physique soak 24 h ;
- physique marqueur `.dead=true/yes` ;
- physique `active/remove` et compte préservé ;
- CHR conformance ;
- CHR coupure/reconnexion ;
- CHR reboot/reconnexion ;
- secrets absents ;
- ancien projet/VPS/TANDA inchangés.

Un seul FAIL ou BLOCKED interdit le verdict de certification complète. Même si
tout passe, ne pas publier : remettre les preuves au responsable du dépôt pour
audit final et décision séparée de tag/release/npm.
