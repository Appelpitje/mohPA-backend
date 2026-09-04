/**
 * CentralSpy End-to-End Simulation & Integration Orchestrator
 *
 * Full Lifecycle:
 * 1. Starts Central API Service (with in-memory database).
 * 2. Pre-seeds master users, personas, entitlements, and admin accounts.
 * 3. Starts FESL & Theater Protocol Engine (ports 18270, 18051, 18275, 18056).
 * 4. Runs Mock Dedicated Server to authenticate and register game via CGAM.
 * 5. Runs Mock Game Client to authenticate, select persona, browse server list, join game, and report telemetry.
 * 6. Asserts complete end-to-end handshake fidelity.
 * 7. Gracefully tears down all services with exit code 0.
 */

import { FastifyInstance } from 'fastify';
import { MemoryDbClient } from '@centralspy/db';
import { buildServer } from '@centralspy/api-service';
import { FeslEngineServer } from '@centralspy/fesl-engine';
import { MockDedicatedServer } from './mock-dedicated-server.js';
import { MockGameClient } from './mock-game-client.js';
import bcrypt from 'bcryptjs';

const API_PORT = 3000;
const FESL_CLIENT_PORT = 18020;
const FESL_SERVER_PORT = 18051;
const THEATER_CLIENT_PORT = 18275;
const THEATER_SERVER_PORT = 18056;

const INTERNAL_API_KEY = 'centralspy-internal-secret-token';
const JWT_SECRET = 'centralspy-e2e-simulation-jwt-secret';

function log(section: string, message: string) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`\x1b[36m[${timestamp}]\x1b[0m \x1b[1m\x1b[33m[${section}]\x1b[0m ${message}`);
}

function success(message: string) {
  console.log(`\x1b[32m✔ ${message}\x1b[0m`);
}

