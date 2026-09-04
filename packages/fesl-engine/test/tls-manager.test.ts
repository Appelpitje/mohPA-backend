import { describe, it, expect } from 'vitest';
import { TlsManager, LEGACY_CIPHERS } from '../src/network/tls-manager.js';

describe('TlsManager', () => {
  it('should generate a valid self-signed certificate and RSA key pair', () => {
    const tlsManager = TlsManager.getInstance();
    const certs = tlsManager.generateSelfSignedCert('centralspy.test');

    expect(certs.cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(certs.cert).toContain('-----END CERTIFICATE-----');
    expect(certs.key).toContain('-----BEGIN PRIVATE KEY-----');
    expect(certs.key).toContain('-----END PRIVATE KEY-----');
  });

  it('should configure legacy TLS options', () => {
    const tlsManager = TlsManager.getInstance();
    const options = tlsManager.getTlsOptions();

    expect(options.minVersion).toBe('TLSv1');
    expect(options.maxVersion).toBe('TLSv1.3');
    expect(options.ciphers).toContain('ALL:@SECLEVEL=0');
    expect(options.honorCipherOrder).toBe(true);
    expect(options.cert).toBeDefined();
    expect(options.key).toBeDefined();
  });

  it('should create a valid secure context', () => {
    const tlsManager = TlsManager.getInstance();
    const secureContext = tlsManager.createSecureContext();
    expect(secureContext).toBeDefined();
    expect(secureContext.context).toBeDefined();
  });
});
