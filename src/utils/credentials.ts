import { readFile } from "node:fs/promises";
import { password, text } from "@clack/prompts";
import { error, isJsonMode } from "./output.js";

const readTrimmedFile = async (
	filePath: string,
	label: string,
): Promise<string> => {
	try {
		return (await readFile(filePath, "utf-8")).trim();
	} catch {
		error("FILE_READ_ERROR", `Failed to read ${label} file: ${filePath}`);
	}
};

export interface ResolvePasswordInput {
	passwordFile?: string;
	envVar?: string;
	promptMessage: string;
	jsonModeError: string;
	minLength?: number;
	confirmPromptMessage?: string;
}

export const resolvePasswordInput = async (
	options: ResolvePasswordInput,
): Promise<string> => {
	if (options.passwordFile) {
		return readTrimmedFile(options.passwordFile, "password");
	}

	const envVar = options.envVar || "PROBE_WALLET_PASSWORD";
	const fromEnv = process.env[envVar];
	if (fromEnv) {
		return fromEnv;
	}

	if (isJsonMode() || !process.stdin.isTTY || !process.stdout.isTTY) {
		error("PASSWORD_REQUIRED", options.jsonModeError);
	}

	const first = await password({
		message: options.promptMessage,
		validate: (value) => {
			if (options.minLength && value.length < options.minLength) {
				return `Password must be at least ${options.minLength} characters`;
			}
		},
	});

	if (typeof first !== "string") {
		process.exit(130);
	}

	if (!options.confirmPromptMessage) {
		return first;
	}

	const second = await password({
		message: options.confirmPromptMessage,
		validate: (value) =>
			value === first ? undefined : "Passwords do not match",
	});
	if (typeof second !== "string") {
		process.exit(130);
	}

	return first;
};

export interface ResolveMnemonicInput {
	mnemonic?: string;
	mnemonicFile?: string;
	envVar?: string;
	jsonModeError: string;
}

export const resolveMnemonicInput = async (
	options: ResolveMnemonicInput,
): Promise<string> => {
	if (options.mnemonic) {
		return options.mnemonic;
	}

	if (options.mnemonicFile) {
		return readTrimmedFile(options.mnemonicFile, "mnemonic");
	}

	const envVar = options.envVar || "PROBE_WALLET_MNEMONIC";
	const fromEnv = process.env[envVar];
	if (fromEnv) {
		return fromEnv;
	}

	if (isJsonMode() || !process.stdin.isTTY || !process.stdout.isTTY) {
		error("MNEMONIC_REQUIRED", options.jsonModeError);
	}

	const input = await text({
		message: "Enter mnemonic phrase:",
		validate: (value) =>
			value.trim().split(/\s+/).length === 24
				? undefined
				: "Mnemonic must be 24 words",
	});
	if (typeof input !== "string") {
		process.exit(130);
	}
	return input;
};
