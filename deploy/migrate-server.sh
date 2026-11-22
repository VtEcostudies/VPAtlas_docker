#!/bin/bash
#
# migrate-server.sh — Move vpatlas.org from the Ubuntu 20.04 EC2 host to a
# fresh EC2 instance running the current Ubuntu LTS (default 26.04).
#
# Why a new instance instead of do-release-upgrade:
#   20.04 → 26.04 in place is three back-to-back release upgrades
#   (20.04 → 22.04 → 24.04 → 26.04), each with a reboot and its own
#   breakage risk, and the only rollback is restoring a snapshot. A
#   side-by-side instance can be rehearsed as often as needed while the
#   old box keeps serving. Cutover is a quick Elastic IP move, and rolling
#   back means moving the IP back.
#
# Runs from your local machine, like deploy-prod.sh. Every step that writes
# to the OLD host (vpatlas.org) or moves traffic asks you to type YES first.
#
# ── Runbook ────────────────────────────────────────────────────────────────
#   1. ./deploy/migrate-server.sh inventory      # read-only survey of old host → ~/vpatlas_migrate/
#   2. ./deploy/migrate-server.sh snapshot-old   # AMI of old host (no reboot) — insurance
#   3. ./deploy/migrate-server.sh launch         # new EC2 instance mirroring old (type/SG/subnet/IAM/key)
#      — or launch in the console, then:  ./deploy/migrate-server.sh set-new-ip <public-ip>
#   4. ./deploy/migrate-server.sh provision      # docker, nginx, certbot, awscli, swap, tz on new host
#   5. ./deploy/migrate-server.sh clone          # git clone prod (+ dev) working dirs on new host
#   6. ./deploy/migrate-server.sh copy-config    # .env files, backup conf, ~/.aws, nginx vhosts, letsencrypt
#   7. ./deploy/migrate-server.sh copy-data      # photos + DB dumps → new host, build + start stacks (REHEARSAL, repeatable)
#   8. ./deploy/migrate-server.sh verify         # row-count diff old vs new + HTTPS checks against new IP
#      … test the new host in a browser by pointing /etc/hosts at the new IP …
#   9. ./deploy/migrate-server.sh cutover        # freeze old API, final data sync, move Elastic IP, install cron
#  10. ./deploy/migrate-server.sh rollback       # (only if needed) move IP back, restart old API
#
# Config (env vars, all optional):
#   UBUNTU_VERSION=26.04          target Ubuntu LTS
#   NEW_INSTANCE_TYPE=<type>      default: same as old instance
#   NEW_ROOT_SIZE=<GiB>           root EBS size; default: same as old (291). e.g. 100
#   MIGRATE_REF=<git ref>         check out this instead of the old host's live commit (e.g. origin/main)
#   MIGRATE_DEV=0                 1 = also migrate the dev.vpatlas.org stack (must be running on old host)
#   PROD_DIR / DEV_DIR            remote working dirs (defaults below)
#   NEW_IP                        set if you launched the instance by hand
#
# Console route (no EC2 API rights needed locally): do snapshot-old + launch in
# the EC2 console, register the instance with set-new-ip, run 4–9 from here, and
# cutover pauses for you to move the Elastic IP in the console. The new instance
# needs NO IAM role — backups use the ~/.aws keys that copy-config carries over.
#
# Facts from the 2026-11-21 inventory:
#   • Old host is in us-west-2 (Oregon) — pick that region in the console.
#   • vpatlas.org has NO Elastic IP: its public IP (44.234.147.110) is the
#     instance's auto-assigned one, so cutover = editing DNS A records (Google
#     Cloud DNS, ns-cloud-e*.googledomains.com). Lower TTLs to 300 s at least a
#     day ahead — vpatlas.org is 14400 s (4 h), the rest 1800 s.
#   • Do NOT stop the old instance until you're done with it: stopping releases
#     44.234.147.110 for good, and DNS-based rollback depends on it.
#   • Give the NEW instance an Elastic IP right after launch (Elastic IPs →
#     Allocate → Associate), then run set-new-ip with that address. Otherwise
#     any future stop/start changes its IP and takes the site down. Since AWS
#     bills every public IPv4 the same, it costs nothing extra.
#
# State (instance ids, new IP) is kept in ~/vpatlas_migrate/state, outside git.
#
set -euo pipefail

