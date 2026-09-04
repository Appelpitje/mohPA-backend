import { describe, it, expect } from 'vitest';
import {
  serializeKV,
  deserializeKV,
  formatErrorContainer
} from '../src/codec/kv-serializer.js';

describe('KV Serializer / Deserializer', () => {
  it('should serialize and deserialize flat key-value pairs', () => {
    const input = {
      TXN: 'Hello',
      clientType: 'client',
      sku: 'MOHPA-PC',
      locale: 'en_US'
    };

    const serialized = serializeKV(input);
    expect(serialized).toContain('TXN=Hello\n');
    expect(serialized).toContain('clientType=client\n');

    const parsed = deserializeKV(serialized);
    expect(parsed.TXN).toBe('Hello');
    expect(parsed.clientType).toBe('client');
    expect(parsed.sku).toBe('MOHPA-PC');
  });

  it('should handle multi-dimensional array notation', () => {
    const input = {
      TXN: 'NuGetPersonas',
      personas: [
        { name: 'AlphaSoldier', id: 101 },
        { name: 'BravoSoldier', id: 102 }
      ]
    };

    const serialized = serializeKV(input);
    expect(serialized).toContain('personas.[]=2\n');
    expect(serialized).toContain('personas.0.name=AlphaSoldier\n');
    expect(serialized).toContain('personas.0.id=101\n');
    expect(serialized).toContain('personas.1.name=BravoSoldier\n');
    expect(serialized).toContain('personas.1.id=102\n');

    const parsed = deserializeKV(serialized);
    expect(parsed.TXN).toBe('NuGetPersonas');
    expect(Array.isArray(parsed.personas)).toBe(true);
    expect(parsed.personas).toHaveLength(2);
    expect(parsed.personas[0].name).toBe('AlphaSoldier');
    expect(parsed.personas[0].id).toBe(101);
    expect(parsed.personas[1].name).toBe('BravoSoldier');
    expect(parsed.personas[1].id).toBe(102);
  });

  it('should handle quoted strings with spaces and escaped characters', () => {
    const rawKV = 'TXN="NuLogin"\nencryptedInfo="Hello%20World\\nWith\\tQuotes\\""\n';
    const parsed = deserializeKV(rawKV);

    expect(parsed.TXN).toBe('NuLogin');
    expect(parsed.encryptedInfo).toContain('Hello World');

    const obj = { message: 'Hello "World" & CentralSpy' };
    const serialized = serializeKV(obj, { quoteStrings: true });
    expect(serialized).toContain('message="Hello \\"World\\" & CentralSpy"\n');

    const roundtrip = deserializeKV(serialized);
    expect(roundtrip.message).toBe('Hello "World" & CentralSpy');
  });

  it('should handle empty arrays and error containers', () => {
    const errorResult = formatErrorContainer([
      { fieldName: 'password', fieldError: 2048, message: 'Invalid password' }
    ]);
    const serializedErr = serializeKV(errorResult);
    expect(serializedErr).toContain('errorContainer.[]=1\n');
    expect(serializedErr).toContain('errorContainer.0.fieldName=password\n');
    expect(serializedErr).toContain('errorContainer.0.fieldError=2048\n');

    const emptyErr = formatErrorContainer([]);
    const serializedEmpty = serializeKV(emptyErr);
    expect(serializedEmpty).toBe('errorContainer=[]\n');

    const parsedEmpty = deserializeKV(serializedEmpty);
    expect(parsedEmpty.errorContainer).toEqual([]);
  });
});
