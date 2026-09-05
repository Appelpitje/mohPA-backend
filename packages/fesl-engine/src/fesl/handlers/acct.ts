import * as crypto from 'node:crypto';
import { FeslPacket, FESL_TXN } from '@centralspy/shared';
import {
  FeslHandlerContext,
  getPacketString,
  getPacketArray,
  getPacketTxn,
} from '../types.js';

/**
 * Handles acct subsystem commands: Login, NuLogin, NuGetPersonas, GetPersonas,
 * NuLoginPersona, LoginPersona, GetSubAccounts, GetAccount, UpdateAccount,
 * NuLookupUserInfo, GameSpyPreAuth, GetTelemetryToken.
 */
export async function handleAcct(ctx: FeslHandlerContext): Promise<Record<string, any> | FeslPacket | void> {
  const { connection, packet, sessionStore, apiClient } = ctx;
  const txn = getPacketTxn(packet);

  switch (txn) {
    case FESL_TXN.NU_LOGIN:
    case FESL_TXN.LOGIN: {
      const identifier =
        getPacketString(packet, 'nuid') ||
        getPacketString(packet, 'name') ||
        getPacketString(packet, 'email') ||
        getPacketString(packet, 'encryptedInfo');
      const password = getPacketString(packet, 'password');

      if (!identifier) {
        return {
          TXN: txn,
          errorContainer: [
            { fieldName: 'name', fieldError: 'Missing account identifier', fieldErrorCode: 1001 },
          ],
        };
      }

      const authResult = await apiClient.validateCredentials(identifier, password, connection.remoteAddress);
      if (!authResult.valid || !authResult.user) {
        return {
          TXN: txn,
          errorContainer: [
            { fieldName: 'password', fieldError: authResult.error || 'Invalid username or password', fieldErrorCode: 1000 },
          ],
        };
      }

      const user = authResult.user;

      // Create master session in Redis / memory store
      const session = await sessionStore.createSession({
        userId: user.userId,
        username: user.username,
        clientType: connection.clientType,
        ip: connection.remoteAddress,
        gameSlug: connection.gameSlug,
        sku: connection.sku,
        locale: connection.locale,
      });

      connection.attachSession(session);

      if (txn === FESL_TXN.NU_LOGIN) {
        return {
          TXN: FESL_TXN.NU_LOGIN,
          lkey: session.lkey,
          userId: user.userId,
          profileId: user.userId,
          nuid: user.email || user.username,
          displayName: user.username,
        };
      }

      return {
        TXN: FESL_TXN.LOGIN,
        lkey: session.lkey,
        userId: user.userId,
        profileId: user.userId,
        displayName: user.username,
        nuid: user.email || user.username,
      };
    }

    case FESL_TXN.NU_GET_PERSONAS:
    case FESL_TXN.GET_PERSONAS: {
      let currentSession = connection.session;

      // If connection doesn't have an attached session, check if lkey was passed
      const lkey = getPacketString(packet, 'lkey');
      if (!currentSession && lkey) {
        currentSession = await sessionStore.getSession(lkey);
        if (currentSession) {
          connection.attachSession(currentSession);
        }
      }

      if (!currentSession) {
        return {
          TXN: txn || FESL_TXN.GET_PERSONAS,
          errorContainer: [
            { fieldName: 'lkey', fieldError: 'Not authenticated', fieldErrorCode: 2001 },
          ],
        };
      }

      const personas = await apiClient.getPersonas(currentSession.userId, connection.gameSlug);
      const personaNames = personas.map((p) => p.name);

      return {
        TXN: txn,
        personas: personaNames,
      };
    }

    case FESL_TXN.NU_LOGIN_PERSONA:
    case FESL_TXN.LOGIN_PERSONA: {
      const personaName = getPacketString(packet, 'name');
      let currentSession = connection.session;

      const lkey = getPacketString(packet, 'lkey');
      if (!currentSession && lkey) {
        currentSession = await sessionStore.getSession(lkey);
        if (currentSession) {
          connection.attachSession(currentSession);
        }
      }

      if (!currentSession) {
        return {
          TXN: txn || FESL_TXN.LOGIN_PERSONA,
          errorContainer: [
            { fieldName: 'lkey', fieldError: 'Not authenticated', fieldErrorCode: 2001 },
          ],
        };
      }

      if (!personaName) {
        return {
          TXN: txn || FESL_TXN.LOGIN_PERSONA,
          errorContainer: [
            { fieldName: 'name', fieldError: 'Persona name is required', fieldErrorCode: 2002 },
          ],
        };
      }

      const persona = await apiClient.getPersonaByName(personaName, connection.gameSlug);
      const personaId = persona?.personaId || Math.abs(hashString(personaName)) % 100000 || 101;

      // Create a persona-scoped session in Redis
      const personaSession = await sessionStore.createSession({
        userId: currentSession.userId,
        personaId,
        username: currentSession.username,
        personaName,
        clientType: connection.clientType,
        ip: connection.remoteAddress,
        gameSlug: connection.gameSlug,
        sku: connection.sku,
        locale: connection.locale,
      });

      connection.attachSession(personaSession);

      return {
        TXN: txn,
        lkey: personaSession.lkey,
        userId: personaSession.userId,
        profileId: personaSession.userId,
        personaId,
        name: personaName,
      };
    }

    case FESL_TXN.GET_SUB_ACCOUNTS: {
      const username = connection.session?.username || 'player';
      return {
        TXN: FESL_TXN.GET_SUB_ACCOUNTS,
        subAccounts: [username],
        names: [username],
      };
    }

    case FESL_TXN.GET_ACCOUNT: {
      const userId = connection.session?.userId || 1;
      const user = await apiClient.getAccountDetails(userId);

      return {
        TXN: FESL_TXN.GET_ACCOUNT,
        country: user?.country || 'US',
        dobDay: user?.dobDay || 1,
        dobMonth: user?.dobMonth || 1,
        dobYear: user?.dobYear || 1990,
        email: user?.email || `user${userId}@centralspy.local`,
        language: user?.language || 'en',
        userId,
        zipCode: user?.zipCode || '10001',
      };
    }

    case FESL_TXN.UPDATE_ACCOUNT: {
      const userId = connection.session?.userId;
      if (userId) {
        const country = getPacketString(packet, 'country');
        const email = getPacketString(packet, 'email');
        const language = getPacketString(packet, 'language');
        await apiClient.updateAccountDetails(userId, {
          ...(country ? { country } : {}),
          ...(email ? { email } : {}),
          ...(language ? { language } : {}),
        });
      }

      return {
        TXN: FESL_TXN.UPDATE_ACCOUNT,
      };
    }

    case FESL_TXN.NU_LOOKUP_USER_INFO:
    case FESL_TXN.NU_LOOKUP_PERSONA:
    case FESL_TXN.NU_LOOKUP_PERSONA_BY_NAME: {
      const requestedUsers = getPacketArray<any>(packet, 'userInfo');
      const results: Array<{ userName: string; userId: number | string; masterUserId: number | string; namespace: string }> = [];

      if (requestedUsers.length > 0) {
        for (const req of requestedUsers) {
          const userName = typeof req === 'string' ? req : req.userName || req.name || 'Player';
          const persona = await apiClient.getPersonaByName(userName, connection.gameSlug);
          results.push({
            userName,
            userId: persona?.personaId || 101,
            masterUserId: persona?.userId || 1,
            namespace: '',
          });
        }
      } else {
        const singleName = getPacketString(packet, 'userInfo.0.userName') || getPacketString(packet, 'name') || 'Player';
        const persona = await apiClient.getPersonaByName(singleName, connection.gameSlug);
        results.push({
          userName: singleName,
          userId: persona?.personaId || 101,
          masterUserId: persona?.userId || 1,
          namespace: '',
        });
      }

      return {
        TXN: txn,
        userInfo: results,
      };
    }

    case FESL_TXN.GAME_SPY_PRE_AUTH: {
      const ticket = crypto.randomBytes(16).toString('hex');
      const challenge = crypto.randomBytes(16).toString('hex');

      return {
        TXN: FESL_TXN.GAME_SPY_PRE_AUTH,
        ticket,
        challenge,
      };
    }

    case FESL_TXN.GET_TELEMETRY_TOKEN: {
      const telemetryToken = `cs_telem_${crypto.randomBytes(16).toString('hex')}`;
      return {
        TXN: FESL_TXN.GET_TELEMETRY_TOKEN,
        telemetryToken,
      };
    }

    default: {
      return {
        TXN: txn || 'Unknown',
        errorContainer: [
          { fieldName: 'TXN', fieldError: `Unknown acct command: ${txn}` },
        ],
      };
    }
  }
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
