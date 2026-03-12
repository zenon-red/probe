import { AsyncLocalStorage } from "node:async_hooks";
import { spinner as clackSpinner, log } from "@clack/prompts";
import { dim } from "kolorist";
import type { OutputResult } from "~/types/index.js";

const outputModeStorage = new AsyncLocalStorage<{ jsonMode: boolean }>();

const jsonReplacer = (_key: string, value: unknown): unknown => {
	if (typeof value === "bigint") {
		return value.toString();
	}
	return value;
};

const printJson = (value: unknown, stderr = false): void => {
	const serialized = JSON.stringify(value, jsonReplacer, 2);
	if (stderr) {
		console.error(serialized);
		return;
	}
	console.log(serialized);
};

export function setJsonMode(enabled: boolean) {
	outputModeStorage.enterWith({ jsonMode: enabled });
}

export function isJsonMode(): boolean {
	return outputModeStorage.getStore()?.jsonMode === true;
}

export function success<T>(data: T): void {
	if (isJsonMode()) {
		printJson({ success: true, data });
	}
}

export function error(
	code: string,
	message: string,
	suggestion?: string,
	exitCode = 1,
): never {
	if (isJsonMode()) {
		const output: OutputResult<never> = {
			success: false,
			error: {
				code,
				message,
				...(suggestion && { suggestion }),
			},
		};
		printJson(output, true);
		process.exit(exitCode);
	} else {
		log.error(message);
		if (suggestion) {
			console.error(`${dim("hint:")} ${suggestion}`);
		}
		process.exit(exitCode);
	}
}

export function info(message: string): void {
	if (!isJsonMode()) {
		log.info(message);
	}
}

export function successMessage(message: string): void {
	if (!isJsonMode()) {
		log.success(message);
	}
}

export function warning(message: string): void {
	if (!isJsonMode()) {
		log.warn(message);
	}
}

export function spinner(message: string) {
	if (isJsonMode()) {
		return {
			start: () => {},
			stop: () => {},
			succeed: () => {},
			fail: () => {},
		};
	}

	const clack = clackSpinner();

	const start = () => {
		clack.start(message);
	};

	const stop = () => {
		clack.stop();
	};

	const succeed = (msg?: string) => {
		clack.stop(msg || message, 0);
	};

	const fail = (msg?: string) => {
		clack.stop(msg || message, 1);
	};

	return {
		start,
		stop,
		succeed,
		fail,
	};
}
