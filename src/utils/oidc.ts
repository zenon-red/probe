import type { ChallengeResponse, TokenResponse } from "~/types/index.js";
import { getConfig } from "./config.js";

export async function requestChallenge(
	address: string,
	issuerOverride?: string,
): Promise<ChallengeResponse> {
	const config = await getConfig();
	const issuer = issuerOverride || config.issuer;
	const url = `${issuer}/auth/challenge`;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ address }),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Challenge request failed: ${error}`);
	}

	const data = await response.json();
	return {
		nonce: data.nonce,
		challenge: data.challenge,
		expiresAt: data.expires_at,
	};
}

export async function exchangeToken(
	address: string,
	publicKey: string,
	signature: string,
	nonce: string,
	issuerOverride?: string,
): Promise<TokenResponse> {
	const config = await getConfig();
	const issuer = issuerOverride || config.issuer;
	const url = `${issuer}/auth/token`;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			address,
			public_key: publicKey,
			signature,
			nonce,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token exchange failed: ${error}`);
	}

	const data = await response.json();
	return {
		accessToken: data.access_token,
		idToken: data.id_token,
		expiresIn: data.expires_in,
	};
}