SSH_KEY="${SSH_KEY:-/home/jloomis/.ssh/vpatlas_aws_key_pair.pem}"
OLD_HOST="${OLD_HOST:-ubuntu@vpatlas.org}"
PROD_DIR="${PROD_DIR:-/home/ubuntu/VPAtlas_docker_production}"
DEV_DIR="${DEV_DIR:-/home/ubuntu/VPAtlas_docker_developement}"   # sic — that is the real dir name on the host
GIT_REPO="https://github.com/VtEcostudies/VPAtlas_docker.git"
UBUNTU_VERSION="${UBUNTU_VERSION:-26.04}"
MIGRATE_DEV="${MIGRATE_DEV:-0}"   # dev stack was not running at 2026-11-21 inventory
AWS_REGION="${AWS_REGION:-us-west-2}"   # EC2 region of the vpatlas host (S3 bucket region is set in ~/.vpatlas_backup.conf)
export AWS_DEFAULT_REGION="$AWS_REGION"

PROD_COMPOSE="docker compose -f docker-compose-vpatlas.yml -f docker-compose-prod.yml"
DEV_COMPOSE="docker compose -f docker-compose-vpatlas.yml -f docker-compose-dev.yml"
# A records to move at cutover. www.vpatlas.org is unused (never served, no cert) — not migrated.
DOMAINS=(vpatlas.org api.vpatlas.org dev.vpatlas.org api.dev.vpatlas.org)
DNS_MAX_TTL=600

MIGRATE_DIR="$HOME/vpatlas_migrate"
STATE_FILE="$MIGRATE_DIR/state"
mkdir -p "$MIGRATE_DIR"
chmod 700 "$MIGRATE_DIR"
# shellcheck disable=SC1090
[ -f "$STATE_FILE" ] && source "$STATE_FILE"

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
old() { ssh "${SSH_OPTS[@]}" "$OLD_HOST" "$@"; }
new() {
    [ -n "${NEW_IP:-}" ] || { echo "NEW_IP unknown — run 'launch' first or export NEW_IP=…" >&2; exit 1; }
    ssh "${SSH_OPTS[@]}" "ubuntu@$NEW_IP" "$@"
}
save_state() {  # save_state KEY VALUE
    touch "$STATE_FILE"
    grep -v "^$1=" "$STATE_FILE" > "$STATE_FILE.tmp" || true
    echo "$1=$2" >> "$STATE_FILE.tmp"
    mv "$STATE_FILE.tmp" "$STATE_FILE"
    export "$1=$2"
}
confirm() {
    echo ""
    read -r -p "$1  Type YES to proceed: " ans
    [ "$ans" = "YES" ] || { echo "Aborted."; exit 1; }
}
# Stacks to migrate: "dir|compose|db_container". Iterated with for-loops, not
# `while read`, because ssh inside a while-read loop swallows the loop's stdin.
STACKS=("$PROD_DIR|$PROD_COMPOSE|db_vp_prod")
[ "$MIGRATE_DEV" = "1" ] && STACKS+=("$DEV_DIR|$DEV_COMPOSE|db_vp")

