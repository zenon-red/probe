import { Buffer } from "node:buffer";

import { requestChallenge, exchangeToken } from "~/utils/oidc.js";
import { cacheToken } from "~/utils/token-cache.js";
import { loadWallet } from "~/utils/wallet.js";

export async function authenticateWallet(
	walletName: string,
	password: string,
	issuerOverride?: string,
): Promise<{
	token: string;
	expiresAt: string;
	address: string;
}> {
	const keyStore = await loadWallet(walletName, password);
	const keyPair = keyStore.getKeyPair(0);
	const address = keyPair.getAddress().toString();
	const publicKey = keyPair.getPublicKey();

	const challenge = await requestChallenge(address, issuerOverride);
	const signature = keyPair.sign(Buffer.from(challenge.challenge));

	const tokenResponse = await exchangeToken(
		address,
		publicKey.toString("hex"),
		signature.toString("hex"),
		challenge.nonce,
		issuerOverride,
	);

	const expiresAt = new Date(
		Date.now() + tokenResponse.expiresIn * 1000,
	).toISOString();

	await cacheToken(walletName, tokenResponse.accessToken, expiresAt);

	return {
		token: tokenResponse.accessToken,
		expiresAt,
		address,
	};
}
