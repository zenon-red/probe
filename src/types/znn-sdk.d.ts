declare module "znn-typescript-sdk" {
	import type { Address as ZnnAddress } from "znn-typescript-sdk/dist/model/primitives/address.js";

	export class KeyStore {
		mnemonic: string;
		entropy: string;
		seed: string;
		baseAddress: ZnnAddress;

		constructor(mnemonic: string);
		static fromMnemonic(mnemonic: string): KeyStore;
		static fromEntropy(initialEntropy: string): KeyStore;
		static newRandom(): KeyStore;
		getKeyPair(index?: number): KeyPair;
		getBaseAddress(): ZnnAddress;
	}

	export class KeyPair {
		getAddress(): ZnnAddress;
		getPublicKey(): Buffer;
		sign(data: Buffer): Buffer;
	}

	export class KeyFile {
		static setPassword(password: string): KeyFile;
		encrypt(keyStore: KeyStore): Promise<EncryptedKeyFile>;
		decrypt(encryptedData: EncryptedKeyFile): Promise<KeyStore>;
	}

	export interface EncryptedKeyFile {
		address: string;
		crypto: {
			cipher: string;
			ciphertext: string;
			cipherparams: {
				iv: string;
			};
			kdf: string;
			kdfparams: {
				dklen: number;
				salt: string;
				n: number;
				r: number;
				p: number;
			};
			mac: string;
		};
		timestamp?: number;
		version?: number;
	}

	export class Address {
		toString(): string;
	}

	export class Zenon {
		static getInstance(): Zenon;
		initialize(url: string, timeout?: number): Promise<void>;
		clearConnection(): void;
	}
}