# Can the local AWS identity use the EC2 API? If not, the AWS-side steps
# (snapshot, launch, Elastic IP move) are done by hand in the EC2 console and
# everything else still runs from here.
ec2_api_ok() { aws ec2 describe-addresses --max-items 1 >/dev/null 2>&1; }
require_ec2() {
    ec2_api_ok && return 0
    echo "Your local AWS identity can't use the EC2 API, so '$1' can't run from here." >&2
    echo "Do it in the EC2 console instead (see 'Console route' at the top of this script)." >&2
    exit 1
}
ensure_old_ids() {  # sets OLD_IP (+ OLD_INSTANCE_ID when the EC2 API is usable); cached in state
    if [ -z "${OLD_IP:-}" ]; then
        save_state OLD_IP "$(dig +short vpatlas.org | tail -1)"
    fi
    if [ -z "${OLD_INSTANCE_ID:-}" ] && ec2_api_ok; then
        local id; id=$(aws ec2 describe-instances --filters "Name=ip-address,Values=$OLD_IP" \
            --query 'Reservations[0].Instances[0].InstanceId' --output text)
        [ "$id" != "None" ] && [ -n "$id" ] && save_state OLD_INSTANCE_ID "$id"
    fi
    OLD_INSTANCE_ID="${OLD_INSTANCE_ID:-old instance}"
}
check_dns_ttls() {  # warn if any record's authoritative TTL would make cutover/rollback slow
    local ns h ttl slow=0
    ns=$(dig +short NS vpatlas.org | head -1)
    echo "→ authoritative TTLs ($ns):"
    for h in "${DOMAINS[@]}"; do
        ttl=$(dig @"$ns" +noall +answer "$h" A | awk '{print $2; exit}')
        printf '    %-22s %6ss\n' "$h" "${ttl:-?}"
        [ -n "$ttl" ] && [ "$ttl" -gt "$DNS_MAX_TTL" ] && slow=1
    done
    if [ $slow = 1 ]; then
        echo "  ⚠ TTLs above ${DNS_MAX_TTL}s: some visitors keep hitting the OLD host (API stopped)"
        echo "    for up to that long after the DNS change. Lower them to 300 and wait out the old TTL first."
        confirm "Proceed with slow TTLs anyway?"
    fi
}
# Which box does vpatlas.org currently land on? Each EC2 instance has a distinct
# hostname (ip-172-…), and after cutover the SSH host keys match, so this is the
# reliable way to tell old from new.
wait_for_vpatlas_on() {  # wait_for_vpatlas_on <hostname> <label>
    echo "→ waiting for vpatlas.org to reach the $2 host ($1)…"
    for _ in $(seq 1 60); do
        [ "$(ssh "${SSH_OPTS[@]}" -o ConnectTimeout=5 "$OLD_HOST" hostname 2>/dev/null)" = "$1" ] && { echo "  ✓ vpatlas.org → $2 host"; return 0; }
        sleep 10
    done
    echo "  ⚠ still not on the $2 host after 10 min (DNS propagation?). Re-check by hand: ssh vpatlas.org hostname"
    confirm "Continue anyway?"
}
# After cutover, vpatlas.org (OLD_HOST) IS the new box. Re-running a copy step
# then would dump the new DB into itself — refuse.
guard_precutover() {
    [ "${CUTOVER_DONE:-0}" != "1" ] || { echo "Cutover already done — '$1' would read from the NEW host. Refusing." >&2; exit 1; }
}
# Pin a new-host checkout to the exact commit live on the old host, so the
# migration doesn't double as an unreviewed deploy of whatever is on main.
# MIGRATE_REF overrides the pin (e.g. origin/main when a build fix had to land
# for the new host); every file that differs from what's live is listed so the
# difference is visible, never silent.
sync_commit() {
    local dir="$1" sha target
    sha=$(old "git -C '$dir' rev-parse HEAD")
    target="${MIGRATE_REF:-$sha}"
    new "git -C '$dir' fetch -q origin && git -C '$dir' checkout -q main && git -C '$dir' reset -q --hard $target"
    if [ -n "${MIGRATE_REF:-}" ]; then
        echo "→ $dir at $MIGRATE_REF ($(new "git -C '$dir' rev-parse --short HEAD")); differs from live ${sha:0:7} in:"
        new "git -C '$dir' diff --stat $sha HEAD" | sed 's/^/    /'
    else
        echo "→ $dir pinned to old host's commit ${sha:0:7}"
    fi
}

# ─── DB copy: globals (roles incl. pgfs_reader) + full DB, old container → new ───
# Roles are cluster-level, so a plain pg_dump would drop pgfs_reader and the
# migration that creates it would not re-run (schema_migrations comes across
# in the dump). Hence pg_dumpall --globals-only first.
copy_db() {
    local dir="$1" compose="$2" c="$3"
    # Readiness is checked over TCP: on a fresh data dir the image's entrypoint
    # first runs a socket-only temporary server for initdb, then restarts —
    # a socket pg_isready passes during that window and the next psql fails.
    echo "→ [$c] starting db container on new host"
    new "cd '$dir' && $compose up -d --build db_vp && \
         until docker exec $c pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done"
    new "cd '$dir' && $compose stop api_vp ogc_vp 2>/dev/null || true"

    echo "→ [$c] roles (errors like 'role \"postgres\" already exists' are expected)"
    old "docker exec $c pg_dumpall -U postgres --globals-only" \
      | new "docker exec -i $c psql -U postgres -d postgres -q" 2>&1 | grep -v 'already exists' || true

    echo "→ [$c] recreating vpatlas database"
    new "docker exec $c psql -U postgres -d postgres -q \
           -c 'DROP DATABASE IF EXISTS vpatlas WITH (FORCE);' \
           -c 'CREATE DATABASE vpatlas TEMPLATE template0;'"

    echo "→ [$c] streaming pg_dump old → pg_restore new"
    local log="$MIGRATE_DIR/restore_${c}_$(date +%Y%m%d_%H%M%S).log"
    old "docker exec $c pg_dump -U postgres -Fc vpatlas" \
      | new "docker exec -i $c pg_restore -U postgres -d vpatlas" > "$log" 2>&1 || true
    if [ -s "$log" ]; then
        echo "  pg_restore reported messages — review $log:"
        tail -5 "$log" | sed 's/^/    /'
    else
        echo "  ✓ restore clean"
    fi
}

