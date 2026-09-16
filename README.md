# mohPA Backend

Community revival of the Medal of Honor: Pacific Assault (2004) master server. This repository emulates EA **FESL**, **Theater**, and **GameSpy** services so the original PC client can still authenticate, browse lobbies, and join dedicated servers.

Live API: [https://backend.mohpa.net](https://backend.mohpa.net)  
Player portal: [https://portal.mohpa.net](https://portal.mohpa.net) · [mohPA-frontend](https://github.com/Appelpitje/mohPA-frontend)

This project is unofficial and is not affiliated with, endorsed by, or connected to Electronic Arts, Dice, or Medal of Honor.

## Architecture

Two processes share Redis sessions and a PostgreSQL database:

```
Game client / dedicated server
        │
        ├── TLS  FESL     →  fesl-engine
        ├── TCP  Theater  →  fesl-engine
        └── GameSpy ports →  fesl-engine
                    │
                    ├── Redis (lkeys, lobbies, peers)
                    └── HTTP  →  api-service  →  PostgreSQL
```

| Package | Role |
| --- | --- |
| `@mohpa/fesl-engine` | TCP/TLS protocol server: FESL, Theater, GameSpy |
| `@mohpa/api-service` | Fastify REST API, JWT auth, WebSocket inspector |
| `@mohpa/db` | PostgreSQL client, SQL migrations, repositories |
| `@mohpa/shared` | Packet codec, game profiles, shared types |

`api-service` is the source of truth for accounts, personas, entitlements, stats, and the public server browser. `fesl-engine` speaks the 2004 wire protocols and calls `api-service` over an internal HTTP API.

## Prerequisites

- Node.js 22
- npm 10+
- Docker (recommended for PostgreSQL 17 and Redis 7)

## Quick start

```bash
git clone https://github.com/Appelpitje/mohPA-backend.git
cd mohPA-backend
cp .env.example .env
```

Edit `.env` before anything else. Replace every placeholder secret (`JWT_SECRET`, `INTERNAL_API_KEY`, `POSTGRES_PASSWORD`). This repository is public — never commit `.env` or real credentials.

Start Postgres and Redis, then the Node services:

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis
npm install
npm run build
npm run dev
```

`npm run dev` starts both `api-service` (http://127.0.0.1:3000) and `fesl-engine`.

Health check:

```bash
curl http://127.0.0.1:3000/health
```

To run the full stack in Docker instead:

```bash
docker compose -f docker-compose.dev.yml up --build
```

## Environment

Copy [`.env.example`](./.env.example) to a gitignored `.env`. Only the **names** below belong in documentation; put real values in `.env` on the machine that runs the services.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Compose database credentials |
| `REDIS_URL` | Redis session store |
| `API_PORT` / `API_HOST` | Fastify bind address (default `3000` / `0.0.0.0`) |
| `JWT_SECRET` | Signs portal JWTs. Generate a long random value. |
| `INTERNAL_API_KEY` | Shared secret between `fesl-engine` and `api-service`. Generate a long random value. |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile **secret**. Never commit a real key. Leave empty only for local tests. |
| `PUBLIC_IP` | IPv4 announced to game clients (use `127.0.0.1` locally) |
| `FESL_CLIENT_PORT` | FESL listener (MOHPA default `18020`) |
| `THEATER_CLIENT_PORT` | Theater listener (MOHPA default `18275`) |

Production (`NODE_ENV=production`) refuses portal login and register if Turnstile is not configured. Local development can use Cloudflare's [dummy testing keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Compile all workspaces (`shared` → `db` → `api-service` → `fesl-engine`) |
| `npm run dev` | Run API + FESL together via `tsx` |
| `npm run start:api` | API only |
| `npm run start:fesl` | FESL/Theater engine only |
| `npm test` | Vitest unit and integration tests |
| `npm run test:e2e` | Mock client/server simulation |

API migrations run automatically when `api-service` starts.

## HTTP API

Base URL locally: `http://127.0.0.1:3000`

| Path | Notes |
| --- | --- |
| `GET /health` | Liveness |
| `GET /` | Service index |
| `/api/v1/auth` | Register, login, profile, password reset |
| `/api/v1/personas` | Soldier CRUD (max 4 per account) |
| `/api/v1/entitlements` | CD-key / license claims |
| `/api/v1/servers` | Public server browser |
| `/api/v1/stats` | Leaderboards and player lookup |
| `/api/v1/admin` | Moderation (admin JWT) |
| `/internal/*` | fesl-engine only, gated by `INTERNAL_API_KEY` |
| `WS /ws/inspector` | Live FESL/Theater packet stream for the portal admin console |

Portal login, register, and forgot-password require a Cloudflare Turnstile token when the secret is configured.

## Game ports

Defaults used by Medal of Honor: Pacific Assault. Override with env vars if you need to.

| Service | Default | Transport |
| --- | --- | --- |
| FESL (client) | 18020 | TLS |
| FESL (dedicated server) | 18051 | TLS |
| Theater (client) | 18275 | TCP |
| Theater (dedicated server) | 18056 | TCP |
| GameSpy GP / master / available / peerchat | 29900, 28900, 27900, 18667, … | TCP/UDP |

Game traffic must hit the host IPv4 directly. Do not put FESL or Theater behind a CDN that terminates TLS for modern browsers.

## Production notes

- Build with `npm run build`, then run `docker-compose.prod.yml` (or the root `docker-compose.yml`) with a **server-local** `.env`.
- `.env` is gitignored. Never copy a developer `.env` onto a production host, and never commit production secrets, TLS private keys, or host credentials.
- Generate unique `JWT_SECRET`, `INTERNAL_API_KEY`, and `POSTGRES_PASSWORD` per environment.
- Set `TURNSTILE_SECRET_KEY` from your Cloudflare Turnstile widget (the matching **sitekey** lives in the frontend build environment, not here).
- Set `PUBLIC_IP` to the IPv4 game clients should connect to.
- Keep `api-service` off the public internet if you terminate TLS with Caddy/nginx in front of it. The bundled `Caddyfile` proxies `backend.mohpa.net` and serves a few GameSpy HTTP endpoints that the 2004 client expects without an HTTPS redirect.

## Security

This repository is **public**.

- Do not commit `.env`, certificates, or private keys.
- Do not paste production secrets into issues, pull requests, or chat.
- Treat `.env.example` as names and local placeholders only.
- Rotate any credential that has ever been committed or pasted.

## Related

- [mohPA-frontend](https://github.com/Appelpitje/mohPA-frontend) — player portal and admin console
- [mohpa.net](https://mohpa.net) — marketing site
