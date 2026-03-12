import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Address } from 'znn-typescript-sdk';
import { createWallet, importWallet, listWallets, loadWallet, deleteWallet, walletExists } from '../../src/utils/wallet.js';

const AddressParser = Address as unknown as { parse: (address: string) => unknown };

const TEST_DIR = join(tmpdir(), 'probe-test-' + Date.now());

describe('Wallet', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    process.env.PROBE_WALLET_DIR = TEST_DIR;
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('creates wallet with valid mnemonic', async () => {
    const wallet = await createWallet('test-wallet', 'password123');
    expect(() => AddressParser.parse(wallet.address)).not.toThrow();
    expect(wallet.mnemonic.split(' ')).toHaveLength(24);
  });

  it('rejects duplicate wallet names', async () => {
    expect(createWallet('test-wallet', 'password123'))
          .rejects.toThrow('already exists');
  });

  it('imports wallet from mnemonic', async () => {
    const mnemonic = 'route become dream access impulse price inform obtain engage ski believe awful absent pig thing vibrant possible exotic flee pepper marble rural fire fancy';
    const wallet = await importWallet(`imported-wallet-${Date.now()}`, mnemonic, 'password123');
    expect(() => AddressParser.parse(wallet.address)).not.toThrow();
  });

  it('lists all wallets', async () => {
    const wallets = await listWallets();
    expect(wallets.length).toBeGreaterThanOrEqual(2);
    expect(wallets.some(w => w.name === 'test-wallet')).toBe(true);
  });

  it('checks wallet existence', async () => {
    expect(await walletExists('test-wallet')).toBe(true);
    expect(await walletExists('non-existent')).toBe(false);
  });

  it('loads wallet with correct password', async () => {
    const keyStore = await loadWallet('test-wallet', 'password123');
    expect(keyStore).toBeDefined();
  });

  it('rejects incorrect password', async () => {
    expect(loadWallet('test-wallet', 'wrongpassword'))
          .rejects.toThrow();
  });

  it('deletes wallet', async () => {
    await deleteWallet('test-wallet');
    expect(await walletExists('test-wallet')).toBe(false);
  });
});
