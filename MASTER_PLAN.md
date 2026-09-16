# mohPA: Backend Master Plan

## 1. Executive Summary
This document serves as the comprehensive, modular Master Plan for the backend architecture of **mohPA**, an EA FESL (Front End Services Layer) and Theater server emulation platform.

The backend consists of two primary services:
1. **Backend 1 (`fesl-engine`)**: High-concurrency TCP/TLS Protocol Server emulating FESL, Theater, and GameSpy PreAuth wire protocols.
2. **Backend 2 (`api-service`)**: Central REST/WebSocket API and PostgreSQL/Redis database service managing master accounts, personas, CD keys, server registries, stats, and administration.

---

## 2. Architecture & Service Boundaries

```
                           +------------------------+
                           | Game Client / Server   |
                           +-----------+------------+
                                       |
                +----------------------+----------------------+
                | TLS (Port 18270/18051)                      | TCP (Port 18275/18056)
                v                                             v
+-------------------------------+             +-------------------------------+
|     FESL Protocol Engine      |             |     Theater Protocol Engine   |
| (fsys, acct, subs, rank, etc) |             | (CONN, CGAM, EGAM, GLST, etc) |
+---------------+---------------+             +---------------+---------------+
                |                                             |
                +----------------------+----------------------+
                                       |
                        +--------------v--------------+
                        |  Redis Shared Session Store |
                        | (lkey, active peers, lobby) |
                        +--------------+--------------+
                                       |
                        +--------------v--------------+
                        |      API & Auth Service     |
                        |   (Internal IPC / REST API) |
                        +--------------+--------------+
                                       |
                        +--------------v--------------+
                        |     PostgreSQL Database     |
                        | (users, personas, stats, db)|
                        +-----------------------------+
```

---

## 3. Backend 1: `fesl-engine` (Protocol Emulation Server)

### Module 1.1: Transport & Network Layer
- **Multi-Port TCP/TLS Listener**:
  - `18270`: FESL Client Listener (TLS).
  - `18051`: FESL Game Server Listener (TLS).
  - `18275`: Theater Client Listener (Plain TCP / Optional TLS).
  - `18056`: Theater Game Server Listener (Plain TCP).
- **TLS Configuration**:
  - Custom TLS termination supporting legacy cipher suites (TLS 1.0/1.1/1.2/1.3, RSA, AES-CBC) required by older game executables without requiring complex client reverse-engineering.
  - Certificate manager with custom self-signed or patched cert configurations.
- **Connection Lifecycle**:
  - Non-blocking async event loop.
  - Heartbeat / Ping-Pong monitor (`activityTimeoutSecs`).
  - Graceful disconnection & session cleanup.

### Module 1.2: Packet Framing & Binary Codec
- **12-Byte Binary Header**:
  - `0x00-0x03` (4 Bytes): Subsystem Query String (`fsys`, `acct`, `subs`, `dobj`, `rank`, `pnow`, `CONN`, `USER`, etc.).
  - `0x04-0x07` (4 Bytes, uint32 BE): Packet Subtype / Sequence / TXN ID (`0x80000000 | seq`, `0xC0000001`).
  - `0x08-0x0B` (4 Bytes, uint32 BE): Total packet size (12 bytes + payload length).
- **Key-Value Serializer / Deserializer**:
  - ASCII payload encoding with `\n` line delimiters and `=` key-value separators.
  - Multi-dimensional array handling (`personas.[]=2`, `personas.0="Alpha"`, `personas.1="Beta"`).
  - Error container format (`errorContainer=[]`, `errorContainer.0.fieldName=...`, `errorContainer.0.fieldError=...`).
  - Quoted string and URL-encoding/decoding support for parameters like `curTime`, `encryptedInfo`.
  - Stream buffer reassembly for fragmented or batched TCP packets.

