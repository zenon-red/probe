# Test coverage

`npm run test:ci` runs all `tests/unit/*.test.ts` after `generate:decoders`.

| Test file                                   | What's tested                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `action-ownership.test.ts`                  | Action complete/fail/review ownership and routes                         |
| `config.test.ts`                            | `expandHomeDir`, default config loading                                  |
| `context.test.ts`                           | `commandContextOptions`, host/module defaults, console/identity boundary |
| `daemon-events.test.ts`                     | JSONL filtering, sanitization, log levels                                |
| `daemon-harness.test.ts`                    | Harness spawn args and outcomes                                          |
| `daemon-invariants.test.ts`                 | One action at a time, heartbeat, reducer failures                        |
| `daemon-reconnect.test.ts`                  | Backoff and reconnect loop                                               |
| `doctor.test.ts`                            | Doctor issue aggregation and next_commands                               |
| `emit.test.ts`                              | TOON/JSON output and error rendering                                     |
| `help.test.ts`                              | Plain-text help (root and subcommand parents)                            |
| `host-module-command.test.ts`               | `--host` / `--module` forwarding                                         |
| `message-list.test.ts`                      | Shared list/directives sort and kind filter                              |
| `message-send.test.ts`                      | Content validation and directive type policy                             |
| `message-target.test.ts`                    | Project/channel target resolution                                        |
| `probe-error.test.ts`                       | `ProbeError` and boundary rendering                                      |
| `reducer-command.test.ts`                   | `runReducerCommand` success and `REDUCER_FAILED`                         |
| `schema-drift.test.ts`                      | Enum decoder parity with bindings                                        |
| `sql-decode.test.ts`                        | Safe SQL table inference and decode policy                               |
| `sql.test.ts`                               | SQL HTTP endpoint helpers                                                |
| `subcommands.test.ts`                       | Citty subcommand dispatch across groups                                  |
| `wallet.test.ts`                            | Wallet create/import/list/load/delete                                    |
| `harness-usage.test.ts`                     | Marker scoping, per-harness extractors (fixtures)                        |
| `tests/node/harness-usage-hermes.test.ts`   | Hermes SQLite extraction (`node:sqlite`; `npm run test:hermes`)          |
| `tests/node/harness-usage-opencode.test.ts` | OpenCode DB/part extraction (`npm run test:opencode`)                    |

Integration/E2E tests for live SpacetimeDB and full OIDC flows are out of scope for `test:ci`.
