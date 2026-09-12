import { describe, it, expect } from 'vitest';
import { resolveIpLocation, countryCodeToFlag, isPrivateIp } from '../src/utils/geo.js';

describe('GeoIP & Region Resolver', () => {
  it('correctly maps 178.105.150.25 to Germany (DE / FRA) with German flag', () => {
    const loc = resolveIpLocation('178.105.150.25');
    expect(loc.countryCode).toBe('DE');
    expect(loc.region).toBe('fra');
    expect(loc.flag).toBe('🇩🇪');
    expect(loc.country).toBe('Germany');
    expect(loc.name).toContain('Frankfurt');
  });

  it('correctly identifies private and loopback IP addresses as LAN', () => {
    const loopback = resolveIpLocation('127.0.0.1');
    expect(loopback.region).toBe('lan');
    expect(loopback.flag).toBe('🏠');

    const lan = resolveIpLocation('192.168.1.100');
    expect(lan.region).toBe('lan');
    expect(lan.flag).toBe('🏠');

    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('172.16.0.5')).toBe(true);
    expect(isPrivateIp('178.105.150.25')).toBe(false);
  });

  it('converts ISO country codes to proper Unicode flag emojis', () => {
    expect(countryCodeToFlag('DE')).toBe('🇩🇪');
    expect(countryCodeToFlag('US')).toBe('🇺🇸');
    expect(countryCodeToFlag('NL')).toBe('🇳🇱');
    expect(countryCodeToFlag('BE')).toBe('🇧🇪');
    expect(countryCodeToFlag('GB')).toBe('🇬🇧');
    expect(countryCodeToFlag('FR')).toBe('🇫🇷');
    expect(countryCodeToFlag('JP')).toBe('🇯🇵');
    expect(countryCodeToFlag('LAN')).toBe('🏠');
    expect(countryCodeToFlag('GLOBAL')).toBe('🌐');
  });

  it('resolves standard region codes accurately', () => {
    const fra = resolveIpLocation('fra');
    expect(fra.countryCode).toBe('DE');
    expect(fra.flag).toBe('🇩🇪');

    const ams = resolveIpLocation('ams');
    expect(ams.countryCode).toBe('NL');
    expect(ams.flag).toBe('🇳🇱');

    const iad = resolveIpLocation('iad');
    expect(iad.countryCode).toBe('US');
    expect(iad.flag).toBe('🇺🇸');
  });
});
