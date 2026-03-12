import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { resolvePasswordInput } from "~/utils/credentials.js";
import { printHelp } from "~/utils/help.js";
import {
	error,
	isJsonMode,
	setJsonMode,
	success,
	successMessage,
} from "~/utils/output.js";
import { loadWallet } from "~/utils/wallet.js";

export default defineCommand({
	meta: {
		name: "sign",
		description: "Sign a message using wallet private key",
	},
	args: {
		name: {
			type: "positional",
			description: "Wallet name",
			required: false,
		},
		message: {
			type: "positional",
			description: "Message to sign",
			required: false,
		},
		"message-file": {
			type: "string",
			description: "Read message from file",
		},
		"password-file": {
			type: "string",
			description: "Read password from file",
		},
		json: {
			type: "boolean",
			description: "Output JSON only",
			default: false,
		},
	},
	async run({ args }) {
		if (args.json) {
			setJsonMode(true);
		}

		const name = args.name;

		if (!name) {
			printHelp({
				command: "probe sign",
				description: "Sign arbitrary text using wallet private key",
				usage: [
					"probe sign <wallet-name> <message> [options]",
					"probe sign <wallet-name> --message-file ./payload.txt [options]",
				],
				options: [
					{ name: "--message-file", detail: "Read message content from file" },
					{ name: "--password-file", detail: "Read wallet password from file" },
					{ name: "--json", detail: "JSON output for agents" },
				],
			});
			return;
		}

		let message: string;

		if (args["message-file"]) {
			try {
				message = await readFile(args["message-file"], "utf-8");
			} catch {
				error(
					"FILE_READ_ERROR",
					`Failed to read message file: ${args["message-file"]}`,
				);
			}
		} else if (args.message) {
			message = args.message;
		} else {
			error("MESSAGE_REQUIRED", "Message or message-file required");
		}

		const walletPassword = await resolvePasswordInput({
			passwordFile: args["password-file"],
			promptMessage: "Enter wallet password:",
			jsonModeError:
				"Password file required in JSON mode or provide PROBE_WALLET_PASSWORD",
		});

		try {
			const keyStore = await loadWallet(name, walletPassword);
			const keyPair = keyStore.getKeyPair(0);

			const signature = keyPair.sign(Buffer.from(message));
			const publicKey = keyPair.getPublicKey();
			const address = keyPair.getAddress();

			success({
				wallet: name,
				message,
				signature: signature.toString("hex"),
				publicKey: publicKey.toString("hex"),
				address: address.toString(),
			});

			if (!isJsonMode()) {
				successMessage("Message signed successfully");
				console.log(`Signature: ${signature.toString("hex")}`);
			}
		} catch (err) {
			error(
				"SIGN_ERROR",
				err instanceof Error ? err.message : "Failed to sign message",
			);
		}
	},
});
