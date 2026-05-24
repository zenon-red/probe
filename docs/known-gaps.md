# Known gaps and edge cases

Reference notes for contributors. Normative behavior is in `openspec/specs/<capability>/spec.md`.

1. **Config cache is in-memory singleton** — `clearConfigCache()` required after writes; not thread-safe
2. **Wallet auto-default** — only triggers when `wallets.length === 1` after create/import
3. **Daemon Docker adapter** — `install()` always returns `success: false` (MVP not implemented)
4. **Voice transcript length** — validated client-side only (500 chars)
5. **Message content validation** — ANSI detection regex-based; may have false positives/negatives
6. **Daemon narrow subscriptions** — two-phase subscribe (agents by identity, then agent_actions by agent_id); Issued status filtered client-side (STDB cannot filter enums in SQL)
7. **Binary upgrade rollback** — if `.bak` restore fails, throws `ROLLBACK_FAILED`
8. **Token expiry check** — client-side `Date.now()` comparison; clock skew possible
9. **SQL query** — decode applies only when `inferTableNameSafe` is unambiguous; joins/multi-statement return raw rows with metadata
