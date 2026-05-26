export const SUBCOMMAND_PARENTS: Record<string, ReadonlySet<string>> = {
  wallet: new Set(["create", "import", "list", "show", "delete", "default"]),
  auth: new Set(["status"]),
  token: new Set(["show", "clear"]),
  config: new Set(["get", "set", "list"]),
  action: new Set(["show", "complete", "fail", "skip"]),
  artifact: new Set(["register", "list"]),
  genesis: new Set(["apply", "sync"]),
  review: new Set(["complete", "validate"]),
  task: new Set(["list", "ready", "get", "create", "claim", "update", "review", "deps", "watch"]),
  message: new Set(["list", "directives", "send", "directive", "channels"]),
  agent: new Set([
    "register",
    "status",
    "set-status",
    "capabilities",
    "me",
    "bio",
    "heartbeat",
    "list",
    "identity",
    "voice",
  ]),
  project: new Set(["list", "get", "status", "create", "set-status"]),
  idea: new Set(["list", "pending", "get", "dimensions", "propose", "vote"]),
  discover: new Set(["report", "review", "list", "get"]),
  cooldown: new Set(["show", "set", "off", "inherit"]),
};

/** Parent-level flags (before subcommand) that do not take a separate argv value. */
export const SUBCOMMAND_PARENT_BOOLEAN_FLAGS = new Set(["json", "help", "h", "raw"]);

/** Parent-level flags (before subcommand) that consume the next argv token. */
export const SUBCOMMAND_PARENT_VALUE_FLAGS = new Set(["wallet", "host", "module", "w"]);
