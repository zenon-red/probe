# PRD: Post-Upgrade Skills Check

## Status

- Draft
- Owner: Probe
- Scope: `probe` CLI, global Skills CLI integration

## Problem

Probe upgrades and skills upgrades are decoupled, which allows version drift:

- Probe can be updated while skills remain outdated.
- Agents can run with incompatible skill semantics.
- There is no signal that skills are stale after a probe upgrade.

The organization installs skills globally (`skills ... -g`) so all agent frameworks reuse one shared skill baseline.

## Proposal

After `probe upgrade`, check the global skills lock against the expected skills version and print a warning if stale. One function, one console message. No enforcement, no new file formats, no server-side reporting.

In `--json` mode, include the compatibility result in JSON instead of printing warning text.

## How It Works

### Skills Version Constant

Probe hardcodes the expected skills ref in source:

```ts
// src/utils/skills-check.ts
const EXPECTED_SKILLS_REF = "v0.12.0"; // updated when probe bumps
const EXPECTED_SKILLS_SOURCE = "zenon-red/skills";
```

When probe is updated, this constant is updated to match the skills tag that was tested with this probe version.

### Post-Upgrade Check

After `probe upgrade` completes:

1. Read the global skills lock file (`$XDG_STATE_HOME/skills/.skill-lock.json` or fallback `~/.agents/.skill-lock.json`).
2. Find required skills whose `source` exactly matches `zenon-red/skills`.
3. Check that their `ref` matches `EXPECTED_SKILLS_REF`.
4. Print the result in human mode or include it in JSON mode.

### Human Output

Success prints one concise confirmation:

```
✓ Probe updated: 0.9.0 → 0.9.1
✓ Skills compatible (ref: v0.12.0)
```

Mismatch prints one warning and exact fix command:

```
✓ Probe updated: 0.9.0 → 0.9.1
⚠ Skills ref mismatch: expected v0.12.0, found v0.10.0
  Run: skills install zenon-red/skills#v0.12.0 -g
```

Missing/unreadable lock prints one warning and install command:

```
✓ Probe updated: 0.9.0 → 0.9.1
⚠ Skills lock not found at ~/.agents/.skill-lock.json
  Run: skills install zenon-red/skills#v0.12.0 -g
```

### JSON Output

`probe upgrade --json` should not print human warnings. Include a field in the upgrade result:

```json
{
  "method": "npm",
  "currentVersion": "0.9.0",
  "targetVersion": "0.9.1",
  "updated": true,
  "skillsCompat": {
    "status": "warn",
    "expectedRef": "v0.12.0",
    "foundRef": "v0.10.0",
    "message": "Skills ref mismatch: expected v0.12.0, found v0.10.0",
    "fixCommand": "skills install zenon-red/skills#v0.12.0 -g"
  }
}
```

### Status Outcomes

| Status    | Condition                                                               | Human output                |
| --------- | ----------------------------------------------------------------------- | --------------------------- |
| `ok`      | Lock exists, exact source exists, ref matches                           | Success line                |
| `warn`    | Lock exists, exact source exists, ref mismatch                          | Warning + exact fix command |
| `unknown` | Lock missing, unreadable, or no exact `zenon-red/skills` source entries | Warning + install command   |

No enforcement. No exit code changes. No routing policy hooks. Just a printed warning with the exact command to fix it.

## Implementation

### New File

| File                        | Change                                           |
| --------------------------- | ------------------------------------------------ |
| `src/utils/skills-check.ts` | **New** — lock file reader + compatibility check |

### Modified Files

| File                      | Change                                                                  |
| ------------------------- | ----------------------------------------------------------------------- |
| `src/commands/upgrade.ts` | Call skills check after successful upgrade and include result in output |

### Logic

```ts
type SkillsCompat = {
  status: "ok" | "warn" | "unknown";
  expectedRef: string;
  foundRef?: string;
  message: string;
  fixCommand?: string;
};

export function checkSkillsCompat(): SkillsCompat {
  const lockPath = findGlobalLockFile();
  const fixCommand = `skills install ${EXPECTED_SKILLS_SOURCE}#${EXPECTED_SKILLS_REF} -g`;

  if (!lockPath) {
    return {
      status: "unknown",
      expectedRef: EXPECTED_SKILLS_REF,
      message: "Skills lock not found",
      fixCommand,
    };
  }

  const lock = readJsonSync(lockPath);
  if (!Array.isArray(lock?.skills)) {
    return {
      status: "unknown",
      expectedRef: EXPECTED_SKILLS_REF,
      message: "Skills lock unreadable",
      fixCommand,
    };
  }

  const zrSkills = lock.skills.filter((s) => s.source === EXPECTED_SKILLS_SOURCE);
  if (zrSkills.length === 0) {
    return {
      status: "unknown",
      expectedRef: EXPECTED_SKILLS_REF,
      message: `No ${EXPECTED_SKILLS_SOURCE} entries in lock`,
      fixCommand,
    };
  }

  const mismatched = zrSkills.filter((s) => s.ref !== EXPECTED_SKILLS_REF);
  if (mismatched.length > 0) {
    return {
      status: "warn",
      expectedRef: EXPECTED_SKILLS_REF,
      foundRef: mismatched[0].ref,
      message: `Skills ref mismatch: expected ${EXPECTED_SKILLS_REF}, found ${mismatched[0].ref}`,
      fixCommand,
    };
  }

  return {
    status: "ok",
    expectedRef: EXPECTED_SKILLS_REF,
    foundRef: EXPECTED_SKILLS_REF,
    message: `Skills compatible (ref: ${EXPECTED_SKILLS_REF})`,
  };
}
```

### What This Does NOT Do

- No new manifest file format
- No SpacetimeDB schema changes
- No Nexus reporting of skills versions
- No routing policy changes
- No enforcement or blocking
- No CI integration
- No `probe doctor compatibility` subcommand

These can be added later if there's a demonstrated need. Right now the only thing that matters: after an upgrade, the operator knows if their skills are stale.

## Research Summary: Skills CLI Facts

Based on `~/research/skills` source:

- Global lock file path: `$XDG_STATE_HOME/skills/.skill-lock.json`, fallback `~/.agents/.skill-lock.json`
- Lock entries include `source`, `ref`, `sourceType`, `skillPath`
- `skills list --json` does not expose full ref/source/hash metadata — read lock files directly

## Risks

| Risk                                               | Mitigation                                               |
| -------------------------------------------------- | -------------------------------------------------------- |
| Lock file format drift in upstream Skills CLI      | Parse defensively with explicit fallbacks                |
| Operators mixing global and project skill installs | Check global lock only; warn if project lock also exists |
| Tag naming discipline in `zenon-red/skills`        | Define release contract before any enforcement           |

## Acceptance Criteria

- `probe upgrade` checks global skills compatibility every successful upgrade
- Human mode prints a success line, warning, or unknown warning
- JSON mode includes `skillsCompat` and does not print human warning text
- Incompatibilities include the exact fix command
- Missing lock files include the install command
- Matching uses exact `source === "zenon-red/skills"`
- No new STDB tables, no server-side changes, no enforcement