copy_photos() {
    local dir="$1"
    old "[ -d '$dir/photo_data' ]" || { echo "→ no photo_data in $dir on old host, skipping"; return 0; }
    echo "→ photos: $dir/photo_data"
    old "sudo tar czf - -C '$dir' --numeric-owner photo_data" \
      | new "mkdir -p '$dir' && sudo tar xzf - -C '$dir' --numeric-owner && sudo chown -R 1001:1001 '$dir/photo_data'"
}

COUNT_SQL="SELECT format('SELECT %L, count(*) FROM %I.%I', schemaname||'.'||relname, schemaname, relname)
           FROM pg_stat_user_tables ORDER BY 1 \\gexec"
row_counts() {  # row_counts old|new container
    echo "$COUNT_SQL" | "$1" "docker exec -i $2 psql -U postgres -d vpatlas -At -F ' '"
}

case "${1:-help}" in

# ─── 1. Read-only inventory of the old host ───
inventory)
    out="$MIGRATE_DIR/inventory_$(date +%Y%m%d_%H%M%S).txt"
    echo "=== Inventory of $OLD_HOST (read-only) → $out ==="
    old 'bash -s' > "$out" 2>&1 <<'EOF' || true
s() { echo; echo "════ $* ════"; }
s OS;            lsb_release -ds; uname -m; uptime; nproc; free -h; swapon --show
s DISK;          df -h -x tmpfs -x squashfs -x overlay
s TIMEZONE;      timedatectl show -p Timezone --value
s DOCKER;        docker version --format 'engine {{.Server.Version}}'; docker compose version 2>/dev/null; docker-compose version 2>/dev/null | head -1
s CONTAINERS;    docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
s VOLUMES;       docker volume ls
s HOME_DIRS;     ls -la /home/ubuntu
for d in /home/ubuntu/VPAtlas*; do
  [ -d "$d/.git" ] || continue
  s "REPO $d"
  (cd "$d" && git log -1 --oneline && git status --short | head -20)
  [ -e "$d/.env" ] && { echo ".env keys:"; cut -d= -f1 "$d/.env" | grep -v '^#' | sed 's/^/  /'; } || echo "no .env"
  sudo du -sh "$d"/photo_data "$d"/db_data_vp "$d"/db_backup 2>/dev/null
done
s HOME_CONFIG;   ls -la ~/.vpatlas_backup.conf ~/.aws 2>&1
s IAM_PROFILE;   T=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60'); \
                 curl -s -H "X-aws-ec2-metadata-token: $T" http://169.254.169.254/latest/meta-data/iam/info; echo
s NGINX_ENABLED; ls -l /etc/nginx/sites-enabled/
s NGINX_TEST;    sudo nginx -t 2>&1
s CERTS;         sudo certbot certificates 2>&1 | grep -E 'Certificate Name|Domains|Expiry'
s CRON_UBUNTU;   crontab -l 2>&1
s CRON_ROOT;     sudo crontab -l 2>&1
s CRON_D;        ls /etc/cron.d
s LISTENING;     sudo ss -tlnp
s HOST_POSTGRES; systemctl is-active postgresql 2>&1; sudo -u postgres psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -v '^\s*$'
s PM2;           command -v pm2 && pm2 list 2>&1 || echo "no pm2"
s SERVICES;      systemctl list-units --type=service --state=running --no-legend --no-pager | awk '{print $1}'
EOF
    echo "Saved. Skim it for anything this script doesn't cover (extra cron jobs, host"
    echo "services, a legacy host Postgres you want archived before the old box is gone)."
    ensure_old_ids
    echo ""
    echo "Old instance: $OLD_INSTANCE_ID ($OLD_IP)"
    ec2_api_ok || { echo "(no EC2 API access locally — check Elastic IPs in the console)"; exit 0; }
    aws ec2 describe-addresses --filters "Name=public-ip,Values=$OLD_IP" \
        --query 'Addresses[0].AllocationId' --output text | grep -q '^eipalloc-' \
        && echo "✓ vpatlas.org is an Elastic IP — cutover will be an IP move." \
        || echo "⚠ vpatlas.org is NOT an Elastic IP — cutover will need DNS changes (lower TTLs now)."
    ;;

# ─── 2. AMI of the old host (insurance; no reboot) ───
snapshot-old)
    require_ec2 snapshot-old
    ensure_old_ids; id=$OLD_INSTANCE_ID
    name="vpatlas-ubuntu2004-final-$(date +%Y%m%d-%H%M)"
    echo "Creating AMI '$name' from $id (--no-reboot; prod keeps serving)."
    confirm "This creates an AMI + EBS snapshots (small ongoing storage cost)."
    aws ec2 create-image --instance-id "$id" --name "$name" --no-reboot \
        --description "VPAtlas host before Ubuntu migration" --query ImageId --output text
    ;;

