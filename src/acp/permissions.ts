import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

function pickOption(
  options: PermissionOption[],
  kinds: PermissionOption["kind"][],
): PermissionOption | undefined {
  for (const kind of kinds) {
    const match = options.find((option) => option.kind === kind);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function selected(optionId: string): RequestPermissionResponse {
  return { outcome: { outcome: "selected", optionId } };
}

function cancelled(): RequestPermissionResponse {
  return { outcome: { outcome: "cancelled" } };
}

/** Unattended dispatch: auto-approve tool permissions when an allow option exists. */
export function resolveUnattendedPermission(
  params: RequestPermissionRequest,
): RequestPermissionResponse {
  const options = params.options ?? [];
  if (options.length === 0) {
    return cancelled();
  }

  const allowOption = pickOption(options, ["allow_once", "allow_always"]);
  if (allowOption) {
    return selected(allowOption.optionId);
  }

  const rejectOption = pickOption(options, ["reject_once", "reject_always"]);
  if (rejectOption) {
    return selected(rejectOption.optionId);
  }

  return cancelled();
}
