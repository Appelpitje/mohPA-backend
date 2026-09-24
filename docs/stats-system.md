# mohPA career and match stats

Research note. Facts are cited. **Inference** and **Unknown** are labeled. This is not an implementation plan beyond the protocol that is already proven.

## 1. Bottom line

Career stats are supposed to move from the dedicated server to PostgreSQL as a GameSpy final snapshot on TCP 29920, then be readable again with `getpd`. That path never reaches the database. The portal only reads `persona_stats`, which stay at the zeros created with the persona.

The dedicated server’s own strings name the upload. `SV_Community` opens the stats connection at match start and sends a “final stat snapshot” when the game ends normally. It refuses to upload unless GameSpy, PunkBuster, and `sv_pure` are all on. The linked SDK formats in `mohpa_server.exe` are the GameSpy ones: `\auth\`, `\newgame\`, `\updgame\…\gamedata\`, `\getpd\`, `\setpd\`. Theater `UPLA` only updates the in-memory lobby. The master plan’s FESL `gsum` → `POST /internal/stats/report` path is not what those strings describe, and nothing in `fesl-engine` calls that route.

Two hops are missing:

1. **The live handshake does not finish.** Since this `fesl-engine` process started logging, four dedicated-server connections on 22 Sep 2026 each wrote exactly 243 bytes and closed about 100 ms later. The parser sent no `\sesskey\` and no persist reply. A snapshot is only transmitted when that socket is still open, so those matches never uploaded.
2. **A recognized snapshot would still be dropped.** `GsStatsServer.handleConnection` answers `\auth\` and empty `\getpd\` / `\setpd\` acks. `\newgame\` and `\updgame\` are decoded and ignored. `ApiClient` has no method that POSTs `/internal/stats/report`.

The 243-byte payload was not saved. It contains no plaintext `\final\`, and XOR with `GameSpy3D` did not yield `\auth\` or `\gamename\` (otherwise a sesskey would have been sent). That does not match one `DoSend` auth frame from the SDK copy in the exe. The framing mismatch is unexplained until one payload is hex-dumped. What is known is that `SV_Community` never gets a sesskey, so it never sends `gamedata`.

## 2. Three channels

### 2.1 GameSpy gstats / persist, TCP 29920

**SDK (not a MOHPA capture).** The GameSpy Stats/Tracking and Persistent Storage SDK in OpenMoHAA (`gstats.c`, copyright 1999–2007, with edits dated September 2004) connects to port **29920**:

```c
#define SSHOST "gamestats." GSI_DOMAIN_NAME
#define SSPORT 29920
```

Source: [openmoh/openmohaa `gstats.c`](https://github.com/openmoh/openmohaa/blob/main/code/gamespy/gstats/gstats.c) lines 116–117. `InitStatsAsync` connects there. If `StatsServerHostname` is not already an IP, it prefixes `gcd_gamename` (`InitStatsAsync`, same file, around the `get_sockaddrin(..., SSPORT, ...)` call at line 251).

`IsStatsConnected` is only `sock != INVALID_SOCKET` (`gstats.c` lines 466–468). `NewGame` and `SendGameSnapShotA` transmit **only if that socket is valid**; otherwise the game object is freed when disk logging is off (`NewGame` lines 504–530, `SendGameSnapShotA` lines 595–606).

**This repo, client and dedicated server binaries.** `patcher.py` documents three proven binary facts for stock MOHPA 1.2 (`mohpa.exe` and, if present, `mohpa_server.exe`):

- The bytes `gamestats.gamespy.com` and `gamestats.openspy.net` are raw connect strings (`patcher.py` lines 58–70 and 534–538). The same replacement runs for the server exe (`patch_file(..., is_server=True)` at line 808). `IsStatsConnected` is patched for both; the `if not is_server` branch starts later, at line 589, and does not skip the stats patches.
- `IsStatsConnected` in the exe matches the SDK: `mov ecx,[sock]; xor eax,eax; cmp ecx,-1; setne al; ret`, rewritten to `mov eax,1; ret` (`patcher.py` lines 85–91, `patch_isstats` lines 482–491, called at 515).
- The client README states why: after chat welcome the exe aborts community login if gstats was not already up (`client-patches/mohpa/README.md` lines 17 and 59). Port 29920 is listed as “GameSpy stats”.

**This repo, server.** `GsStatsServer` listens on `GSTATS_PORT` default **29920** (`packages/fesl-engine/src/config/config.ts` line 45; started from `server.ts` lines 132–134). Its own comment says the listener exists so `IsStatsConnected()` can succeed for community login (`gstats-server.ts` lines 80–87). It does not mention match reporting.

The always-true client patch does **not** upload stats. The SDK still sends `NewGame` / `SendGameSnapShot` only when `sock` is a real connected socket (`gstats.c` `NewGame`: if `sock == INVALID_SOCKET` and disk logging is compiled out, the game is discarded).

### 2.1.1 What `mohpa_server.exe` contains

Strings from the MOHPA 1.2 dedicated-server exe (the same binary the patcher targets). These are game strings, not the OpenMoHAA tree.

`SV_Community` is the uploader:

- `SV_Community:  Game started normally`
- `SV_Community:  Final stat snapshot sent; Game ended normally`
- `SV_Community:  Couldn't send final stat snapshot (stats connection broken)`
- `… (data error)` and `… (unknown error)`
- `SV_Community:  Stat system init failed:  %s`
- `Unable to receive challenge from stats server, or bad challenge`
- `Unable to connect to stats server`
- `Unable to create data socket`
- `Unable to resolve stats server DNS`
- `Connection request timed out`
- `sv_community:  Stats will not be uploaded.  Requires GameSpy, PunkBuster and sv_pure.`