# ─── 3. Launch the new instance, mirroring the old one ───
launch)
    require_ec2 launch
    [ -n "${NEW_INSTANCE_ID:-}" ] && { echo "Already launched: $NEW_INSTANCE_ID ($NEW_IP). Delete $STATE_FILE entries to relaunch."; exit 1; }
    ensure_old_ids; id=$OLD_INSTANCE_ID
    read -r itype key subnet arch profile rootdev < <(aws ec2 describe-instances --instance-ids "$id" \
        --query 'Reservations[0].Instances[0].[InstanceType,KeyName,SubnetId,Architecture,IamInstanceProfile.Arn,RootDeviceName]' \
        --output text)
    sgs=$(aws ec2 describe-instances --instance-ids "$id" \
        --query 'Reservations[0].Instances[0].SecurityGroups[].GroupId' --output text)
    rootvol=$(aws ec2 describe-instances --instance-ids "$id" \
        --query "Reservations[0].Instances[0].BlockDeviceMappings[?DeviceName=='$rootdev'].Ebs.VolumeId" --output text)
    rootsize=$(aws ec2 describe-volumes --volume-ids "$rootvol" --query 'Volumes[0].Size' --output text)
    amiarch=$([ "$arch" = "arm64" ] && echo arm64 || echo amd64)
    ami=$(aws ssm get-parameter \
        --name "/aws/service/canonical/ubuntu/server/$UBUNTU_VERSION/stable/current/$amiarch/hvm/ebs-gp3/ami-id" \
        --query Parameter.Value --output text)
    read -r newroot amimin < <(aws ec2 describe-images --image-ids "$ami" \
        --query 'Images[0].[RootDeviceName,BlockDeviceMappings[0].Ebs.VolumeSize]' --output text)
    itype="${NEW_INSTANCE_TYPE:-$itype}"

    # Root volume: default mirrors the old disk; NEW_ROOT_SIZE shrinks it.
    # EBS can be grown later in place but never shrunk, so err on the small side
    # only as far as the data needs (prod DB + photos ≈ 1.6 GB at 2026-11-21;
    # the old 76 GB used is mostly local backup files that live in S3).
    oldrootsize="$rootsize"
    rootsize="${NEW_ROOT_SIZE:-$oldrootsize}"
    [[ "$rootsize" =~ ^[0-9]+$ ]] || { echo "NEW_ROOT_SIZE must be a whole number of GiB (got '$rootsize')" >&2; exit 1; }
    if [ "$rootsize" -lt "$amimin" ]; then
        echo "NEW_ROOT_SIZE=$rootsize is smaller than the AMI's ${amimin} GiB minimum" >&2; exit 1
    fi
    [ "$rootsize" -lt 30 ] && echo "⚠ ${rootsize} GiB leaves little room for Docker images, build cache and nightly backups."

    echo "=== Launch plan ==="
    echo "  AMI:            $ami (Ubuntu $UBUNTU_VERSION $amiarch)"
    echo "  Instance type:  $itype"
    echo "  Key pair:       $key"
    echo "  Subnet:         $subnet"
    echo "  Security groups:$sgs"
    echo "  IAM profile:    ${profile/None/(none)}"
    echo "  Root volume:    ${rootsize} GiB gp3 (old host: ${oldrootsize} GiB)"
    confirm "Launch a new billable EC2 instance?"

    profile_arg=()
    [ "$profile" != "None" ] && profile_arg=(--iam-instance-profile "Arn=$profile")
    # shellcheck disable=SC2086
    new_id=$(aws ec2 run-instances --image-id "$ami" --instance-type "$itype" --key-name "$key" \
        --subnet-id "$subnet" --security-group-ids $sgs --associate-public-ip-address \
        "${profile_arg[@]}" \
        --block-device-mappings "DeviceName=$newroot,Ebs={VolumeSize=$rootsize,VolumeType=gp3,DeleteOnTermination=true}" \
        --metadata-options HttpTokens=required,HttpEndpoint=enabled \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=vpatlas-ubuntu-$UBUNTU_VERSION}]" \
        --query 'Instances[0].InstanceId' --output text)
    save_state NEW_INSTANCE_ID "$new_id"
    echo "Waiting for $new_id to run…"
    aws ec2 wait instance-running --instance-ids "$new_id"
    ip=$(aws ec2 describe-instances --instance-ids "$new_id" \
        --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
    save_state NEW_IP "$ip"
    echo "Waiting for SSH on $ip…"
    until ssh "${SSH_OPTS[@]}" -o ConnectTimeout=5 "ubuntu@$ip" true 2>/dev/null; do sleep 5; done
    echo "✓ New instance $new_id at $ip.  Next: $0 provision"
    ;;

# ─── 3b. Register an instance launched in the EC2 console ───
set-new-ip)
    ip="${2:-}"
    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Usage: $0 set-new-ip <public-ipv4> [instance-id]" >&2; exit 1; }
    [ "$ip" = "$(dig +short vpatlas.org | tail -1)" ] && { echo "$ip is vpatlas.org — that's the OLD host." >&2; exit 1; }
    save_state NEW_IP "$ip"
    [ -n "${3:-}" ] && save_state NEW_INSTANCE_ID "$3"
    ensure_old_ids
    echo "Waiting for SSH on $ip (key $SSH_KEY)…"
    for _ in $(seq 1 36); do
        ssh "${SSH_OPTS[@]}" -o ConnectTimeout=5 "ubuntu@$ip" true 2>/dev/null && break
        sleep 5
    done
    new "lsb_release -ds; uname -m; nproc; free -h | awk '/Mem/{print \$2\" RAM\"}'; df -h / | tail -1"
    echo "✓ Saved NEW_IP=$ip in $STATE_FILE.  Next: $0 provision"
    ;;

