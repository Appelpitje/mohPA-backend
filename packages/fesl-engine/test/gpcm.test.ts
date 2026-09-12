import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { GpcmServer } from '../src/gamespy/gpcm-server.js';
import { saveGsPreauth } from '../src/gamespy/ticket-store.js';
import { gpClientResponse, gpServerProof, gpProof } from '../src/gamespy/gp-proof.js';

function readUntilFinal(socket: net.Socket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('ascii');
      if (buf.includes('\\final\\')) {
        clearTimeout(timer);
        socket.off('data', onData);
        resolve(buf);
      }
    };
    socket.on('data', onData);
  });
}

describe('GameSpy GP proof order', () => {
  it('matches gpiConnect.c / eaEmu gs_login_proof challenge order', () => {
    const pwd = 'partner-challenge';
    const user = 'authtoken-value';
    const client = 'clientCHALLENGE0123456789abcdef';
    const server = 'serverCHALLENGE0123456789abcdef';
    expect(gpClientResponse(pwd, user, client, server)).toBe(gpProof(pwd, user, client, server));
    expect(gpServerProof(pwd, user, client, server)).toBe(gpProof(pwd, user, server, client));
    expect(gpClientResponse(pwd, user, client, server)).not.toBe(
      gpServerProof(pwd, user, client, server)
    );
  });

  it('matches the live MOHPA preauth login response', () => {
    const pwd = '7e3ee50cf6ddfa9e5ffaca10d4fb3d7e';
    const user = '4e75abbe311f9c309e016b0b13696375';
    const client = 'VE0afTZRp1fgZDn2uAb2nLZjO1sHqo0W';
    const server = 'eVQw96NgFHFM75xTmYLn2fGMmcftRpDT';
    expect(gpClientResponse(pwd, user, client, server)).toBe('b41587a69bf560adccac55bd4231f8fe');
  });
});

describe('GameSpy GPCM preauth login', () => {
  let server: GpcmServer | null = null;
  const port = 39900 + Math.floor(Math.random() * 1000);

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('accepts a FESL GameSpyPreAuth ticket and returns lc=2', async () => {
    const ticket = 'aabbccddeeff00112233445566778899';
    const partnerChallenge = '11223344556677889900aabbccddeeff';
    saveGsPreauth({
      ticket,
      challenge: partnerChallenge,
      lkey: 'test-lkey',
      userId: '3def9fef-e0b7-43dc-9f96-129e8a69a353',
      username: 'Appelpitje',
    });

    server = new GpcmServer();
    await server.start('127.0.0.1', port);

    const client = net.connect({ host: '127.0.0.1', port });
    const hello = await readUntilFinal(client);
    expect(hello).toContain('\\lc\\1');
    expect(hello).toContain('\\challenge\\');
    expect(hello).not.toContain('\r\n');

    const serverChallenge = hello.split('\\challenge\\')[1].split('\\')[0];
    const clientChallenge = 'CliChal0123456789abcdef01234567';
    const response = gpClientResponse(partnerChallenge, ticket, clientChallenge, serverChallenge);

    client.write(
      `\\login\\\\authtoken\\${ticket}\\challenge\\${clientChallenge}\\response\\${response}\\firewall\\1\\port\\0\\productid\\1\\gamename\\mohpa\\namespaceid\\0\\id\\1\\final\\`
    );

    const login = await readUntilFinal(client);
    expect(login).toContain('\\lc\\2');
    expect(login).toContain('\\uniquenick\\Appelpitje');
    expect(login).toContain('\\userid\\');
    const expectedProof = gpServerProof(partnerChallenge, ticket, clientChallenge, serverChallenge);
    expect(login).toContain(`\\proof\\${expectedProof}`);

    client.destroy();
  });
});