The five “unable / timed out” lines are the game’s labels for the SDK’s `GE_DATAERROR`, `GE_NOCONNECT`, `GE_NOSOCKET`, `GE_NODNS`, and `GE_TIMEDOUT`. Cvars next to that block: `sv_community`, `sv_communitystats`, `sv_communitypublic`, `sv_pure`, `sv_punkbuster`, `net_gamespy_port`, and the server-browser key `stattracking`.

XOR-obfuscated format blobs in the same exe decode with the SDK key `ProjectAphex` to the same commands as `gstats.c`:

```text
\auth\\gamename\%s\response\%s\port\%d\id\1
\newgame\\connid\%d\sesskey\%d
\newgame\\sesskey\%d\challenge\%d
\updgame\\sesskey\%d\connid\%d\done\%d\gamedata\%s
\updgame\\sesskey\%d\connid\%d\done\%d\gamedata\%s\dl\1
\getpd\\pid\%d\ptype\%d\dindex\%d\keys\%s\lid\%d
\setpd\\pid\%d\ptype\%d\dindex\%d\kv\%d\lid\%d\length\%d\data\
```

So this binary is linked to that SDK, including both the connected `\newgame` form and the disk-log forms. It is not an FESL-only stats client.

Identifiers sitting next to the “final stat snapshot” log, which are the per-match fields the game formats (not yet proven as the `gamedata` encoding):

`matchStarted`, `matchCompleted`, `playTime`, `numKills`, `numSuicides`

Server-lifetime buckets next to `cmgs_dumpgrandtotals`:

`grandTotalNumMatches`, `grandTotalNumPlayers`, `grandTotalNumKills`, `grandTotalNumTeammateKills`, `grandTotalNumChargesPlanted`, `grandTotalNumChargesDefused`, `grandTotalNumCorpsmanHeals`, `grandTotalNumCorpsmanRevivals`

One 602-byte key list in the server exe (leading non-printable byte omitted) is the career record. Join-restriction strings name three of these (`totalPlayTime_Ranked`, `totalNumKills`, `totalTeamBonusPoints`):

```text
rankNumber
rankAllied
rankAxis
totalTeamBonusPoints
totalNumKills
totalPlayTime_Ranked
totalAlliedMostAccurate
totalAlliedMostLethal
totalAlliedMostValuable
totalAlliedMostHelpful
totalAxisMostAccurate
totalAxisMostLethal
totalAxisMostValuable
totalAxisMostHelpful
accuracy
totalNumShots
totalNumHits
totalNumHeadShots
totalNumTeammateKills
totalNumDeaths
totalNumFFDeaths
totalNumCorpsmanRevivals
totalNumCorpsmanHeals
totalNumDemoChargesPlanted
totalNumDemoChargesDetonated
totalNumDemoChargeDefuseFailures
totalNumDemoChargesDefused
totalPlayTime_FFA
totalPlayTime_TeamMatch
totalPlayTime_Invader
```

There is no `wins` / `losses` / `score` key in that list. `totalTeamBonusPoints` is the points total. The four “Most*” keys per side are medal counts. `accuracy` is stored beside shots, hits, and headshots. Play time is split by mode (`FFA`, `TeamMatch`, `Invader`) plus a ranked total.

The client exe logs `CL_Community:  Connecting:  Retrieving stats...` and `CL_Community::GetStats:  "%s"` during community connect, next to `mohpa.fesl.ea.com` and `GS Preauth`. That is the read side (what `getpd` is for). The client does not contain the “final stat snapshot” strings; the dedicated server does.