# ─── 4. Base packages on the new host ───
provision)
    tz=$(old "timedatectl show -p Timezone --value")
    echo "=== Provisioning ubuntu@$NEW_IP (timezone $tz) ==="
    new "sudo bash -s -- '$tz'" <<'EOF'
set -euo pipefail
TZ_WANTED="$1"
export DEBIAN_FRONTEND=noninteractive
timedatectl set-timezone "$TZ_WANTED"
apt-get update -q
apt-get -yq full-upgrade
apt-get -yq install ca-certificates curl git gnupg nginx certbot python3-certbot-nginx \
                    python3 jq unattended-upgrades dnsutils

# Docker: docker.com repo when it has packages for this release, else Ubuntu's own.
. /etc/os-release
if curl -fsI "https://download.docker.com/linux/ubuntu/dists/$VERSION_CODENAME/Release" >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -yq install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "docker.com has no '$VERSION_CODENAME' repo yet — using Ubuntu's docker.io"
  apt-get -yq install docker.io docker-compose-v2 docker-buildx
fi
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || echo '{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"5"}}' > /etc/docker/daemon.json
systemctl enable --now docker
systemctl restart docker
usermod -aG docker ubuntu

# AWS CLI (db_backup.sh uploads to S3)
command -v aws >/dev/null || snap install aws-cli --classic

# Swap: image builds can OOM small instances
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Default nginx site would grab default_server; real vhosts arrive in copy-config.
rm -f /etc/nginx/sites-enabled/default
echo; lsb_release -ds; docker version --format 'docker {{.Server.Version}}'; docker compose version
EOF
    echo "✓ Provisioned.  Next: $0 clone"
    ;;

# ─── 5. Working directories ───
clone)
    for st in "${STACKS[@]}"; do IFS='|' read -r dir _ _ <<< "$st"
        new "[ -d '$dir/.git' ] || git clone -q '$GIT_REPO' '$dir'"
        sync_commit "$dir"
    done
    echo "✓ Cloned.  Next: $0 copy-config"
    ;;

# ─── 6. Secrets + host config (streamed old → local pipe → new; nothing written locally) ───
copy-config)
    guard_precutover copy-config
    echo "=== Copying config to ubuntu@$NEW_IP ==="
    for st in "${STACKS[@]}"; do IFS='|' read -r dir _ _ <<< "$st"
        if old "[ -e '$dir/.env' ]"; then
            echo "→ $dir/.env"
            old "cat '$dir/.env'" | new "cat > '$dir/.env' && chmod 600 '$dir/.env'"
        else
            echo "⚠ $dir/.env missing on old host"
        fi
    done

    echo "→ ~/.vpatlas_backup.conf and ~/.aws (if present)"
    if old 'cd ~ && ls -d .vpatlas_backup.conf .aws >/dev/null 2>&1'; then
        old 'cd ~ && tar czf - $(ls -d .vpatlas_backup.conf .aws 2>/dev/null)' | new 'cd ~ && tar xzf -'
    else
        echo "  (neither present on old host)"
    fi

    echo "→ /etc/letsencrypt (certs + renewal config)"
    old "sudo tar czf - -C / etc/letsencrypt" | new "sudo tar xzf - -C /"

    echo "→ nginx vhosts (sites-available + sites-enabled as they exist live, incl. certbot edits)"
    new "sudo rm -f /etc/nginx/sites-enabled/*"
    old "sudo tar czf - -C / etc/nginx/sites-available etc/nginx/sites-enabled" | new "sudo tar xzf - -C /"
    if new "sudo nginx -t"; then
        new "sudo systemctl reload nginx"
        echo "✓ nginx OK"
    else
        echo "⚠ nginx -t failed on new host — fix before cutover (configs above)."
    fi
    echo "Next: $0 copy-data"
    ;;

