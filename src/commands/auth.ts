import { Buffer } from "node:buffer";
import { defineCommand } from "citty";
import type { KeyPair } from "znn-typescript-sdk";
import { getConfig } from "~/utils/config.js";
import { resolvePasswordInput } from "~/utils/credentials.js";
import { printHelp } from "~/utils/help.js";
import { exchangeToken, requestChallenge } from "~/utils/oidc.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { cacheToken, getCachedToken } from "~/utils/token-cache.js";
import { loadWallet } from "~/utils/wallet.js";
import { errorMessage } from "~/utils/errors.js";

export default defineCommand({
  meta: {
    name: "auth",
    description: "Complete OIDC authentication flow",
  },
  args: {
    name: {
      type: "positional",
      description: "Wallet name, or status action",
      required: false,
    },
    wallet: {
      type: "string",
      description: "Wallet name override (used with auth status)",
    },
    "expect-address": {
      type: "string",
      description: "Expected Zenon address safety check (z1...)",
    },
    issuer: {
      type: "string",
      description: "OIDC issuer URL override",
    },
    "password-file": {
      type: "string",
      description: "Read password from file",
    },
    save: {
      type: "boolean",
      description: "Save token to cache (default: true)",
      default: true,
    },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    applyJsonMode(args);

    const name = args.name;
    const requestedAddress = args["expect-address"];

    if (!name) {
      printHelp({
        command: "probe auth",
        description: "Complete OIDC authentication flow",
        usage: [
          "probe auth <wallet-name> [options]",
          "probe auth status [--wallet my-wallet]",
          "probe auth my-wallet --password-file ./pass --save",
          "probe auth my-wallet --expect-address z1q... --save",
        ],
        options: [
          {
            name: "--expect-address",
            detail: "Optional safety check against resolved wallet address",
          },
          { name: "--wallet", detail: "Wallet override for `auth status`" },
          {
            name: "--issuer",
            detail: "OIDC issuer URL (default from config: issuer)",
          },
          { name: "--password-file", detail: "Read wallet password from file" },
          {
            name: "--save",
            detail: "Save token in local cache (default: true)",
          },
          { name: "--json", detail: "JSON output for agents" },
        ],
        notes: [
          "Password source order: --password-file, PROBE_WALLET_PASSWORD. Interactive prompts are not supported.",
          "Most users should omit --expect-address; it is for safety checks in external workflows.",
          "Use --issuer only when authenticating against a non-default OIDC server (for example local/dev environments).",
        ],
      });
      return;
    }

    if (name === "status") {
      const config = await getConfig();
      const walletName = args.wallet || config.defaultWallet;
      if (!walletName) {
        error("WALLET_REQUIRED", "Wallet required. Use --wallet or set default wallet.");
      }

      const cached = await getCachedToken(walletName);
      if (!cached) {
        success(
          {
            wallet: walletName,
            authenticated: false,
            valid: false,
            reason: "no_cached_token",
          },
          [`probe auth ${walletName} --password-file <path> --save`],
        );
        return;
      }

      const expiresAt = new Date(cached.expiresAt);
      const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      const valid = Number.isFinite(expiresIn) && expiresIn > 0;
      success({
        wallet: walletName,
        authenticated: true,
        valid,
        expiresAt: cached.expiresAt,
        expiresIn: Math.max(0, expiresIn),
      });
      return;
    }

    const walletPassword = await resolvePasswordInput({
      passwordFile: args["password-file"],
      jsonModeError: "Password required via --password-file or PROBE_WALLET_PASSWORD",
    });

    let keyPair: KeyPair | undefined;
    let walletAddress: string;
    let address: string;
    try {
      const keyStore = await loadWallet(name, walletPassword);
      keyPair = keyStore.getKeyPair(0);
      const addr = keyPair.getAddress();
      walletAddress = addr.toString();

      if (requestedAddress && walletAddress !== requestedAddress) {
        error(
          "ADDRESS_MISMATCH",
          `Wallet address ${walletAddress} does not match provided address ${requestedAddress}`,
        );
      }

      address = requestedAddress || walletAddress;
    } catch (err) {
      error("WALLET_LOAD_ERROR", errorMessage(err, "Failed to load wallet"));
    }

    try {
      const challenge = await requestChallenge(address, args.issuer);
      const signature = keyPair.sign(Buffer.from(challenge.challenge));
      const publicKey = keyPair.getPublicKey();
      const tokenResponse = await exchangeToken(
        address,
        publicKey.toString("hex"),
        signature.toString("hex"),
        challenge.nonce,
        args.issuer,
      );

      const expiresAt = new Date(Date.now() + tokenResponse.expiresIn * 1000).toISOString();

      if (args.save) {
        await cacheToken(name, tokenResponse.accessToken, expiresAt);
      }

      success({
        wallet: name,
        address,
        token: tokenResponse.accessToken,
        expiresAt,
        expiresIn: tokenResponse.expiresIn,
        tokenSaved: args.save,
      });
    } catch (err) {
      error("AUTH_ERROR", errorMessage(err, "Authentication failed"), undefined, 2);
    }
  },
});