**Live socket, this process’s `fesl-engine` log.** Four connections, each `RAW 243b` then `decoded 243b`, then close about 100 ms later. One later connection sent 8 bytes. Zero `SEND sesskey` lines. Zero `SEND persist` lines. Zero `FeslRouter` lines for subsystem `gsum` or `rank`. `decoded` length equals `RAW` length only when the buffer has no plaintext `\final\` (`gstats-server.ts` splits on `\final\` before XOR). The `\auth\` / `\gamename\` branch did not run, so GameSpy3D XOR of those 243 bytes does not contain those keys. A normal `DoSend` auth is on the order of 80 bytes plus a 7-byte `\final\`, so this write is not that frame. The bytes were not logged. **Unknown:** whether a length prefix, a different XOR phase, or a non-stats client produced them. **Fact:** no sesskey went back, so `InitStats` cannot complete and `NewGame` will not transmit.

FESL TXN names `GetSessionId`, `StartReport`, `EndReport`, `AddGameInfo`, `UpdateStats`, `GetStats`, `GetRankedStats`, `GetTopN`, `GetTopNAndStats` do appear, inside the FESL SDK string table (`\views\palantir-branch\jabba\fesl\source\`, beside `acct` and `club` TXNs). `GetGameSummary` and `gsum` do not. Presence in that table means the SDK was linked. The upload messages the game itself prints are the `SV_Community` snapshot lines above, not `StartReport`.

### 2.2 FESL `rank` and `gsum`

**Intent only.** `MASTER_PLAN.md` lines 95–97:

- `GetStats` / `UpdateStats`: player ranking data.
- `GetSessionID` / `GetGameSummary`: post-match telemetry reporting.

Line 176: `POST /internal/stats/report` “ingests match telemetry from `gsum`”.

**No FESL transcript** of a MOHPA client or dedicated server sending these TXNs is in this repo. The only exercised packets are synthetic unit tests (`packages/fesl-engine/test/handlers.test.ts` lines 309–344) that send `TXN=GetStats` and `TXN=GetSessionID` and assert a response exists. TXN name constants are `GetStats`, `UpdateStats`, `GetSessionID`, `GetGameSummary` (`packages/shared/src/types/fesl.ts` lines 91–95). Field lists beyond what the handlers themselves read are **not** defined anywhere in the repo. Do not invent them.

`games.ts` sets `supportedFeatures.hasTelemetry: true` (line 24). The only telemetry handler is `acct` `GetTelemetryToken`, which returns a random `cs_telem_…` string (`acct.ts` around line 308). That is not a stats upload.

### 2.3 Theater `UPLA`

`UPLA` updates the player row inside the live lobby: `SCORE`, `KILLS`, `DEATHS`, `PING`, `TEAM`, `STATUS` (`upla.ts` lines 24–38). `LobbyManager.updatePlayerAttributes` writes those fields on the in-memory `TheaterPlayer` and returns (`lobby-manager.ts` lines 379–404). It does not call `ApiClient` or `StatsRepository`.

`ECNL` removes the player from that map (`ecnl.ts`). `EGAM` enters the game (`egam.ts`). The Theater handler directory is `cgam`, `conn`, `echo`, `ecnl`, `egam`, `gdat`, `glst`, `kick`, `llst`, `ping`, `upla`, `user`. There is no end-of-round handler that flushes scores.

`CGAM` does copy a `ranked` flag onto the server registry (`lobby-manager.ts` lines 96–105: `isRanked: game.params.ranked !== '0'`). That boolean is stored on `game_servers`. It does not gate or trigger a stats write.

**Fact:** `UPLA` is lobby/live scoreboard state, not career persistence.

## 3. Wire sequences that are proven

### 3.1 Stats connection (SDK + this server)

Framing from `DoSend` (`gstats.c` lines 1028–1031): XOR the body with the repeating key, then append plaintext `\final\` (7 bytes). The key is built in `InternalInit` so `enc1` is `GameSpy3D`. This repo copies that as `GSTATS_XOR_KEY` (`gstats-server.ts` lines 4–17) and, for persist replies only, XOR-then-`\final\` (`buildGstatsPersistReply`, lines 47–49).

`InitStatsThink` waits until at least 38 bytes have arrived, comment “Receive the 38 byte challenge”, then XOR-decodes with `enc1` (`gstats.c` lines 343–365). This repo’s `buildGstatsChallenge` emits `\challenge\<32 chars>\id\1`, XOR-encoded, and refuses lengths outside 38–64 (`gstats-server.ts` lines 29–40). The “2004 recv is 64 bytes” sentence in that comment is **this repo’s constraint**, not a disassembly cited here. The `>= 38` wait **is** in the SDK file above. The unit test checks the 38-byte floor and the `challenge` key (`gstats.test.ts` lines 19–25 and 43–74).

Client auth, `SendChallengeResponse` (`gstats.c` lines 957–980):

```text
\auth\\gamename\%s\response\%s\port\%d\id\1
```

`response` is `MD5( sprintf("%d%s", g_crc32(challenge), gcd_secret_key) )`. `g_crc32` is not CRC-32; it is a multiply-by-`-1664117991` hash (`gstats.c` just after `xcode_buf`).

`RecvSessionKey` (`gstats.c` lines 994–1021) XOR-decodes the next recv, reads the key **`sesskey`**, and stores that integer in the global **`connid`**. It does not look for `\final\`. This repo answers any decoded buffer that contains `\auth\` or `\gamename\` with `\sesskey\<n>\id\1`, XOR-encoded, and does **not** check the MD5 (`gstats-server.ts` lines 142–146). The test calls that “the way RecvSessionKey decodes it” (`gstats.test.ts` lines 27–31).

**Fact:** the handshake can complete without a shared game secret. **Fact:** completing it does not store a profile or a match.

### 3.2 Match snapshot (SDK only)

`gstats.h` lines 79–80:

```c
#define SNAP_UPDATE 0
#define SNAP_FINAL  1
```

`NewGame`, when connected (`gstats.c` lines 504–507), sends:

```text
\newgame\\connid\%d\sesskey\%d
```

`connid` is the integer learned from the server’s `\sesskey\` value. `sesskey` is a local counter starting at `current_time()` (`NewGame` lines 495–496). The same function’s disk-log path uses an older format, commented in source (`gstats.c` line 520):

```text
\newgame\\sesskey\%d\challenge\%d
```

`SendGameSnapShotA` (`gstats.c` lines 573–606):

- Backslashes inside the snapshot are replaced with byte `0x01` before send.
- If `usebuckets` is set, the body is `DumpBucketSet` (`CreateBucketSnapShot`). `DumpMap` writes `\name\value` pairs (`gbucket.c` lines 274–280): int `%d`, float `%f`, string `%s`.
- The on-wire command, as commented on the current format string (`gstats.c` lines 599–606), is:

```text
\updgame\\sesskey\%d\connid\%d\done\%d\gamedata\%s
```

`done` is the `final` argument: `0` in progress, `1` final (`gstats.h` `SendGameSnapShot` comment, lines 271–272). A commented-out older format in the same function is `\updgame\\sesskey\%d\done\%d\gamedata\%s` without `connid` (`gstats.c` lines 599–602). The SDK does not wait for a reply; `DoSend` only checks that the bytes were written.

`NewPlayerA` sets a string bucket named `player` and an int bucket `ctime` (seconds since `NewGame`). Player buckets are renamed `name_<gstatsIndex>` (`PlayerOpString` / `NewPlayerA` in `gstats.c`). Team buckets get a `_t<index>` suffix. Those are the names the SDK emits when a title calls `NewPlayer` and `Bucket*Op`. MOHPA’s own identifiers are in §2.1.1 (`numKills`, `playTime`, the `total*` career list). How those names are indexed inside `gamedata` (`numKills_0` versus one blob, and which field is the soldier name) is still uncaptured. A title may also pass `usebuckets=0` and its own snapshot string (`SendGameSnapShotA` lines 582–585).

**This repo:** `gstatsPersistReplyFor` matches only `\authp\`, `\getpid\`, `\getpd\`, `\setpd\` (`gstats-server.ts` lines 52–67). `\newgame\` and `\updgame\` fall through, are logged as “decoded Nb”, and are discarded (`handleConnection` lines 140–152). No branch reads `gamedata`, `done`, `connid`, or `sesskey` on those commands.

### 3.3 Per-profile persist (SDK + the ACK this server sends)

`persisttype_t` is `pd_private_ro=0`, `pd_private_rw=1`, `pd_public_ro=2`, `pd_public_rw=3` (`gpersist.h` line 153). Read-only types are rejected client-side in `SetPersistDataHelper` (`gstats.c` lines 1294–1310). The header text says read-only data “can only be set on the server” (`gpersist.h` lines 146–149). **Inference:** ladder totals in a real GameSpy backend were server-side aggregates (or server-written `*_ro` blobs), not something the game client is allowed to `setpd`.

Commands the SDK sends (`gstats.c`):

| Function | Request | Reply the SDK parses |
| --- | --- | --- |
| `PreAuthenticatePlayerPM` (line 720) | `\authp\\pid\%d\resp\%s\lid\%d` | `ProcessPlayerAuth`: `\pauthr\<pid>\lid\<lid>` (line 1403) |
| `PreAuthenticatePlayerCDA` | `\authp\\nick\%s\keyhash\%s\resp\%s\lid\%d` | same |
| `GetProfileIDFromCDA` | `\getpid\\nick\%s\keyhash\%s\lid\%d` | `\getpidr\<pid>\lid\<lid>` |
| `GetPersistDataValuesModifiedA` (line 808) | `\getpd\\pid\%d\ptype\%d\dindex\%d\keys\%s\lid\%d` plus optional `\mod\<time>` | `ProcessGetData` (line 1441): `\getpdr\<success>\lid\<lid>\pid\<pid>\mod\<time>\length\<n>\data\<bytes>` |
| `SetPersistDataHelper` (line 1294) | `\setpd\\pid\%d\ptype\%d\dindex\%d\kv\%d\lid\%d\length\%d\data\` then raw bytes. `kv=0` replaces the blob; `kv=1` is a key/value patch | `ProcessSetData` (line 1472): `\setpdr\<success>\lid\<lid>\pid\<pid>\mod\<time>` |

`\final\` is plaintext and is not XOR’d (`ProcessInBuffer` XORs only the bytes before `\final\`).

**This repo’s replies** (`gstatsPersistReplyFor`):

- `\authp\` → `\pauthr\<pid>\lid\<lid>` (echoes the request pid, or `"1"`). No password check.
- `\getpid\` → `\getpidr\<pid>\lid\<lid>`.
- `\getpd\` → `\getpdr\1\lid\…\pid\…\mod\0\length\0\data\` (success, empty blob).
- `\setpd\` → `\setpdr\1\lid\…\pid\…\mod\0`. The `data` bytes are not saved.

The test uses `\getpd\\pid\1915791837\lid\1\ptype\0\dindex\0\keys\\` and expects `\getpdr\1` (`gstats.test.ts` lines 76–90). `ptype\0` is `pd_private_ro`.

**Fact:** persist is stubbed. A client that loads a career with `GetPersistData` gets a zero-length blob. The dedicated server’s upload log is the final snapshot (§2.1.1). The 602-byte key list is the career record a later `getpd` has to serve. Whether the game also `setpd`s that record itself is not shown by a capture; the SDK will not let the client write read-only persist types, so the stats server is the normal writer.

### 3.4 FESL handlers (this repo only)

`handleRank` (`rank.ts`):

- `GetStats`: if the packet has a `keys` array, every key is answered with `"0"`. Otherwise it returns fixed strings: `score=1000`, `rank=1`, `kills=25`, `deaths=10`, `wins=5`, `losses=2`, `timePlayed=3600` (lines 12–39). It does not read `persona_stats`.
- `UpdateStats`: `{ TXN: UpdateStats, status: 0 }` and ignores the body (lines 42–46).

`handleGsum` (`gsum.ts`):

- `GetSessionID`: a random UUID, not stored (lines 13–18).
- `GetGameSummary`: echoes `gameId` (default `"1"`) and `summary: "completed"` (lines 21–27). No other fields are read.

Neither function takes `apiClient` from the context. `ApiClient` methods that exist are auth, personas, account, and server register/heartbeat/list (`api-client.ts`). A repo search for `apiClient.` under `fesl-engine/src` hits only `acct.ts` and server registration in `server.ts`.

### 3.5 Theater `UPLA` (this repo only)

Request fields read: `TID`, `GID`, `PID`, `SCORE`, `KILLS`, `DEATHS`, `PING`, `TEAM`, `STATUS` (`upla.ts` lines 16–29). Success response: `TID`, `GID`, `PID`, `SUCCESS=1`. Unknown `PID`/`GID` returns `fieldErrorCode` 4004. The mock client sends the same names (`backend/test/mock-game-client.ts` around the `UPLA` helper). That test does not assert a database row.

## 4. Data model

### 4.1 Tables

`persona_stats` (`packages/db/src/migrations/001_initial_schema.sql` lines 75–84):

| Column | Type |
| --- | --- |
| `persona_id` | UUID PK, FK → `personas.id` |
| `score` | `BIGINT` default 0 |
| `kills`, `deaths`, `wins`, `losses` | `INTEGER` default 0 |
| `time_played_seconds` | `BIGINT` default 0 |
| `custom_stats` | `JSONB` default `{}` |

There is no column for a GameSpy integer profile id. `PersonaRepository.create` inserts a zero row (`persona-repository.ts` lines 26–31). Migration 002 backfills a zero row per persona (`002_ensure_user_personas_and_stats.sql` lines 13–20).

`match_history` (schema lines 90–99): `id` UUID, `server_id` UUID nullable FK, `game_slug`, `map_name`, `game_mode`, `duration_seconds`, `winner_team` nullable int, `details` JSONB, `created_at`. No per-player score table. Players would have to live inside `details` or as repeated `persona_stats` increments.

`game_servers.is_ranked` is unrelated to writing those tables (see §2.3).

### 4.2 `POST /internal/stats/report`

Route: `packages/api-service/src/routes/internal.ts` lines 157–202. Comment on the route: “Post-match telemetry reporting (gsum / rank update)”. That comment is intent. The handler itself is a generic increment.

JSON body it reads (all optional except `personaId`):

```json
{
  "personaId": "<personas.id UUID>",
  "score": 0,
  "kills": 0,
  "deaths": 0,
  "wins": 0,
  "losses": 0,
  "timePlayedSeconds": 0,
  "customStats": {},
  "match": {
    "serverId": null,
    "gameSlug": "mohpa",
    "mapName": "<required with gameSlug or the match is skipped>",
    "gameMode": "Conquest",
    "durationSeconds": 0,
    "winnerTeam": null,
    "details": {}
  }
}
```

`personaId` missing → 400. Numbers go to `StatsRepository.incrementStats`, which **adds** them to the current row (`stats-repository.ts` lines 84–111). `match` is inserted only when `match.gameSlug` and `match.mapName` are both set (route lines 185–196). `gameMode` defaults to the string `"Conquest"` if omitted. That default is the route, not a MOHPA mode.

Tests that define the body:

- `packages/api-service/test/api.test.ts` lines 331–358: `personaId`, `score: 2500`, `kills: 18`, `deaths: 4`, `wins: 1`, `timePlayedSeconds: 900`, and `match` `{ serverId, gameSlug: "mohpa", mapName: "Henderson Airfield", gameMode: "Invader", durationSeconds: 900, winnerTeam: 1 }`. Expects `updatedStats.score === 2500` and `recordedMatch.mapName`.
- `backend/test/api.test.ts` lines 481–508: same shape with `score: 3500`, map `"Minsk"`, `gameMode: "Titan"`.

Those tests call the HTTP route directly. They do not go through gstats, `gsum`, or `UPLA`.

**Constraint of this body:** one request increments **one** persona and, if `match` is present, inserts **one** `match_history` row. A snapshot with many players cannot be one request unless only one player is credited, or the match object is sent once and later calls omit `match`. That is how the existing route behaves, not a new API.

**Second constraint:** `incrementStats`’s `ON CONFLICT` updates the six counters and does **not** update `custom_stats` (`stats-repository.ts` lines 90–96). `customStats` on the report is stored only when the persona has no row yet. `upsertStats` does write `custom_stats`, but the report route does not call `upsertStats`.

### 4.3 Ids do not line up

`persona_stats.persona_id` is the persona UUID. GameSpy `\authp\` / `\getpd\` / `\setpd\` use an integer `pid`. FESL login returns `toGsNumericId(user.userId)` as both `userId` and `profileId` (`acct.ts` lines 64–82). `toGsNumericId` hashes a non-numeric string with a 31-multiplier into `1 … 1999999999` (`ticket-store.ts` lines 22–35). GPCM login echoes that hash as `profileid` (`gpcm-server.ts` lines 168–186). The hash is not reversed anywhere, and `GsStatsServer` does not know it. A gstats `pid` cannot be used as `personaId` on `/internal/stats/report` without a lookup this code does not have.

**Inference, grounded in the schema that exists:** the join key this database can do today is the soldier name (`PersonaRepository.findByNameAndGame`, `persona-repository.ts` lines 44–48), which is what the SDK puts in the `player_<n>` bucket **if** the title uses `NewPlayer`. **Unknown:** whether MOHPA’s snapshot contains that bucket or a different name field.

## 5. What the portal displays

The portal never talks to gstats, FESL, or Theater. It reads HTTP.

| UI | Call | Source |
| --- | --- | --- |
| `/leaderboards` and `/stats` (same page) | `GET /api/v1/stats/leaderboard/:game_slug?sort=&limit=&offset=` | `frontend/src/services/statsService.ts` lines 11–35; route `stats.ts` lines 10–33; router `frontend/src/app/router.tsx` lines 55–61 |
| `/stats/player/:name` | `GET /api/v1/stats/players/:name?game_slug=` | `statsService.ts` lines 42–52; route `stats.ts` lines 37–90 |
| Soldiers list and dashboard | `GET /api/v1/personas` (stats embedded) | `personas.ts` lines 18–29 |
| Soldier detail | `GET /api/v1/personas/:id/stats` | `personas.ts` lines 101–121; `frontend/src/services/personaService.ts` |

Leaderboard columns rendered: rank, soldier, score, kills, deaths, K/D, wins, losses, win rate, hours (`Leaderboards.tsx` lines 241–250). Sort query values handled by the API: `score` (default), `kills`, `wins`, `playtime` (`stats.ts` line 19, `stats-repository.ts` lines 120–125).

`getLeaderboard` left-joins `users` → `personas` → `persona_stats` and `COALESCE`s nulls to 0 (`stats-repository.ts` lines 128–148). Banned users are excluded. A user with no games still appears at score 0 (repository test, `packages/db/test/repositories.test.ts` lines 163–174). An empty-looking career on the portal is what this query returns when nobody has called `incrementStats`.

`PlayerProfile.tsx` lines 96–138 builds Assault / Recon / Engineer / Support rows by multiplying `score`, `kills`, and hours by constants (`0.38`, `0.42`, …). The comment in the file says “dynamically synthesized or from customStats”. The code shown uses the constants. It does not read `customStats`. Those class numbers are **not** server telemetry.

`statsService.getMatchHistory` calls `GET /api/v1/stats/matches/:game_slug` (`statsService.ts` lines 59–66; API `stats.ts` lines 94–109). No page imports it. Only `frontend/src/test/stats-setup.test.tsx` calls it. Match rows, even if some were inserted, are not on the leaderboard or the player page.

Public stats routes have no writer. The only production caller of `incrementStats` / `recordMatch` is `POST /internal/stats/report`.

## 6. Gap analysis

Dedicated server finishes a round. Each hop is what the code does today.

| Hop | Status | Function |
| --- | --- | --- |
| Game will not upload unless GameSpy, PunkBuster, and `sv_pure` are on | Game-side gate, not our code | `sv_community` log string in `mohpa_server.exe` |
| TCP 29920 accept | Implemented | `GsStatsServer.start` / `handleConnection` |
| XOR challenge `\challenge\…\id\1` | Implemented | `buildGstatsChallenge` |
| Live first payload (243 bytes, no `\final\`, not decoded as `\auth\`) | Not handled. No sesskey, peer closes in ~100 ms, snapshot never starts. | `handleConnection` |
| `\auth\\gamename\…\response\…\port\…\id\1` → `\sesskey\` | Implemented for a buffer that XOR-decodes to those keys. MD5 is not checked. Nothing is stored. Not reached by the 243-byte writes. | `handleConnection` |
| `\newgame\\connid\…\sesskey\…` | Stubbed at the socket. Bytes are decoded and ignored. No game row. | no function; `gstatsPersistReplyFor` returns `undefined` |
| `\updgame\…\done\0\gamedata\…` (in-progress snap) | Same. Dropped. | same |
| `\updgame\…\done\1\gamedata\…` (final snap) | Same. This is the SDK’s end-of-match payload. Dropped. | same |
| Unescape `0x01` → `\`, split buckets, map player → persona UUID | Absent | — |
| `\authp\` / `\getpid\` | Stubbed. Echo pid, no account check. | `gstatsPersistReplyFor` |
| `\getpd\` | Stubbed. `\length\0`, no read of `persona_stats`. | `gstatsPersistReplyFor` |
| `\setpd\` body | Stubbed. ACK `\setpdr\1`, body discarded. | `gstatsPersistReplyFor` |
| `ApiClient` method that POSTs `/internal/stats/report` | Absent | `ApiClient` has no such method |
| `POST /internal/stats/report` → `incrementStats` + `recordMatch` | Implemented, unreachable from the protocol servers | route in `internal.ts`; `StatsRepository.incrementStats`, `recordMatch` |
| FESL `rank` `GetStats` | Stubbed. Hardcoded or `"0"`. Not the database. | `handleRank` |
| FESL `rank` `UpdateStats` | Stubbed. `status: 0`, body ignored. | `handleRank` |
| FESL `gsum` `GetSessionID` | Stubbed. Random UUID, not stored. | `handleGsum` |
| FESL `gsum` `GetGameSummary` | Stubbed. `{ summary: "completed" }`. | `handleGsum` |
| Theater `UPLA` | Implemented for lobby memory only | `handleUpla`, `updatePlayerAttributes` |
| Theater end-of-round flush | Absent | no handler |
| Portal read | Implemented, shows the zero rows | `stats.ts` `getLeaderboard` / `players/:name` |

`isRanked` on the server row does not appear in any of those functions as a write gate.

## 7. What “should work” means

The dedicated server is the writer. The client is the reader. `UPLA` is neither.

**Upload (dedicated server).** With `sv_community` enabled and GameSpy, PunkBuster, and `sv_pure` on, `SV_Community` does what the SDK calls `InitStatsConnection` + `NewGame` + `SendGameSnapShot`:

1. TCP connect to `gamestats` port 29920. The server speaks first: XOR `\challenge\…\id\1` (38–64 bytes). The game answers `\auth\\gamename\%s\response\%s\port\%d\id\1` and expects `\sesskey\<n>\id\1`. It stores that integer as `connid`. `response` is `MD5(sprintf("%d%s", g_crc32(challenge), secret))`. This process does not check it. The live 243-byte writes never get a sesskey, so they die here.
2. `\newgame\\connid\<that value>\sesskey\<local>`. No reply. The exe also contains the disk-log variant `\newgame\\sesskey\%d\challenge\%d`.
3. During the match, `\updgame\…\done\0\gamedata\…` (`SNAP_UPDATE`).
4. When the game ends normally, the same command with `done\1` (`SNAP_FINAL`). That is the “final stat snapshot” log line. Failure logs “stats connection broken”, “data error”, or “unknown error”. Backslashes inside `gamedata` are byte `0x01` on the wire.

`gamedata` for one match is per-match numbers (`numKills`, `playTime`, `numSuicides`, `matchStarted`, `matchCompleted`, plus whatever else that match’s buckets hold). It is not the career blob. Adding those per-match numbers into `persona_stats` is what `incrementStats` already does. The career key list is what a later `getpd` must return so the client’s “Retrieving stats…” step and the server’s join restrictions (`totalPlayTime_Ranked`, `totalNumKills`, `totalTeamBonusPoints`) see the same totals.

**Read-back (client, and the dedicated server when it enforces restrictions).** After the profile is authenticated (`\authp\` → `\pauthr\`), `\getpd\` asks for keys and must get `\getpdr\1\…\length\<n>\data\<kv>` built from `persona_stats` / `custom_stats`. Today the reply is `length\0`. `\setpd\` from the game, if one arrives, has to be stored too; the SDK refuses client writes of read-only persist types, so the usual writer of those career keys is the stats server applying snapshots, not the client.

**Map onto the tables that already exist**, without inventing columns:

| Game key | Where it goes |
| --- | --- |
| `numKills` (per match) / `totalNumKills` (career) | `persona_stats.kills` as a per-match delta |
| `totalNumDeaths` | `deaths` |
| `playTime` (per match); career is `totalPlayTime_FFA` + `totalPlayTime_TeamMatch` + `totalPlayTime_Invader` | `time_played_seconds` |
| `totalTeamBonusPoints` | closest existing counter is `score`; confirm against one real snapshot before treating it as score |
| medal and weapon keys (`totalAlliedMostAccurate`, `accuracy`, `totalNumShots`, corpsman, demo, …) | `custom_stats` |
| map, gametype, duration, full bucket dump | one `match_history` row; players inside `details` |

`wins` and `losses` are columns the portal shows and the report route increments. They are not in the career key list. Leave them at 0 until a snapshot shows a key that means win or loss. `incrementStats` does not merge `custom_stats` on an existing row (`stats-repository.ts` lines 90–96), so medal keys need a write that actually updates that JSON.

**Identity.** `personaId` on the report route is the persona UUID. The snapshot’s GameSpy `pid` is not that UUID (`toGsNumericId` is one-way). Resolve the soldier by the name in the snapshot (`player_<n>` if they used `NewPlayer`, or whatever name field the first real `gamedata` contains). Preauth (`\authp\`) is how the SDK ties a player to a profile before that name is trusted; this server currently echoes `\pauthr\` with no check.

**Not this path.**

- Theater `UPLA` stays lobby memory.
- FESL `rank` / `gsum` stay stubs. `GetGameSummary` is not in the exe. `StartReport` / `EndReport` / `GetSessionId` are FESL SDK string-table entries, and no `gsum` or `rank` packet has shown up in the `fesl-engine` log. The master-plan route can stay as the HTTP ingest the snapshot parser calls. It is not a second wire protocol the dedicated server is speaking.
- The `IsStatsConnected` patch only forces the client login check. Upload still needs a real stats socket.

Still unknown, and worth one hex dump of the next 29920 connection before writing the parser:

- Why the live 243-byte write has no `\final\` and does not XOR to `\auth\`.
- The exact `gamedata` key layout (player index suffix vs one blob) and which field is the soldier name.
- Whether `totalTeamBonusPoints` should be stored as `score`.

## 8. Sources

**This repo**

- `backend/MASTER_PLAN.md` — design intent for `rank`, `gsum`, `UPLA`, `persona_stats`, `POST /internal/stats/report`.
- `backend/packages/fesl-engine/src/gamespy/gstats-server.ts`, `backend/packages/fesl-engine/test/gstats.test.ts`.
- `backend/packages/fesl-engine/src/fesl/handlers/rank.ts`, `gsum.ts`, `acct.ts` (`GetTelemetryToken`, numeric `profileId`).
- `backend/packages/fesl-engine/src/fesl/router.ts` — registers `rank` and `gsum`.
- `backend/packages/fesl-engine/src/api-client/api-client.ts` — no stats call.
- `backend/packages/fesl-engine/src/gamespy/gpcm-server.ts`, `ticket-store.ts` (`toGsNumericId`).
- `backend/packages/fesl-engine/src/theater/handlers/upla.ts`, `ecnl.ts`, `egam.ts`, `lobby-manager.ts`.
- `backend/packages/fesl-engine/src/server.ts`, `config/config.ts` — TCP 29920.
- `backend/packages/fesl-engine/test/handlers.test.ts` — synthetic `GetStats` / `GetSessionID`.
- `backend/packages/api-service/src/routes/internal.ts`, `stats.ts`, `personas.ts`.
- `backend/packages/api-service/test/api.test.ts`, `backend/test/api.test.ts` — report body.
- `backend/packages/db/src/migrations/001_initial_schema.sql`, `002_ensure_user_personas_and_stats.sql`.
- `backend/packages/db/src/repositories/stats-repository.ts`, `persona-repository.ts`, `db/test/repositories.test.ts`.
- `backend/packages/shared/src/types/fesl.ts`, `shared/src/config/games.ts`.
- `client-patches/mohpa/patcher.py`, `client-patches/mohpa/README.md`.
- `frontend/src/services/statsService.ts`, `frontend/src/types/stats.ts`, `frontend/src/pages/stats/Leaderboards.tsx`, `PlayerProfile.tsx`, `frontend/src/app/router.tsx`.

**GameSpy SDK (OpenMoHAA tree, original `gstats.c` / `gpersist.h` / `gbucket.c`, not a blog summary)**

- [gstats.c](https://github.com/openmoh/openmohaa/blob/main/code/gamespy/gstats/gstats.c) — `InitStatsThink`, `IsStatsConnected`, `NewGame`, `SendGameSnapShotA`, `SendChallengeResponse`, `RecvSessionKey`, `DoSend`, `xcode_buf`, `PreAuthenticatePlayerPM`, `GetPersistDataValuesModifiedA`, `SetPersistDataHelper`, `ProcessPlayerAuth`, `ProcessGetData`, `ProcessSetData`.
- [gstats.h](https://github.com/openmoh/openmohaa/blob/main/code/gamespy/gstats/gstats.h) — `SNAP_UPDATE`, `SNAP_FINAL`, `NewGame`, `SendGameSnapShot`.
- [gpersist.h](https://github.com/openmoh/openmohaa/blob/main/code/gamespy/gstats/gpersist.h) — `persisttype_t`.
- [gbucket.c](https://github.com/openmoh/openmohaa/blob/main/code/gamespy/gstats/gbucket.c) — `DumpBucketSet` / `DumpMap`.

Same files are also packaged by Debian as `openmohaa` `code/gamespy/gstats/`. They are the Allied Assault tree’s copy of the SDK. The MOHPA 1.2 `mohpa_server.exe` / `mohpa.exe` strings in §2.1.1 were read from those binaries (format blobs decoded with `ProjectAphex`). They are not in this git repo.

**Live log.** `fesl-engine` `[GsStats]` lines for the process that was logging on 22 Sep 2026: four `RAW 243b` / `decoded 243b` connections, one `RAW 8b`, no `SEND sesskey`, no `SEND persist`, no `RECV gsum` / `RECV rank`. Payloads were not retained.
