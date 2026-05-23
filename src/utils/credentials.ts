import { readFile } from "node:fs/promises";
import { error } from "./output.js";

const readTrimmedFile = async (filePath: string, label: string): Promise<string> => {
  try {
    return (await readFile(filePath, "utf-8")).trim();
  } catch {
    error("FILE_READ_ERROR", `Failed to read ${label} file: ${filePath}`);
  }
};

export interface ResolvePasswordInput {
  passwordFile?: string;
  envVar?: string;
  promptMessage?: string;
  jsonModeError: string;
  minLength?: number;
  confirmPromptMessage?: string;
}

export const resolvePasswordInput = async (options: ResolvePasswordInput): Promise<string> => {
  if (options.passwordFile) {
    return readTrimmedFile(options.passwordFile, "password");
  }

  const envVar = options.envVar || "PROBE_WALLET_PASSWORD";
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    return fromEnv;
  }

  error(
    "PASSWORD_REQUIRED",
    options.jsonModeError,
    "Pass --password-file or set PROBE_WALLET_PASSWORD",
  );
};

export interface ResolveMnemonicInput {
  mnemonic?: string;
  mnemonicFile?: string;
  envVar?: string;
  jsonModeError: string;
}

export const resolveMnemonicInput = async (options: ResolveMnemonicInput): Promise<string> => {
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

  error(
    "MNEMONIC_REQUIRED",
    options.jsonModeError,
    "Pass --mnemonic, --mnemonic-file, or set PROBE_WALLET_MNEMONIC",
  );
};