# ─── 7. Data + start stacks (rehearsal; safe to repeat — old host is only read) ───
copy-data)
    guard_precutover copy-data
    echo "=== Copying data to ubuntu@$NEW_IP (old host keeps serving) ==="
    for st in "${STACKS[@]}"; do IFS='|' read -r dir compose c <<< "$st"
        sync_commit "$dir"
        copy_photos "$dir"
        copy_db "$dir" "$compose" "$c"
        echo "→ building + starting $dir"
        new "cd '$dir' && $compose up -d --build"
    done
    new "docker ps --format 'table {{.Names}}\t{{.Status}}'"
    echo "Next: $0 verify"
    ;;

# ─── 8. Verify ───
verify)
    fail=0
    for st in "${STACKS[@]}"; do IFS='|' read -r _ _ c <<< "$st"
        echo "=== Row counts: $c (old vs new) ==="
        row_counts old "$c" > "$MIGRATE_DIR/counts_old_$c.txt"
        row_counts new "$c" > "$MIGRATE_DIR/counts_new_$c.txt"
        if diff "$MIGRATE_DIR/counts_old_$c.txt" "$MIGRATE_DIR/counts_new_$c.txt"; then
            echo "✓ $(wc -l < "$MIGRATE_DIR/counts_new_$c.txt") tables match"
        else
            echo "⚠ differences above (expected only if old host took writes since copy-data)"; fail=1
        fi
    done

    echo "=== HTTPS against new host $NEW_IP (real certs, real hostnames) ==="
    check() {
        local code; code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
            --resolve "$1:443:$NEW_IP" "https://$1$2") || code=ERR
        printf '  %-4s https://%s%s\n' "$code" "$1" "$2"
        [[ "$code" =~ ^(200|301|302)$ ]] || fail=1
    }
    check vpatlas.org /
    check vpatlas.org /manifest.json
    check api.vpatlas.org /vtinfo/counties
    check api.vpatlas.org /ogc/collections
    if [ "$MIGRATE_DEV" = "1" ]; then
        check dev.vpatlas.org /
        check api.dev.vpatlas.org /vtinfo/counties
    fi
    echo ""
    echo "Browser test: add to /etc/hosts →  $NEW_IP vpatlas.org api.vpatlas.org"
    echo "  then exercise login, Explore, a visit form, a photo upload. Remove the line after."
    [ $fail = 0 ] && echo "✓ verify passed" || { echo "⚠ verify found problems"; exit 1; }
    ;;

