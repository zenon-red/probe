type MicrosTimestamp = { microsSinceUnixEpoch: bigint | number | string };

export const toMicros = (value: unknown): bigint => {
	if (
		!value ||
		typeof value !== "object" ||
		!("microsSinceUnixEpoch" in value)
	) {
		return 0n;
	}
	const micros = (value as MicrosTimestamp).microsSinceUnixEpoch;
	return typeof micros === "bigint" ? micros : BigInt(micros);
};

export const formatTimestamp = (value: unknown, fallback = ""): string => {
	const micros = toMicros(value);
	if (micros <= 0n) {
		return fallback || String(value ?? "");
	}
	return new Date(Number(micros / 1000n))
		.toISOString()
		.replace("T", " ")
		.slice(0, 19);
};

export const formatIsoTimestamp = (value: unknown, fallback = ""): string => {
	const micros = toMicros(value);
	if (micros <= 0n) {
		return fallback || new Date().toISOString();
	}
	return new Date(Number(micros / 1000n)).toISOString();
};
