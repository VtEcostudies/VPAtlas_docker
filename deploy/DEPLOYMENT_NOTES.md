# VPAtlas dev.vpatlas.org — Deployment Notes

Deployed: 2026-04-25

## Deployment Overview

The VPAtlas Docker stack (PostgreSQL + Node API + Nginx UI) was deployed to the existing AWS EC2 instance at `vpatlas.org`, running alongside the production Angular app. The dev site lives at `dev.vpatlas.org` with the API at `api.dev.vpatlas.org`.

### What Was Deployed

- **deploy-dev.sh** — Single deploy script with subcommands: `setup`, `deploy`, `ui`, `db-restore`, `status`, `logs`
- **docker-compose-dev.yml** — Override file layered on top of the base compose, setting HTTPS URLs and dev-specific env vars
- **Nginx reverse proxy configs** — `dev.vpatlas.org` → localhost:8090 (UI), `api.dev.vpatlas.org` → localhost:4010 (API)
- **Certbot SSL** — Let's Encrypt certs for both subdomains

### Deployment Steps

1. `./deploy/deploy-dev.sh setup` — copies nginx configs, symlinks to sites-enabled, reloads nginx
2. SSH in and run `sudo certbot --nginx -d dev.vpatlas.org -d api.dev.vpatlas.org` for SSL
3. `./deploy/deploy-dev.sh deploy` — pushes to GitHub, pulls on remote, builds and starts all containers
4. `./deploy/deploy-dev.sh db-restore` — dumps live production DB and restores into the dev container

---

## Errors Encountered and Fixes

### 1. Nginx SSL config conflict (commit 2382b32)

**Error:** Nginx failed to start — the initial configs included hand-written `listen 443 ssl` blocks with placeholder certificate paths that didn't exist yet.

**Fix:** Stripped the configs down to HTTP-only (`listen 80`) with a comment telling the admin to run certbot afterward. Certbot's `--nginx` plugin automatically adds the SSL server block and redirect, so hand-writing SSL config was unnecessary and caused a chicken-and-egg problem.

### 2. Docker Compose v2 not available / version incompatibility (commits 2507061, dcd25fc)

**Error:** The remote server (Docker 20.10) didn't have `docker compose` (v2 plugin) installed — only the older standalone `docker-compose` was available. After installing the latest Compose v2, it failed because Compose v2.29+ requires Docker Engine 23.0+, which is newer than what's on the server.

**Fix:** Two-step fix:
- First added auto-detection: try `docker compose` and fall back to `docker-compose`
- Then pinned to Compose **v2.24.7** specifically, which is the last version compatible with Docker 20.10. The setup command now checks the installed version and only re-installs if needed.

### 3. DB dump permission denied (commits 25444af, 4408902)

**Error:** `pg_dump` couldn't authenticate to the production database. The live DB uses peer authentication (OS user must match DB user), so connecting as `ubuntu` with `-U vpatlas` failed.

**Fix:** Two iterations:
- First switched to `sudo -u postgres pg_dump` to use the `postgres` superuser via peer auth
- Then hit a second issue: `postgres` user couldn't write directly to `/home/ubuntu/VPAtlas_docker/db_backup/` due to directory permissions. Fixed by dumping to `/tmp` first, then `sudo mv` to the target directory and `chown` to `ubuntu`.

### 4. UI container port conflict (commit 89a3e4c)

**Error:** The UI container (Nginx) failed to start. The dev override had set `UI_PORT: 443`, which was being used as the internal listen port inside the container. Nginx inside the container tried to bind to port 443, but the container wasn't running as root (or port 443 was otherwise unavailable inside the container).

**Fix:** Removed the `UI_PORT` override from docker-compose-dev.yml so it inherits port 8090 from the base compose file. The internal listen port should always be 8090 — the external nginx reverse proxy handles the 443→8090 translation. `API_PORT: 443` is fine because that's the *external* URL the browser uses, not a listen port.

---

## Final Architecture

```
Internet
  │
  ├── dev.vpatlas.org:443 (SSL)
  │     └── nginx reverse proxy → localhost:8090 → ui_vp container
  │
  └── api.dev.vpatlas.org:443 (SSL)
        └── nginx reverse proxy → localhost:4010 → api_vp container
                                                      └── db_vp (PostgreSQL, port 6550)
```

Production (vpatlas.org) runs separately on the same server with its own nginx config, untouched by this deployment.