# ─── 9. Cutover ───
cutover)
    guard_precutover cutover
    ensure_old_ids; id=$OLD_INSTANCE_ID
    new_label="${NEW_INSTANCE_ID:-new instance $NEW_IP}"
    alloc=none
    ec2_api_ok && alloc=$(aws ec2 describe-addresses --filters "Name=public-ip,Values=$OLD_IP" \
        --query 'Addresses[0].AllocationId' --output text)
    old_hostname=$(old hostname); new_hostname=$(new hostname)
    save_state OLD_HOSTNAME "$old_hostname"; save_state NEW_HOSTNAME "$new_hostname"
    echo "=== Cutover: $OLD_IP ($id, $old_hostname) → $new_label ($new_hostname) ==="
    echo "  1. stop api + ogc on old host (writes freeze; the UI stays up and PWAs work offline)"
    echo "  2. final photo + DB sync → new host, restart stacks"
    echo "  3. copy old SSH host keys to new host (so 'ssh vpatlas.org' and known_hosts keep working)"
    if [[ "$alloc" == eipalloc-* ]]; then
        echo "  4. move Elastic IP $OLD_IP ($alloc) to $new_label"
    else
        echo "  4. YOU change DNS A records ${DOMAINS[*]}: $OLD_IP → $NEW_IP"
    fi
    echo "  5. install crontab (nightly S3 backup) on new host, disable it on old"
    echo "  Expect ~5–15 min with the API down, plus DNS TTL for stragglers."
    [[ "$alloc" == eipalloc-* ]] || check_dns_ttls
    confirm "This touches PRODUCTION (vpatlas.org)."

    echo "→ freezing writes on old host"
    for st in "${STACKS[@]}"; do IFS='|' read -r dir compose _ <<< "$st"
        old "cd '$dir' && $compose stop api_vp ogc_vp"
    done

    for st in "${STACKS[@]}"; do IFS='|' read -r dir compose c <<< "$st"
        sync_commit "$dir"
        copy_photos "$dir"
        copy_db "$dir" "$compose" "$c"
        new "cd '$dir' && $compose up -d --build"
    done
    "$0" verify || confirm "verify reported problems. Continue cutover anyway?"

    echo "→ SSH host keys"
    old "sudo tar czf - -C / \$(cd / && ls etc/ssh/ssh_host_{rsa,ecdsa,ed25519}_key* 2>/dev/null)" \
      | new "sudo tar xzf - -C / && (sudo systemctl restart ssh || sudo systemctl restart sshd)"
    ssh-keygen -R "$NEW_IP" >/dev/null 2>&1 || true

    echo "→ crontab"
    old "crontab -l" > "$MIGRATE_DIR/crontab_old.txt" 2>/dev/null || true
    new "crontab -" < "$MIGRATE_DIR/crontab_old.txt"
    old "crontab -l | sed 's/^\([^#]\)/# migrated-to-new-host: \1/' | crontab -"

    if [[ "$alloc" == eipalloc-* ]]; then
        echo "→ moving Elastic IP"
        aws ec2 associate-address --allocation-id "$alloc" --instance-id "$NEW_INSTANCE_ID" --allow-reassociation >/dev/null
    else
        echo ""
        echo "Now change these DNS A records (Google Cloud DNS) from $OLD_IP to $NEW_IP:"
        printf '    %s\n' "${DOMAINS[@]}"
        confirm "Done?"
    fi
    save_state CUTOVER_DONE 1
    wait_for_vpatlas_on "$new_hostname" new
    echo "✓ vpatlas.org now served by the new host."
    echo "  Old instance keeps running with its API stopped. Do NOT stop it until you're sure:"
    echo "  stopping it gives up $OLD_IP, which rollback needs."

    echo "→ certbot renewal dry-run on new host"
    new "sudo certbot renew --dry-run 2>&1 | tail -3" || \
        echo "⚠ certbot dry-run failed (if DNS is still propagating, re-run later: sudo certbot renew --dry-run)"
    echo ""
    echo "✓ Cutover complete. Smoke-test https://vpatlas.org in a browser (login, Explore, a visit, a photo)."
    echo "  Keep the old instance running + its AMI until you're confident."
    ;;

# ─── 10. Rollback ───
rollback)
    ensure_old_ids; id=$OLD_INSTANCE_ID
    : "${OLD_HOSTNAME:?no OLD_HOSTNAME in state — rollback only applies after a cutover run by this script}"
    : "${NEW_HOSTNAME:?no NEW_HOSTNAME in state}"
    alloc=none
    ec2_api_ok && alloc=$(aws ec2 describe-addresses --filters "Name=public-ip,Values=$OLD_IP" \
        --query 'Addresses[0].AllocationId' --output text)
    echo "=== Rollback to old instance $id ($OLD_HOSTNAME) ==="
    echo "  Any data written to the new host since cutover will NOT come back automatically."
    confirm "Move vpatlas.org back to the old Ubuntu 20.04 host?"

    # While vpatlas.org still lands on the new box: freeze its writes and its cron.
    if [ "$(old hostname)" = "$NEW_HOSTNAME" ]; then
        echo "→ stopping api + cron on the new host"
        for st in "${STACKS[@]}"; do IFS='|' read -r dir compose _ <<< "$st"
            old "cd '$dir' && $compose stop api_vp ogc_vp" || true
        done
        old "crontab -r" || true
    else
        echo "⚠ vpatlas.org is not on the new host — stop its api + 'crontab -r' there by hand."
    fi

    if [[ "$alloc" == eipalloc-* ]]; then
        aws ec2 associate-address --allocation-id "$alloc" --instance-id "$id" --allow-reassociation >/dev/null
    else
        echo "Change these DNS A records back to $OLD_IP:"
        printf '    %s\n' "${DOMAINS[@]}"
        confirm "Done?"
    fi
    wait_for_vpatlas_on "$OLD_HOSTNAME" old
    # vpatlas.org reaches the old host again; its host keys never changed.
    for st in "${STACKS[@]}"; do IFS='|' read -r dir compose _ <<< "$st"
        old "cd '$dir' && $compose up -d"
    done
    old "crontab -l | sed 's/^# migrated-to-new-host: //' | crontab -"
    save_state CUTOVER_DONE 0
    echo "✓ Rolled back. Old host serving with API restarted."
    ;;

*)
    sed -n '2,58p' "$0" | sed 's/^# \{0,1\}//'
    echo "Usage: $0 {inventory|snapshot-old|launch|set-new-ip <ip>|provision|clone|copy-config|copy-data|verify|cutover|rollback}"
    exit 1
    ;;
esac
