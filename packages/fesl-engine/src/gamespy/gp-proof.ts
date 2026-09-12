import * as crypto from 'node:crypto';

function md5hex(value: string): string {
  return crypto.createHash('md5').update(value, 'ascii').digest('hex');
}

/**
 * GameSpy GP proof (gpiConnect.c / eaEmu gs_login_proof):
 * MD5( MD5(password) + 48 spaces + user + challengeA + challengeB + MD5(password) )
 *
 * Client response concatenates (clientChallenge, serverChallenge).
 * Server proof concatenates (serverChallenge, clientChallenge).
 * For partner/preauth login, `password` is the FESL partner challenge and
 * `user` is the authtoken.
 */
export function gpProof(
  password: string,
  user: string,
  firstChallenge: string,
  secondChallenge: string
): string {
  const passHash = md5hex(password);
  return md5hex(`${passHash}${' '.repeat(48)}${user}${firstChallenge}${secondChallenge}${passHash}`);
}

export function gpClientResponse(
  password: string,
  user: string,
  clientChallenge: string,
  serverChallenge: string
): string {
  return gpProof(password, user, clientChallenge, serverChallenge);
}

export function gpServerProof(
  password: string,
  user: string,
  clientChallenge: string,
  serverChallenge: string
): string {
  return gpProof(password, user, serverChallenge, clientChallenge);
}
