/**
 * CentralSpy IP Geolocation & Server Region Resolver
 */

export interface LocationInfo {
  region: string;
  countryCode: string;
  country: string;
  city?: string;
  flag: string;
  name: string;
  estimatedPing: number;
}

/**
 * Converts a 2-letter ISO country code into its Unicode flag emoji.
 */
export function countryCodeToFlag(countryCode?: string): string {
  if (!countryCode) return '🌐';
  const clean = countryCode.trim().toUpperCase();
  if (clean === 'LAN' || clean === 'LOCAL') return '🏠';
  if (clean === 'GLOBAL' || clean.length !== 2) return '🌐';
  const codePoints = clean.split('').map((c) => 127397 + c.charCodeAt(0));
  try {
    return String.fromCodePoint(...codePoints);
  } catch {
    return '🌐';
  }
}

export const REGION_PROFILES: Record<string, { name: string; countryCode: string; country: string; city: string; flag: string; estimatedPing: number }> = {
  fra: { name: 'EU Central (Frankfurt, DE)', countryCode: 'DE', country: 'Germany', city: 'Frankfurt', flag: '🇩🇪', estimatedPing: 24 },
  de: { name: 'EU Central (Frankfurt, DE)', countryCode: 'DE', country: 'Germany', city: 'Frankfurt', flag: '🇩🇪', estimatedPing: 24 },
  ams: { name: 'EU West (Amsterdam, NL)', countryCode: 'NL', country: 'Netherlands', city: 'Amsterdam', flag: '🇳🇱', estimatedPing: 22 },
  nl: { name: 'EU West (Amsterdam, NL)', countryCode: 'NL', country: 'Netherlands', city: 'Amsterdam', flag: '🇳🇱', estimatedPing: 22 },
  lon: { name: 'EU West (London, UK)', countryCode: 'GB', country: 'United Kingdom', city: 'London', flag: '🇬🇧', estimatedPing: 32 },
  gb: { name: 'EU West (London, UK)', countryCode: 'GB', country: 'United Kingdom', city: 'London', flag: '🇬🇧', estimatedPing: 32 },
  uk: { name: 'EU West (London, UK)', countryCode: 'GB', country: 'United Kingdom', city: 'London', flag: '🇬🇧', estimatedPing: 32 },
  cdg: { name: 'EU West (Paris, FR)', countryCode: 'FR', country: 'France', city: 'Paris', flag: '🇫🇷', estimatedPing: 25 },
  fr: { name: 'EU West (Paris, FR)', countryCode: 'FR', country: 'France', city: 'Paris', flag: '🇫🇷', estimatedPing: 25 },
  bru: { name: 'EU West (Brussels, BE)', countryCode: 'BE', country: 'Belgium', city: 'Brussels', flag: '🇧🇪', estimatedPing: 20 },
  be: { name: 'EU West (Brussels, BE)', countryCode: 'BE', country: 'Belgium', city: 'Brussels', flag: '🇧🇪', estimatedPing: 20 },
  iad: { name: 'US East (Virginia, US)', countryCode: 'US', country: 'United States', city: 'Ashburn', flag: '🇺🇸', estimatedPing: 28 },
  ord: { name: 'US Central (Chicago, US)', countryCode: 'US', country: 'United States', city: 'Chicago', flag: '🇺🇸', estimatedPing: 38 },
  sjc: { name: 'US West (California, US)', countryCode: 'US', country: 'United States', city: 'San Jose', flag: '🇺🇸', estimatedPing: 65 },
  us: { name: 'United States', countryCode: 'US', country: 'United States', city: 'Washington', flag: '🇺🇸', estimatedPing: 35 },
  yvr: { name: 'North America (Vancouver, CA)', countryCode: 'CA', country: 'Canada', city: 'Vancouver', flag: '🇨🇦', estimatedPing: 48 },
  ca: { name: 'North America (Canada)', countryCode: 'CA', country: 'Canada', city: 'Toronto', flag: '🇨🇦', estimatedPing: 45 },
  tyo: { name: 'Asia East (Tokyo, JP)', countryCode: 'JP', country: 'Japan', city: 'Tokyo', flag: '🇯🇵', estimatedPing: 135 },
  jp: { name: 'Asia East (Tokyo, JP)', countryCode: 'JP', country: 'Japan', city: 'Tokyo', flag: '🇯🇵', estimatedPing: 135 },
  sin: { name: 'Asia SE (Singapore, SG)', countryCode: 'SG', country: 'Singapore', city: 'Singapore', flag: '🇸🇬', estimatedPing: 155 },
  sg: { name: 'Asia SE (Singapore, SG)', countryCode: 'SG', country: 'Singapore', city: 'Singapore', flag: '🇸🇬', estimatedPing: 155 },
  syd: { name: 'Oceania (Sydney, AU)', countryCode: 'AU', country: 'Australia', city: 'Sydney', flag: '🇦🇺', estimatedPing: 190 },
  au: { name: 'Oceania (Sydney, AU)', countryCode: 'AU', country: 'Australia', city: 'Sydney', flag: '🇦🇺', estimatedPing: 190 },
  gru: { name: 'SA East (São Paulo, BR)', countryCode: 'BR', country: 'Brazil', city: 'São Paulo', flag: '🇧🇷', estimatedPing: 140 },
  br: { name: 'SA East (São Paulo, BR)', countryCode: 'BR', country: 'Brazil', city: 'São Paulo', flag: '🇧🇷', estimatedPing: 140 },
  lan: { name: 'Local Node (LAN)', countryCode: 'LOCAL', country: 'Local Network', city: 'LAN', flag: '🏠', estimatedPing: 5 },
};

