import { describe, it, expect } from 'bun:test';
import { expandHomeDir, getConfig, clearConfigCache } from '../../src/utils/config.js';
import { homedir } from 'os';

describe('Config', () => {
  it('expands home directory', () => {
    const expanded = expandHomeDir('~/test');
    expect(expanded).toBe(`${homedir()}/test`);
  });

  it('leaves absolute paths unchanged', () => {
    const path = '/usr/local/test';
    expect(expandHomeDir(path)).toBe(path);
  });

  it('loads default config', async () => {
    clearConfigCache();
    const config = await getConfig();
    expect(typeof config.issuer).toBe('string');
    expect(config.issuer.length).toBeGreaterThan(0);
    expect(config.passwordMinLength).toBe(8);
    expect(config.tokenCacheDir.length).toBeGreaterThan(0);
  });
});
