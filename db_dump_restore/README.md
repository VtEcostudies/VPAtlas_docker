# VPAtlas database backup + restore

Self-contained Postgres backup system for VPAtlas, designed to mirror
LoonWeb's `db_dump_restore/` so the two projects operate the same way.
Run **on the vpatlas server** via system cron — not from a dev machine.

## Files

- **`db_backup.sh`** — 5-stage `pg_dump` (globals → schema → data → settings → combined+gzip). Default mode dumps the lone `vp` target with type `complete`; designed for `cron` invocation with no args.
- **`db_restore.sh`** — `gunzip | docker exec psql`. Re-creates the database, enables PostGIS, restores from a `.sql.gz`, then prints what migrations to run next.
- **`config.sh`** — single source of truth for container/db names, dump types, paths.

## Output location

Dumps land in `../db_backup/` (already gitignored at the repo root):

```
db_backup/
├── vpatlas_vp_complete_YYYYMMDD.sql.gz   ← today's nightly
├── archive/                              ← previous same-day dumps
├── logs/                                 ← backup_YYYYMMDD.log
└── ...
```

## Usage

```bash
# Nightly cron mode — single target, complete dump
./db_backup.sh

# Explicit
./db_backup.sh vp complete
./db_backup.sh vp partial     # schema + geo reference only
./db_backup.sh vp empty       # schema + minimal config only

# Plan without doing anything
./db_backup.sh --dry-run

# Local backup, skip S3 even if ~/.vpatlas_backup.conf is present
./db_backup.sh --no-s3 vp

# Restore — see what's available
./db_restore.sh vp
# Restore a specific file
./db_restore.sh vp db_backup/vpatlas_vp_complete_20260520.sql.gz
```

## Cron installation (on the vpatlas server)

Add to the deploy user's crontab (`crontab -e`) on the vpatlas server. Runs daily at 2 AM local time, same slot LoonWeb uses on its host:

```cron
0 2 * * * /home/jloomis/VPAtlas/VPAtlas_docker/db_dump_restore/db_backup.sh >> /home/jloomis/db_backups/vpatlas_cron.log 2>&1
```

Adjust the absolute path to wherever the repo lives on that host. The script writes its own dated log under `db_backup/logs/`; the cron redirect captures stderr/stdout chatter from invocation itself (path errors, etc.) so a silent cron failure is still recoverable.

Verify with: `crontab -l` and a manual `./db_backup.sh --dry-run` first.

## Optional S3 + SNS

Drop a file at `~/.vpatlas_backup.conf` on the server to enable off-site backup and email alerts. Mirrors LoonWeb's `.loonweb_backup.conf` format:

```bash
S3_BUCKET="vpatlas-db-backups"
AWS_REGION="us-east-1"
SNS_TOPIC_ARN="arn:aws:sns:us-east-1:123456789012:vpatlas-backups"

# Default targets when ./db_backup.sh is called with no args.
# Single-state VPAtlas, so usually just the one entry — same effect as
# the script's built-in default; included here for parity with LoonWeb.
BACKUP_TARGETS=(
    "vp:db_vp:vpatlas"
)

# Optional: warn if a dump comes back smaller than this many bytes.
MIN_DUMP_SIZE_BYTES=1048576
```

Retention prefixes (LoonWeb-compatible):
- `s3://${S3_BUCKET}/daily/YYYYMMDD/` — every run
- `s3://${S3_BUCKET}/weekly/YYYYMMDD/` — Sundays
- `s3://${S3_BUCKET}/monthly/YYYYMMDD/` — 1st of the month

Only `complete` dumps are uploaded; `empty` / `partial` are point-in-time helpers and stay local.

Without `.vpatlas_backup.conf` the script runs **local-only** with zero AWS dependencies — safe to run on any host that just needs an on-disk backup.

## Restore + migrations

A restore re-creates the database to the dump's point in time. If the dump was taken before the latest migrations were applied, run:

```bash
docker compose -f docker-compose-vpatlas.yml up db_migrate_vp
```

The migration runner is idempotent (tracks applied migrations by checksum in `schema_migrations`), so re-running it after every restore is safe.

## Why not the legacy `db_backup/*.backup` files?

The repo root has an older `db_restore.sh` that consumes `pg_dump -Fc` custom-format `.backup` files — kept around because `deploy/deploy-{dev,prod}.sh` still call it for one-shot restores. The new `.sql.gz` pipeline is the standard going forward; the legacy path can be retired once the deploy scripts switch over.