async function runSimulation() {
  console.log('\n================================================================');
  console.log('       CENTRALSPY END-TO-END SYSTEM INTEGRATION SIMULATION      ');
  console.log('================================================================\n');

  let apiServer: FastifyInstance | null = null;
  let feslEngine: FeslEngineServer | null = null;
  let dedicatedServer: MockDedicatedServer | null = null;
  let gameClient: MockGameClient | null = null;

  try {
    // -----------------------------------------------------------------------
    // Step 1: Initialize Database & Seed Accounts
    // -----------------------------------------------------------------------
    log('1. Database', 'Initializing In-Memory Database and seeding accounts...');
    const db = new MemoryDbClient();

    const passwordHash = await bcrypt.hash('SecretPassword123', 8);
    const serverHostHash = await bcrypt.hash('DedicatedHostPassword123', 8);

    // Create client user: TestCommander
    const userRes = await db.query(
      `INSERT INTO users (username, email, password_hash, country_code, is_admin)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING *`,
      ['TestCommander', 'commander@centralspy.net', passwordHash, 'US']
    );
    const clientUser = userRes.rows[0];

    // Create dedicated server user: mohpa_server_host
    await db.query(
      `INSERT INTO users (username, email, password_hash, country_code, is_admin)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING *`,
      ['mohpa_server_host', 'server@centralspy.net', serverHostHash, 'US']
    );

    // Create admin user: RootAdmin
    await db.query(
      `INSERT INTO users (username, email, password_hash, country_code, is_admin)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING *`,
      ['RootAdmin', 'admin@centralspy.net', passwordHash, 'US']
    );

    // Seed persona: Pvt_Conlin for MOHPA
    const personaRes = await db.query(
      `INSERT INTO personas (user_id, game_slug, name, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING *`,
      [clientUser.id, 'mohpa', 'Pvt_Conlin']
    );
    const clientPersona = personaRes.rows[0];

    // Seed persona stats initial record
    await db.query(
      `INSERT INTO persona_stats (persona_id, score, kills, deaths, wins, losses, time_played_seconds)
       VALUES ($1, 5000, 45, 12, 5, 2, 3600)`,
      [clientPersona.id]
    );

    // Seed entitlement for MOHPA
    await db.query(
      `INSERT INTO entitlements (user_id, game_slug, cd_key, is_used)
       VALUES ($1, $2, $3, TRUE)`,
      [clientUser.id, 'mohpa', 'MOHPA-SIMU-LATION-KEY1']
    );

    success(`Seeded database with User '${clientUser.username}' and Soldier '${clientPersona.name}'`);

    // -----------------------------------------------------------------------
    // Step 2: Start API Service
    // -----------------------------------------------------------------------
    log('2. API Service', `Starting REST & Internal IPC Service on port ${API_PORT}...`);
    apiServer = await buildServer({
      db,
      jwtSecret: JWT_SECRET,
      internalApiKey: INTERNAL_API_KEY,
    });
    await apiServer.listen({ port: API_PORT, host: '127.0.0.1' });
    success(`API Service running at http://127.0.0.1:${API_PORT}`);

    // -----------------------------------------------------------------------
    // Step 3: Start FESL & Theater Engine
    // -----------------------------------------------------------------------
    log('3. FESL Engine', 'Starting FESL & Theater Multi-Port TCP/TLS Engine...');
    feslEngine = new FeslEngineServer();
    await feslEngine.start([
      { port: FESL_CLIENT_PORT, isTls: true, name: 'FESL Client (TLS)' },
      { port: FESL_SERVER_PORT, isTls: true, name: 'FESL Server (TLS)' },
      { port: THEATER_CLIENT_PORT, isTls: false, name: 'Theater Client (TCP)' },
      { port: THEATER_SERVER_PORT, isTls: false, name: 'Theater Server (TCP)' },
    ]);
    success('FESL & Theater Protocol Engine successfully listening on ports 18020, 18051, 18275, 18056');

    // -----------------------------------------------------------------------
    // Step 4: Run Mock Dedicated Server
    // -----------------------------------------------------------------------
    log('4. Dedicated Server', 'Launching Mock Dedicated Game Server...');
    dedicatedServer = new MockDedicatedServer({
      feslHost: '127.0.0.1',
      feslPort: FESL_SERVER_PORT,
      theaterHost: '127.0.0.1',
      theaterPort: THEATER_SERVER_PORT,
      serverName: 'CentralSpy MOHPA Pacific Server [Ranked]',
      gameSlug: 'mohpa',
      gamePort: 13200,
      queryPort: 29900,
      maxPlayers: 64,
      mapName: 'Henderson Airfield',
      gameMode: 'Invader',
      isRanked: true,
      username: 'mohpa_server_host',
      password: 'DedicatedHostPassword123',
      verbose: true,
    });

    const registeredGid = await dedicatedServer.start();
    if (!registeredGid || registeredGid <= 0) {
      throw new Error(`Dedicated server failed to register (invalid GID: ${registeredGid})`);
    }
    success(`Dedicated Game Server registered with GID #${registeredGid}`);

    // Setup host listener promise to verify client join notification
    const playerJoinedPromise = dedicatedServer.waitForPlayerJoin(undefined, 8000);

    // -----------------------------------------------------------------------
    // Step 5: Run Mock Game Client
    // -----------------------------------------------------------------------
    log('5. Game Client', 'Launching Mock Game Client & Initiating Handshake...');
    gameClient = new MockGameClient({
      feslHost: '127.0.0.1',
      feslPort: FESL_CLIENT_PORT,
      theaterHost: '127.0.0.1',
      theaterPort: THEATER_CLIENT_PORT,
      username: 'TestCommander',
      password: 'SecretPassword123',
      gameSlug: 'mohpa',
      personaName: 'Pvt_Conlin',
      verbose: true,
    });

    // 5.1 FESL Handshake & Authentication
    await gameClient.connectFesl();
    const hello = await gameClient.sendHello();
    if (!hello.curTime) throw new Error('fsys.Hello missing server time');
    success(`FESL Hello verified: Time='${hello.curTime}', Partition='${hello.domainPartition}'`);

    const login = await gameClient.sendNuLogin();
    if (!login.lkey) throw new Error('acct.NuLogin failed: no master lkey received');
    success(`FESL NuLogin verified: Master LKEY='${login.lkey.substring(0, 10)}...'`);

    const personas = await gameClient.getPersonas();
    if (!personas.includes('Pvt_Conlin')) {
      throw new Error(`Expected persona 'Pvt_Conlin' not in persona list: [${personas.join(', ')}]`);
    }
    success(`FESL NuGetPersonas verified: Soldiers=[${personas.join(', ')}]`);

    const personaLogin = await gameClient.loginPersona('Pvt_Conlin');
    if (!personaLogin.lkey) throw new Error('acct.NuLoginPersona failed: no persona lkey received');
    success(`FESL NuLoginPersona verified: Persona LKEY='${personaLogin.lkey.substring(0, 10)}...'`);

    // 5.2 Theater Connection & Game Browser
    await gameClient.connectTheater();
    await gameClient.theaterConn();
    await gameClient.theaterUser();
    success('Theater CONN and USER handshake established');

    const serverList = await gameClient.listGames();
    if (serverList.length === 0) {
      throw new Error('Theater GLST returned 0 games; expected registered server');
    }
    const foundServer = serverList.find((s) => s.gid === registeredGid);
    if (!foundServer) {
      throw new Error(`Registered GID #${registeredGid} not found in GLST results`);
    }
    success(`Theater GLST found game server '${foundServer.name}' (Port ${foundServer.port})`);

    // 5.3 Enter Game (EGAM)
    const joinResult = await gameClient.enterGame(registeredGid, 1);
    if (!joinResult.ticket) {
      throw new Error('Theater EGAM did not return valid join ticket');
    }
    success(`Theater EGAM join ticket issued: Ticket='${joinResult.ticket}', Slot #${joinResult.slot}`);

    // Verify dedicated server received EGRQ and confirmed player join
    const joinedPlayer = await playerJoinedPromise;
    if (joinedPlayer.name !== 'Pvt_Conlin') {
      throw new Error(`Dedicated server expected player 'Pvt_Conlin', but got '${joinedPlayer.name}'`);
    }
    success(`Dedicated Server confirmed join of player '${joinedPlayer.name}' in Slot #${joinedPlayer.slot}`);

    // 5.4 Update Player Stats (UPLA)
    const uplaSuccess = await gameClient.updatePlayerAttributes(registeredGid, {
      score: 2500,
      kills: 15,
      deaths: 3,
      ping: 32,
      team: 1,
    });
    if (!uplaSuccess) {
      throw new Error('Theater UPLA stats update failed');
    }
    success('Player attributes updated via Theater UPLA (Score: 2500, Kills: 15, Ping: 32ms)');

    // 5.5 Ping Probe
    const latency = await gameClient.pingTheater();
    success(`Theater latency keepalive ping confirmed: timestamp=${latency}`);

    // -----------------------------------------------------------------------
    // Step 6: Summary & Verification
    // -----------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('               END-TO-END HANDSHAKE VERIFICATION PASSED         ');
    console.log('----------------------------------------------------------------');
    console.log(`✔ API Service:           HTTP & IPC operational`);
    console.log(`✔ FESL Client Listener:  TLS 18020 Handshake OK`);
    console.log(`✔ FESL Server Listener:  TLS 18051 Handshake OK`);
    console.log(`✔ Theater Engine:        TCP 18275 / 18056 Handshake OK`);
    console.log(`✔ Dedicated Server Host: Registered GID #${registeredGid} & confirmed join`);
    console.log(`✔ Game Client:           Authenticated, selected soldier, joined server`);
    console.log(`✔ Roster State:          ${dedicatedServer.players.size} connected players`);
    console.log(`✔ Total Errors:          0`);
    console.log('----------------------------------------------------------------\n');

  } catch (err: any) {
    console.error('\n\x1b[31m❌ End-to-End Simulation Failed:\x1b[0m', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  } finally {
    // -----------------------------------------------------------------------
    // Step 7: Teardown & Graceful Shutdown
    // -----------------------------------------------------------------------
    log('Teardown', 'Cleaning up connections and shutting down test servers...');

    if (gameClient) {
      await gameClient.disconnect().catch(() => {});
    }

    if (dedicatedServer) {
      await dedicatedServer.stop().catch(() => {});
    }

    if (feslEngine) {
      await feslEngine.stop().catch(() => {});
    }

    if (apiServer) {
      await apiServer.close().catch(() => {});
    }

    log('Teardown', 'All test processes and sockets terminated cleanly.');
  }
}

// Run simulation if executed directly
if (
  process.argv[1] &&
  (process.argv[1].endsWith('e2e-simulation.ts') || process.argv[1].endsWith('e2e-simulation.js'))
) {
  runSimulation()
    .then(() => {
      process.exit(process.exitCode || 0);
    })
    .catch((err) => {
      console.error('Fatal simulation error:', err);
      process.exit(1);
    });
}
