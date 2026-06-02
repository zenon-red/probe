export function readDispatchEnabled(rows: ReadonlyArray<{ key: string; value: string }>): boolean {
  const row = rows.find((c) => c.key === "dispatch_enabled");
  if (!row) return true;
  return row.value !== "false";
}

export function dispatchLabel(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off";
}

export function dispatchLabelFromConfig(
  rows: ReadonlyArray<{ key: string; value: string }>,
): "on" | "off" {
  return dispatchLabel(readDispatchEnabled(rows));
}