/**
 * In-memory cache for IP lookups to avoid redundant API queries.
 */
const geoCache = new Map<string, LocationInfo>();

// Seed cache with known infrastructure nodes
geoCache.set('178.105.150.25', {
  region: 'fra',
  countryCode: 'DE',
  country: 'Germany',
  city: 'Falkenstein',
  flag: '🇩🇪',
  name: 'EU Central (Frankfurt, DE)',
  estimatedPing: 24,
});

/**
 * Checks if an IP is a private/local IP address.
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  const clean = ip.trim().toLowerCase();
  if (clean === 'localhost' || clean === '127.0.0.1' || clean === '::1' || clean === '0.0.0.0') {
    return true;
  }
  const parts = clean.split('.').map((p) => parseInt(p, 10));
  if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }
  return false;
}

/**
 * Synchronously resolves an IP address or region code into LocationInfo.
 */
export function resolveIpLocation(ipOrRegion?: string): LocationInfo {
  if (!ipOrRegion) {
    return {
      region: 'global',
      countryCode: 'GLOBAL',
      country: 'Global Theater',
      flag: '🌐',
      name: 'Global Theater',
      estimatedPing: 45,
    };
  }

  const clean = ipOrRegion.trim().toLowerCase();

  // 1. Direct cache match
  if (geoCache.has(clean)) {
    return geoCache.get(clean)!;
  }

  // 2. Profile / Region key match
  if (REGION_PROFILES[clean]) {
    const p = REGION_PROFILES[clean];
    return {
      region: clean.length === 3 ? clean : p.countryCode.toLowerCase(),
      countryCode: p.countryCode,
      country: p.country,
      city: p.city,
      flag: p.flag,
      name: p.name,
      estimatedPing: p.estimatedPing,
    };
  }

  // 3. Private / LAN check
  if (isPrivateIp(clean)) {
    return {
      region: 'lan',
      countryCode: 'LOCAL',
      country: 'Local Network',
      city: 'LAN',
      flag: '🏠',
      name: 'Local Node (LAN)',
      estimatedPing: 5,
    };
  }

  // 4. Check known Hetzner / European IP prefixes
  if (clean.startsWith('178.105.') || clean.startsWith('188.40.') || clean.startsWith('144.76.') || clean.startsWith('116.203.') || clean.startsWith('159.69.')) {
    const info: LocationInfo = {
      region: 'fra',
      countryCode: 'DE',
      country: 'Germany',
      city: 'Frankfurt / FSN',
      flag: '🇩🇪',
      name: 'EU Central (Frankfurt, DE)',
      estimatedPing: 24,
    };
    geoCache.set(clean, info);
    return info;
  }

  // 5. Check if it's a 2-letter country code
  if (/^[a-z]{2}$/.test(clean)) {
    const code = clean.toUpperCase();
    const flag = countryCodeToFlag(code);
    return {
      region: clean,
      countryCode: code,
      country: code,
      flag,
      name: `Theater [${code}]`,
      estimatedPing: 45,
    };
  }

  // Fallback for unrecognized public IP
  return {
    region: 'global',
    countryCode: 'GLOBAL',
    country: 'Global Theater',
    flag: '🌐',
    name: 'Global Theater',
    estimatedPing: 45,
  };
}

/**
 * Asynchronously looks up public IP geolocation with caching and timeout.
 */
export async function lookupIpGeoAsync(ip: string, timeoutMs = 1200): Promise<LocationInfo> {
  if (!ip || isPrivateIp(ip)) {
    return resolveIpLocation(ip);
  }

  const clean = ip.trim();
  if (geoCache.has(clean)) {
    return geoCache.get(clean)!;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`http://ip-api.com/json/${clean}?fields=status,country,countryCode,city,lat,lon`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as any;
      if (data.status === 'success' && data.countryCode) {
        const countryCode = String(data.countryCode).toUpperCase();
        const country = data.country || countryCode;
        const city = data.city || '';
        const flag = countryCodeToFlag(countryCode);

        // Derive standard region code
        let region = countryCode.toLowerCase();
        if (countryCode === 'DE') region = 'fra';
        else if (countryCode === 'NL') region = 'ams';
        else if (countryCode === 'GB') region = 'lon';
        else if (countryCode === 'FR') region = 'cdg';
        else if (countryCode === 'BE') region = 'bru';
        else if (countryCode === 'US') region = 'iad';
        else if (countryCode === 'JP') region = 'tyo';
        else if (countryCode === 'SG') region = 'sin';
        else if (countryCode === 'AU') region = 'syd';

        const info: LocationInfo = {
          region,
          countryCode,
          country,
          city,
          flag,
          name: city ? `${country} (${city})` : country,
          estimatedPing: 35,
        };

        geoCache.set(clean, info);
        return info;
      }
    }
  } catch {
    // If request fails or times out, gracefully use synchronous fallback
  }

  const fallback = resolveIpLocation(clean);
  geoCache.set(clean, fallback);
  return fallback;
}
