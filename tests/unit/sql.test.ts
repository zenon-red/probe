import { describe, it, expect } from 'bun:test';
import { buildSqlEndpoint, normalizeSqlHttpBase } from '../../src/utils/sql.js';

describe('SQL utils', () => {
  it('maps ws host to http', () => {
    expect(normalizeSqlHttpBase('ws://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
  });

  it('maps wss host to https', () => {
    expect(normalizeSqlHttpBase('wss://example.com')).toBe('https://example.com/');
  });

  it('builds SQL endpoint from base host and module', () => {
    expect(buildSqlEndpoint('ws://127.0.0.1:3000', 'nexus')).toBe('http://127.0.0.1:3000/v1/database/nexus/sql');
  });

  it('preserves base path when building SQL endpoint', () => {
    expect(buildSqlEndpoint('ws://localhost:3000/spacetime', 'nexus-dev')).toBe(
      'http://localhost:3000/spacetime/v1/database/nexus-dev/sql',
    );
  });

  it('rejects unsupported protocols', () => {
    expect(() => normalizeSqlHttpBase('ftp://localhost:3000')).toThrow('Unsupported host protocol');
  });
});
