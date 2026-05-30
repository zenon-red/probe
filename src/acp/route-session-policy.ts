export type SessionPolicy = "ephemeral" | "persistent";

export function sessionPolicyForRoute(route: string): SessionPolicy {
  if (route === "ContinueOwnedTask") {
    return "persistent";
  }
  return "ephemeral";
}
