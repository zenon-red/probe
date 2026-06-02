export const SUBCOMMAND_PARENTS: Record<string, ReadonlySet<string>> = {
  wallet: new Set(["create", "import", "list", "show", "delete", "default"]),
  auth: new Set(["status"]),
  token: new Set(["show", "clear"]),
  config: new Set(["get", "set", "list"]),
  action: new Set([
    "show",
    "complete",
    "complete-setup",
    "complete-tasks",
    "complete-merge",
    "review-discovery",
    "fail",
    "skip",
  ]),
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
  project: new Set(["list", "get", "status", "create", "set-status", "spec"]),
  idea: new Set(["list", "pending", "get", "dimensions", "propose", "vote"]),
  human: new Set(["assign", "dispatch", "review"]),
  discover: new Set(["report", "review", "list", "get"]),
  cooldown: new Set(["show", "set", "off", "inherit"]),
};

export const SUBCOMMAND_PARENT_BOOLEAN_FLAGS = new Set(["json", "help", "h", "raw"]);

export const SUBCOMMAND_PARENT_VALUE_FLAGS = new Set(["wallet", "host", "module", "w"]);
