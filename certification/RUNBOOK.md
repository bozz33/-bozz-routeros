# RC2 certification runbook

Candidate: `8a3cd500aa5013577ca1f8179c916dc7807cf392`

Certification tooling: branch `cert/rc2`

Public tarball SHA-256: `343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5`

## Execution map

| Gate | Execution host | Target | Production impact |
| --- | --- | --- | --- |
| software/container | GitHub Actions or Docker host | no RouterOS | none |
| TANDA passive + 24 h soak | existing certification VPS with WireGuard | `TANDAPHARMA` | read/listen only |
| CHR conformance/reconnect/reboot | KVM host exposing `/dev/kvm` | disposable CHR 7.24.1 | none |
| physical `.dead=yes` | certification VPS + physical LAB client | dedicated LAB HotSpot user | LAB session only |
| physical `active/remove` | certification VPS + physical LAB client | exactly one named LAB session | disconnects LAB session only |

The current ChatGPT workspace and the previously audited VPS without `/dev/kvm` cannot execute CHR. A TANDA reboot is excluded and requires a separate approved maintenance window.

## 1. Build the immutable certification image

On each Docker-capable certification host:

```bash
git clone https://github.com/bozz33/-bozz-routeros.git /opt/bozz-routeros-cert-rc2
cd /opt/bozz-routeros-cert-rc2
git checkout --detach 94d31d33b47b362c0e8755a97974d3315507871f

docker build --pull --no-cache \
  --file certification/container/Dockerfile \
  --tag bozz-routeros-cert:rc2 \
  .

docker run --rm --network none bozz-routeros-cert:rc2
```

Record the resulting image ID. Do not reuse an image whose ID was not recorded with the evidence.

## 2. TANDA passive RC2 gate

Run on the existing VPS that already reaches TANDA through WireGuard. `secret-command` represents the configured secret-store command that writes exactly one password line to stdout.

```bash
export ROUTEROS_HOST='<tanda-private-address>'
export ROUTEROS_USERNAME='<certification-read-user>'
export ROUTEROS_PORT=8728

secret-command | docker run --rm -i --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e ROUTEROS_HOST -e ROUTEROS_USERNAME -e ROUTEROS_PORT \
  --entrypoint sh bozz-routeros-cert:rc2 \
  certification/tanda/run.sh passive
```

Accept only a JSON result with `status=PASS`, the RC2 candidate SHA, zero pending tags, and zero diagnostics.

## 3. TANDA 24-hour soak

Create an evidence directory owned by the certification operator, then run the same immutable image for 86,400 seconds. Keep the foreground pipeline under the VPS service manager or an existing protected terminal multiplexer so an SSH disconnect cannot terminate it.

For a detached container, mount a short-lived, mode-`0400` password file from a
RAM-backed host directory and set `ROUTEROS_PASSWORD_FILE` to its container
path. Remove the host pathname immediately after Docker has mounted it. Never
put the secret in an environment variable, command argument, image, Git, or
evidence file.

```bash
install -d -m 0700 /var/lib/bozz-routeros-cert/rc2

export ROUTEROS_HOST='<tanda-private-address>'
export ROUTEROS_USERNAME='<certification-read-user>'
export ROUTEROS_PORT=8728
export ROUTEROS_SOAK_SECONDS=86400
export ROUTEROS_SOAK_SAMPLE_SECONDS=60

secret-command | docker run --name bozz-routeros-cert-rc2-soak24h -i --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 256m --pids-limit 128 \
  -e ROUTEROS_HOST -e ROUTEROS_USERNAME -e ROUTEROS_PORT \
  -e ROUTEROS_SOAK_SECONDS -e ROUTEROS_SOAK_SAMPLE_SECONDS \
  --entrypoint sh bozz-routeros-cert:rc2 \
  certification/tanda/run.sh soak \
  > /var/lib/bozz-routeros-cert/rc2/tanda-soak-24h.jsonl
```

After completion:

```bash
docker inspect bozz-routeros-cert-rc2-soak24h \
  --format 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}} image={{.Image}}'

sha256sum /var/lib/bozz-routeros-cert/rc2/tanda-soak-24h.jsonl

docker run --rm --network none \
  -e CERT_EXPECTED_CANDIDATE=8a3cd500aa5013577ca1f8179c916dc7807cf392 \
  -e CERT_EXPECTED_DURATION_SECONDS=86400 \
  -v /var/lib/bozz-routeros-cert/rc2/tanda-soak-24h.jsonl:/evidence/soak.jsonl:ro \
  --entrypoint node bozz-routeros-cert:rc2 \
  certification/evidence/validate-soak.mjs /evidence/soak.jsonl
```

Do not delete the stopped container or raw JSONL until the final certification report records their identities and hashes.

## 4. CHR 7.24.1

Run only on a Linux host exposing `/dev/kvm` with QEMU tools installed.

```bash
cd /opt/bozz-routeros-cert-rc2
export CHR_VERSION=7.24.1
export CHR_ARCHIVE_SHA256='<independently-approved-archive-sha256>'
sh certification/chr/prepare-image.sh
sh certification/chr/run-qemu.sh
```

Secure the disposable VM from its console and create a read-only `api` account as documented in `certification/chr/README.md`. Then run the public conformance harness against host port `18728`.

For the network interruption gate, start `certification/tanda/run.sh reconnect` and interrupt only the dedicated CHR API path from the certification client. Restore it before the configured timeout and require a disconnect, a higher generation, a second online event, and a successful post-reconnect read.

For the reboot gate, repeat the probe and reboot only the disposable CHR VM from its console/hypervisor. Never use TANDA for this gate.

## 5. Physical LAB gates

Use a dedicated account such as `BOZZ-RC2-LAB`. It must not belong to a customer.

Start `.dead=yes` observation before logging the LAB device in and out:

```bash
export ROUTEROS_TEST_USER='BOZZ-RC2-LAB'
secret-command | docker run --rm -i --network host \
  -e ROUTEROS_HOST -e ROUTEROS_USERNAME -e ROUTEROS_PORT -e ROUTEROS_TEST_USER \
  --entrypoint sh bozz-routeros-cert:rc2 \
  certification/tanda/run.sh dead-watch
```

For `active/remove`, first verify that exactly one session for that LAB user is active. The harness refuses every other scope:

```bash
export ROUTEROS_ALLOW_ACTIVE_REMOVE='I_UNDERSTAND_TEST_SESSION_ONLY'
secret-command | docker run --rm -i --network host \
  -e ROUTEROS_HOST -e ROUTEROS_USERNAME -e ROUTEROS_PORT \
  -e ROUTEROS_TEST_USER -e ROUTEROS_ALLOW_ACTIVE_REMOVE \
  --entrypoint sh bozz-routeros-cert:rc2 \
  certification/tanda/run.sh active-remove
```

The result must prove the exact active `.id` emitted `.dead=yes`, disappeared from ACTIVE, and left the HotSpot user account intact.

## 6. Stable release decision

`0.1.0-rc.2` may be distributed as a prerelease after the immutable software/container gate. Stable `0.1.0` remains blocked until the TANDA 24-hour soak, CHR conformance/reconnect/reboot, and both physical LAB gates pass with preserved evidence.
