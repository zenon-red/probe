export interface NexusConfig {
	issuer: string;
	walletDir: string;
	defaultWallet?: string;
	passwordMinLength: number;
	tokenCacheDir: string;
	requestTimeout: number;
	spacetime: {
		host: string;
		module: string;
	};
}

export const DEFAULT_CONFIG: NexusConfig = {
	issuer: "https://api.zenon.red",
	walletDir: "~/.probe/wallets",
	passwordMinLength: 8,
	tokenCacheDir: "~/.probe/tokens",
	requestTimeout: 30000,
	spacetime: {
		host: "wss://db.zenon.red",
		module: "nexus",
	},
};

export interface WalletInfo {
	name: string;
	address: string;
	publicKey?: string;
	createdAt?: string;
}

export interface WalletCreationResult {
	name: string;
	address: string;
	publicKey: string;
	mnemonic: string;
}

export interface ChallengeResponse {
	nonce: string;
	challenge: string;
	expiresAt: string;
}

export interface TokenResponse {
	accessToken: string;
	idToken: string;
	expiresIn: number;
}

export interface OutputResult<T> {
	success: boolean;
	data?: T;
	error?: { code: string; message: string; suggestion?: string };
}
