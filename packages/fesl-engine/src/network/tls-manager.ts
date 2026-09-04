import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as tls from 'node:tls';
import { config } from '../config/config.js';

export interface CertificatePair {
  cert: string;
  key: string;
}

/**
 * Standard legacy cipher suite for EA game clients (Battlefield 2142, Heroes, P4F, Bad Company 2, etc.)
 * SECLEVEL=0 allows 1024-bit RSA and older hash algorithms needed by legacy game executables.
 */
export const LEGACY_CIPHERS = [
  'ALL:@SECLEVEL=0',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA256',
  'AES256-SHA256',
  'AES128-SHA',
  'AES256-SHA',
  'DES-CBC3-SHA',
  'RC4-SHA',
  'RC4-MD5',
].join(':');

export class TlsManager {
  private static instance: TlsManager;
  private certificates: CertificatePair | null = null;

  private constructor() {}

  public static getInstance(): TlsManager {
    if (!TlsManager.instance) {
      TlsManager.instance = new TlsManager();
    }
    return TlsManager.instance;
  }

  /**
   * Returns Node.js TLS options configured for legacy game client compatibility.
   */
  public getTlsOptions(): tls.TlsOptions {
    const certs = this.getCertificates();
    return {
      key: certs.key,
      cert: certs.cert,
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1.3',
      ciphers: LEGACY_CIPHERS,
      honorCipherOrder: true,
      requestCert: false,
      rejectUnauthorized: false,
    };
  }

  /**
   * Creates a SecureContext using legacy ciphers and configured certificates.
   */
  public createSecureContext(): tls.SecureContext {
    const certs = this.getCertificates();
    return tls.createSecureContext({
      key: certs.key,
      cert: certs.cert,
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1.3',
      ciphers: LEGACY_CIPHERS,
      honorCipherOrder: true,
    });
  }

  /**
   * Retrieves current certificates, loading from file or generating dev self-signed cert.
   */
  public getCertificates(): CertificatePair {
    if (this.certificates) {
      return this.certificates;
    }

    // Check if certificates are provided via file paths
    if (config.tlsCertPath && config.tlsKeyPath) {
      try {
        if (fs.existsSync(config.tlsCertPath) && fs.existsSync(config.tlsKeyPath)) {
          this.certificates = {
            cert: fs.readFileSync(config.tlsCertPath, 'utf8'),
            key: fs.readFileSync(config.tlsKeyPath, 'utf8'),
          };
          return this.certificates;
        }
      } catch (err) {
        console.warn(`[TlsManager] Failed to load certificates from path: ${(err as Error).message}`);
      }
    }

    // Generate self-signed certificate on the fly
    this.certificates = this.generateSelfSignedCert('centralspy.ea.com');
    return this.certificates;
  }

  /**
   * Sets custom certificate and private key.
   */
  public setCertificates(certs: CertificatePair): void {
    this.certificates = certs;
  }

  /**
   * Generates a self-signed X.509 certificate and RSA private key in PEM format.
   */
  public generateSelfSignedCert(commonName = 'centralspy.ea.com'): CertificatePair {
    // Generate RSA 2048 key pair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const certPem = createSelfSignedX509Pem(commonName, publicKey, privateKey);
    return {
      cert: certPem,
      key: privateKey,
    };
  }
}

// ---------------------------------------------------------------------------
// Pure TypeScript X.509 DER & PEM Generator using Node.js crypto
// ---------------------------------------------------------------------------