### Module 1.3: FESL Command Handlers
1. **`fsys` (System & Handshake)**:
   - `Hello`: Parses client SDK version, sku, locale, platform, clientType (`client`, `server`, `dedicated`). Returns domain partition (`eagames`, `bfwest-dedicated` / `bfwest-server`), server timestamp, theater host/port, messenger host/port.
   - `Ping`: Responds to client keep-alive timestamp (`TID`).
   - `MemCheck`: Sends anti-cheat/integrity memory challenges (`type`, `salt`), processes client responses.
   - `GetPingSites`: Returns available ping probe servers.
   - `Goodbye`: Handles graceful client disconnect.
2. **`acct` (Authentication & Persona Management)**:
   - `Login`: Legacy username + password login. Generates `lkey`, returns `userId`, `profileId`, `displayName`.
   - `NuLogin`: Modern Nucleus email/username login. Validates credentials with `api-service`, returns master `lkey`, `userId`, `profileId`, `nuid`.
   - `NuGetPersonas` / `GetPersonas`: Fetches soldier/persona list for the user. Formats `personas.[]` array.
   - `NuLoginPersona` / `LoginPersona`: Authenticates persona/soldier selection. Generates persona-scoped `lkey` stored in Redis.
   - `GetSubAccounts` / `LoginSubAccount` / `AddSubAccount` / `DisableSubAccount`: Full subaccount management flow.
   - `GetAccount` / `UpdateAccount`: Retrieves/updates account demographic data (country, DOB, email, zip).
   - `NuLookupUserInfo` / `NuLookupPersona` / `NuLookupPersonaByName`: Player search lookups.
   - `GameSpyPreAuth`: Generates GameSpy ticket & challenge hash for cross-protocol games.
   - `GetTelemetryToken`: Issues telemetry session tokens.
3. **`subs` & `dobj` (Entitlements & Inventory)**:
   - `GetEntitlementByBundle`: Returns game expansion/DLC entitlements.
   - `GetObjectInventory`: Returns virtual item inventory.
4. **`rank` & `gsum` (Stats & Game Summaries)**:
   - `GetStats` / `UpdateStats`: Player ranking data.
   - `GetSessionID` / `GetGameSummary`: Post-match telemetry reporting.
5. **`pnow` (Matchmaking)**:
   - `Start` / `Status`: Quick-match ticket generation and matchmaker handoff.

### Module 1.4: Theater Protocol Engine (Lobby & Game Session Coordination)
- **Theater Command Handlers**:
  - `CONN`: Client/Server establishes Theater session using `lkey`.
  - `USER`: Resolves user details and permissions.
  - `LLST`: Returns lobby list.
  - `GLST` / `GDAT`: Returns active game servers, player lists, and server metadata.
  - `CGAM`: Dedicated server creates game session and registers joinable port/IP.
  - `EGAM` / `EGRQ` / `EGRS`: Enter game handshake between client and server.
  - `PENT`: Player join event notification to game host.
  - `UPLA`: Updates player attributes (team, ping, score, status).
  - `ECHO` / `PING`: Latency calculation probes.
  - `KICK` / `ECNL`: Connection drop and kick coordination.

### Module 1.5: Session & Token Store (Redis)
- High-speed atomic session lifecycle:
  - `lkey:<token>` -> `{ userId, personaId, username, personaName, clientType, ip, gameSlug, createdAt, expiresAt }`.
  - Heartbeat renewal on active packet exchange.
  - Cross-service validation for Theater and API queries.

### Module 1.6: Game Profiles & Configuration
- Modular JSON/YAML configuration defining game-specific dialects (BF2142, BF Heroes, BF Play4Free, BF:BC2, Red Alert 3).
- Domain partition names, default theater ports, SKU mappings, and packet quirks.

---

## 4. Backend 2: `api-service` (Central Auth, REST API & Persistence)

### Module 2.1: Database Schema & Migrations (PostgreSQL)
- **`users` Table**:
  - `id` (UUID), `username`, `email`, `password_hash`, `country_code`, `dob`, `is_admin`, `is_banned`, `created_at`, `updated_at`.
- **`personas` Table**:
  - `id` (UUID), `user_id` (FK), `game_slug`, `name`, `is_active`, `created_at`.
  - Unique index: `(game_slug, name)`.
