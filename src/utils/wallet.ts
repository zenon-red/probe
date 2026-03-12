import {
	access,
	mkdir,
	readdir,
	readFile,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { KeyFile, KeyStore } from "znn-typescript-sdk";
import type { WalletCreationResult, WalletInfo } from "~/types/index.js";
import { getWalletDir } from "./config.js";

async function ensureWalletDir(): Promise<string> {
	const walletDir = await getWalletDir();
	try {
		await mkdir(walletDir, { recursive: true });
	} catch {}
	return walletDir;
}

async function getWalletFilePath(name: string): Promise<string> {
	const walletDir = await ensureWalletDir();
	return join(walletDir, `${name}.json`);
}

export async function createWallet(
	name: string,
	password: string,
): Promise<WalletCreationResult> {
	const exists = await walletExists(name);
	if (exists) {
		throw new Error(`Wallet '${name}' already exists`);
	}

	const keyStore = KeyStore.newRandom();
	const keyFile = KeyFile.setPassword(password);
	const encryptedData = await keyFile.encrypt(keyStore);

	const walletPath = await getWalletFilePath(name);
	await writeFile(walletPath, JSON.stringify(encryptedData, null, 2), "utf-8");

	const keyPair = keyStore.getKeyPair(0);
	const address = keyPair.getAddress();
	const publicKey = keyPair.getPublicKey();

	return {
		name,
		address: address.toString(),
		publicKey: publicKey.toString("hex"),
		mnemonic: keyStore.mnemonic || "",
	};
}

export async function importWallet(
	name: string,
	mnemonic: string,
	password: string,
): Promise<WalletInfo> {
	const exists = await walletExists(name);
	if (exists) {
		throw new Error(`Wallet '${name}' already exists`);
	}

	const keyStore = KeyStore.fromMnemonic(mnemonic);
	const keyFile = KeyFile.setPassword(password);
	const encryptedData = await keyFile.encrypt(keyStore);

	const walletPath = await getWalletFilePath(name);
	await writeFile(walletPath, JSON.stringify(encryptedData, null, 2), "utf-8");

	const keyPair = keyStore.getKeyPair(0);
	const address = keyPair.getAddress();

	return {
		name,
		address: address.toString(),
	};
}

export async function listWallets(): Promise<WalletInfo[]> {
	const walletDir = await getWalletDir();

	try {
		const files = await readdir(walletDir);
		const wallets: WalletInfo[] = [];

		for (const file of files) {
			if (file.endsWith(".json")) {
				const name = file.slice(0, -5);
				const info = await getWalletInfo(name);
				if (info) {
					wallets.push(info);
				}
			}
		}

		return wallets;
	} catch {
		return [];
	}
}

export async function getWalletInfo(name: string): Promise<WalletInfo | null> {
	const walletPath = await getWalletFilePath(name);

	try {
		const content = await readFile(walletPath, "utf-8");
		const data = JSON.parse(content);
		const stats = await stat(walletPath);

		return {
			name,
			address: data.address || data.baseAddress,
			createdAt: data.timestamp
				? new Date(data.timestamp * 1000).toISOString()
				: new Date(stats.mtime).toISOString(),
		};
	} catch {
		return null;
	}
}

export async function loadWallet(
	name: string,
	password: string,
): Promise<KeyStore> {
	const walletPath = await getWalletFilePath(name);

	try {
		const content = await readFile(walletPath, "utf-8");
		const encryptedData = JSON.parse(content);

		const keyFile = KeyFile.setPassword(password);
		const keyStore = await keyFile.decrypt(encryptedData);

		return keyStore;
	} catch (err) {
		throw new Error(
			`Failed to load wallet: ${err instanceof Error ? err.message : "Unknown error"}`,
		);
	}
}

export async function deleteWallet(name: string): Promise<void> {
	const walletPath = await getWalletFilePath(name);

	try {
		await unlink(walletPath);
	} catch (err) {
		throw new Error(
			`Failed to delete wallet: ${err instanceof Error ? err.message : "Unknown error"}`,
		);
	}
}

export async function walletExists(name: string): Promise<boolean> {
	const walletPath = await getWalletFilePath(name);

	try {
		await access(walletPath);
		return true;
	} catch {
		return false;
	}
}

async function stat(path: string) {
	const { stat } = await import("node:fs/promises");
	return stat(path);
}
