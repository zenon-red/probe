import { Buffer } from "node:buffer";
import { defineCommand } from "citty";
import type { KeyPair } from "znn-typescript-sdk";
import { resolvePasswordInput } from "~/utils/credentials.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { exchangeToken, requestChallenge } from "~/utils/oidc.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { cacheToken } from "~/utils/token-cache.js";
import { loadWallet } from "~/utils/wallet.js";
import { errorMessage } from "~/utils/errors.js";

export default defineCommand({
  meta: {
    name: "login",
    description: "Authenticate wallet and optionally cache token",
  },
  args: {
    wallet: {
      type: "positional",
      description: "Wallet name",
      required: false,
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

    const walletName = args.wallet;
    const requestedAddress = args["expect-address"];

    if (forceHelpRequested() || !walletName) {
      printHelp({
        command: "probe login",
        description: "Complete OIDC authentication flow for a wallet",
        usage: [
          "probe login <wallet> [options]",
          "probe login my-wallet --password-file ./pass --save",
          "probe login my-wallet --expect-address z1q... --save",
        ],
        options: [
          {
            name: "--expect-address",
            detail: "Optional safety check against resolved wallet address",
          },
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

    const walletPassword = await resolvePasswordInput({
      passwordFile: args["password-file"],
      jsonModeError: "Password required via --password-file or PROBE_WALLET_PASSWORD",
    });

    let keyPair: KeyPair | undefined;
    let walletAddress: string;
    let address: string;
    try {
      const keyStore = await loadWallet(walletName, walletPassword);
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
        await cacheToken(walletName, tokenResponse.accessToken, expiresAt);
      }

      success({
        wallet: walletName,
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