function createSelfSignedX509Pem(commonName: string, publicKeyPem: string, privateKeyPem: string): string {
  // Extract SubjectPublicKeyInfo DER from PEM
  const spkiBase64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  const spkiDer = Buffer.from(spkiBase64, 'base64');

  // Validity period: 10 years (from now - 1 day to +10 years)
  const notBefore = new Date(Date.now() - 86400 * 1000);
  const notAfter = new Date(Date.now() + 10 * 365 * 86400 * 1000);

  // Serial Number: 16 random bytes (positive integer, non-zero first byte to prevent ASN.1 padding errors)
  const serialBytes = crypto.randomBytes(16);
  serialBytes[0] = (serialBytes[0] & 0x7f) | 0x01; // ensure positive and non-zero
  const serialDer = derInteger(serialBytes);

  // Signature Algorithm identifier: sha256WithRSAEncryption (1.2.840.113549.1.1.11)
  const sigAlgOid = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
  const sigAlgDer = derSequence(Buffer.concat([derOid(sigAlgOid), derNull()]));

  // Issuer & Subject RDN: C=US, O=Electronic Arts, CN=commonName
  const nameDer = derSequence(
    Buffer.concat([
      derSet(derSequence(Buffer.concat([derOid(Buffer.from([0x55, 0x04, 0x06])), derPrintableString('US')]))), // C
      derSet(derSequence(Buffer.concat([derOid(Buffer.from([0x55, 0x04, 0x0a])), derUtf8String('Electronic Arts')]))), // O
      derSet(derSequence(Buffer.concat([derOid(Buffer.from([0x55, 0x04, 0x03])), derUtf8String(commonName)]))), // CN
    ])
  );

  // Validity: notBefore and notAfter in UTCTime format (YYMMDDHHMMSSZ)
  const validityDer = derSequence(
    Buffer.concat([
      derUtcTime(notBefore),
      derUtcTime(notAfter),
    ])
  );

  // Extensions: [3] EXPLICIT BasicConstraints (cA: TRUE) & SubjectAltName
  const extBasicConstraints = derSequence(
    Buffer.concat([
      derOid(Buffer.from([0x55, 0x1d, 0x13])), // id-ce-basicConstraints
      derBoolean(true), // critical
      derOctetString(derSequence(derBoolean(true))), // cA = true
    ])
  );

  // SubjectAltName: DNS: commonName, DNS: localhost, IP: 127.0.0.1
  const sanDer = derSequence(
    Buffer.concat([
      derOid(Buffer.from([0x55, 0x1d, 0x11])), // id-ce-subjectAltName
      derOctetString(
        derSequence(
          Buffer.concat([
            derTagged(0x82, Buffer.from(commonName, 'ascii')), // dNSName
            derTagged(0x82, Buffer.from('localhost', 'ascii')),
            derTagged(0x87, Buffer.from([127, 0, 0, 1])), // iPAddress
          ])
        )
      ),
    ])
  );

  const extensionsDer = derTagged(0xa3, derSequence(Buffer.concat([extBasicConstraints, sanDer])));

  // Version: [0] EXPLICIT INTEGER 2 (v3)
  const versionDer = derTagged(0xa0, derInteger(Buffer.from([0x02])));

  // TBSCertificate (To Be Signed)
  const tbsDer = derSequence(
    Buffer.concat([
      versionDer,
      serialDer,
      sigAlgDer,
      nameDer,      // issuer
      validityDer,
      nameDer,      // subject
      spkiDer,      // subjectPublicKeyInfo
      extensionsDer,
    ])
  );

  // Sign TBSCertificate with SHA256 RSA
  const signer = crypto.createSign('SHA256');
  signer.update(tbsDer);
  const signature = signer.sign(privateKeyPem);

  // Signature as BIT STRING (prefix with 0x00 for 0 unused bits)
  const sigBitString = derBitString(signature);

  // Certificate = SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  const certDer = derSequence(Buffer.concat([tbsDer, sigAlgDer, sigBitString]));

  // Encode to PEM format
  const b64 = certDer.toString('base64');
  const lines = b64.match(/.{1,64}/g) || [b64];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

// ---------------- ASN.1 DER Helpers ----------------

function derLength(len: number): Buffer {
  if (len < 128) {
    return Buffer.from([len]);
  }
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(content: Buffer): Buffer {
  return derTag(0x30, content);
}

function derSet(content: Buffer): Buffer {
  return derTag(0x31, content);
}

function derTagged(tag: number, content: Buffer): Buffer {
  return derTag(tag, content);
}

function derInteger(bytes: Buffer): Buffer {
  if (bytes[0] & 0x80) {
    return derTag(0x02, Buffer.concat([Buffer.from([0x00]), bytes]));
  }
  return derTag(0x02, bytes);
}

function derBitString(bytes: Buffer): Buffer {
  return derTag(0x03, Buffer.concat([Buffer.from([0x00]), bytes]));
}

function derOctetString(bytes: Buffer): Buffer {
  return derTag(0x04, bytes);
}

function derNull(): Buffer {
  return Buffer.from([0x05, 0x00]);
}

function derOid(bytes: Buffer): Buffer {
  return derTag(0x06, bytes);
}

function derUtf8String(str: string): Buffer {
  return derTag(0x0c, Buffer.from(str, 'utf8'));
}

function derPrintableString(str: string): Buffer {
  return derTag(0x13, Buffer.from(str, 'ascii'));
}

function derBoolean(val: boolean): Buffer {
  return derTag(0x01, Buffer.from([val ? 0xff : 0x00]));
}

function derUtcTime(date: Date): Buffer {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const str = `${yy}${mm}${dd}${hh}${min}${ss}Z`;
  return derTag(0x17, Buffer.from(str, 'ascii'));
}