- **`entitlements` Table**:
  - `id` (UUID), `user_id` (FK), `game_slug`, `cd_key`, `is_used`, `activated_at`.
- **`game_servers` Table**:
  - `id` (UUID), `name`, `game_slug`, `ip_address`, `port`, `query_port`, `secret_key`, `is_ranked`, `is_online`, `last_heartbeat`.
- **`persona_stats` Table**:
  - `persona_id` (FK), `score`, `kills`, `deaths`, `wins`, `losses`, `time_played_seconds`, `custom_stats` (JSONB).
- **`match_history` Table**:
  - `id` (UUID), `server_id` (FK), `game_slug`, `map_name`, `game_mode`, `duration_seconds`, `winner_team`, `details` (JSONB), `created_at`.
- **`audit_logs` Table**:
  - `id` (UUID), `actor_id` (FK), `action`, `target_type`, `target_id`, `details` (JSONB), `created_at`.

### Module 2.2: REST API Endpoints
1. **Auth & Account (`/api/v1/auth`)**:
   - `POST /register`: Account registration with username, email, password, DOB, country.
   - `POST /login`: Master account authentication, returns JWT and user payload.
   - `GET /me`: Returns profile, security details, and owned entitlements.
   - `PUT /me`: Updates email, country, password.
2. **Personas / Soldiers (`/api/v1/personas`)**:
   - `GET /`: Lists all personas owned by current user.
   - `POST /`: Creates a new persona (validates name availability and per-game max limit).
   - `DELETE /:id`: Deactivates/deletes a persona.
   - `GET /:id/stats`: Returns in-depth stats for persona.
3. **Entitlements & CD Keys (`/api/v1/entitlements`)**:
   - `POST /claim`: Claims a CD key for a specific game title.
   - `GET /`: Lists all activated game licenses for the user.
4. **Server Registry (`/api/v1/servers`)**:
   - `GET /`: Public server browser endpoint with filters (game, map, players, region).
   - `GET /:id`: Detailed server profile with live scoreboard.
   - `POST /heartbeat`: Dedicated server status push (authenticated via server secret).
5. **Leaderboards & Stats (`/api/v1/stats`)**:
   - `GET /leaderboard/:game_slug`: Paginated rankings sorted by score/kills/wins.
   - `GET /players/:name`: Public player lookup.
6. **Admin & Moderation (`/api/v1/admin`)**:
   - `GET /sessions`: Active FESL & Theater connections.
   - `POST /bans`: Issues ban (User ID, IP, Persona).
   - `DELETE /bans/:id`: Revokes ban.
   - `POST /kick`: Sends force-disconnect message to `fesl-engine`.

### Module 2.3: Inter-Service Communication (IPC)
- Internal secured REST / gRPC API for `fesl-engine`:
  - `POST /internal/auth/validate`: Verifies credentials for `NuLogin` / `Login`.
  - `GET /internal/personas/list`: Retrieves soldier list for `NuGetPersonas`.
  - `POST /internal/stats/report`: Ingests match telemetry from `gsum`.

---

## 5. Development & Verification Plan

### Step-by-Step Milestones
1. **Milestone 1**: Initialize `api-service` with PostgreSQL schema, migrations, and Auth/Persona endpoints.
2. **Milestone 2**: Implement `fesl-engine` TCP/TLS server and binary/ASCII packet codec.
3. **Milestone 3**: Implement FESL Handshake (`fsys`) and Authentication (`acct`) handlers hooked into Redis & `api-service`.
4. **Milestone 4**: Implement Theater server engine (`CONN`, `CGAM`, `EGAM`, `GLST`).
5. **Milestone 5**: Implement Automated Mock Client test suite simulating end-to-end login and game entry.

### Verification Commands & Tests
- `npm test` / `cargo test` / `pytest` for packet codec roundtrip tests.
- Automated Mock Client: `node test/mock-client.js` or `python test/mock_client.py` connecting via TLS to `localhost:18270` and asserting `lkey` response.
