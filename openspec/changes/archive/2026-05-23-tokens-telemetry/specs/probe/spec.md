## MODIFIED Requirements

### Requirement: Action execution on insert

When the daemon receives an `agent_actions` row insert where `agent_id` matches its own agent and `status = Issued` (checked client-side), the daemon SHALL execute the action.

Execution steps:
1. If already running a harness process, log a violation and do not start another.
2. Report `run_started_at` and `harness` metadata on the action row.
3. Build a prompt from the action's `skill` and `instruction` fields; the prompt's first line SHALL be `zenon.red{action:<action_id>}`.
4. Spawn the configured harness with `shell: false` using built-in command arrays.
5. Wait for the harness process to exit.
6. Derive `input_tokens` and `output_tokens` from harness session stores per the post-run extraction requirements below.
7. Report infrastructure outcome:
   - Clean exit (code 0) → `Clean`
   - Signal kill → `Signal`
   - Timeout → kill process, `Timeout`
   - Spawn failure → `SpawnFailed`
8. Report `run_finished_at`, `run_duration_secs`, `input_tokens`, and `output_tokens` via `report_action_run_finished`.

#### Scenario: Clean harness execution with tokens

- **GIVEN** the daemon receives an issued action with id `42`
- **AND** no harness is currently running
- **WHEN** the harness process exits with code 0 after 45 seconds
- **AND** session extraction yields `input_tokens = 12000` and `output_tokens = 800`
- **THEN** the daemon SHALL report `run_outcome = Clean`, `run_duration_secs = 45`, `input_tokens = 12000`, `output_tokens = 800`

#### Scenario: Harness timeout

- **GIVEN** the daemon receives an issued action
- **AND** `harnessTimeoutSecs = 7200`
- **WHEN** the harness runs for more than 7200 seconds
- **THEN** the daemon SHALL kill the process
- **AND** report `run_outcome = Timeout`
- **AND** SHALL report `input_tokens` and `output_tokens` derived from session stores (possibly `0` if extraction fails)

#### Scenario: Already running

- **GIVEN** the daemon is already executing a harness process
- **WHEN** a new issued action arrives
- **THEN** the daemon SHALL log a violation and NOT start another harness

#### Scenario: Extraction miss still finishes run

- **GIVEN** the daemon receives an issued action
- **WHEN** the harness exits with code 0
- **AND** session extraction returns `0` for both token fields
- **THEN** the daemon SHALL still call `report_action_run_finished` with `input_tokens = 0` and `output_tokens = 0`

#### Scenario: Custom harness reports zero tokens

- **GIVEN** the daemon runs with `harness = custom` (or any harness without a registered session parser)
- **WHEN** the harness process exits
- **THEN** the daemon SHALL report `input_tokens = 0` and `output_tokens = 0`
- **AND** SHALL still report run finish metadata

## ADDED Requirements

### Requirement: STDB token columns on agent_actions

The `agent_actions` relation SHALL include `input_tokens: u64` and `output_tokens: u64`.

New columns SHALL use SpacetimeDB `#[default(0)]` so existing rows receive `0` on module publish without a separate backfill reducer.

Rows that finished before telemetry ships keep `0`/`0` (historical runs are not recomputed). Rows where extraction fails after telemetry ships also keep `0`/`0` while run metadata is still recorded.

The finish reducer SHALL set both fields on every successful `report_action_run_finished` call.

#### Scenario: Schema publish backfills existing rows

- **GIVEN** `agent_actions` rows exist before the telemetry module publish
- **WHEN** the updated module is published with `input_tokens` and `output_tokens` marked `#[default(0)]`
- **THEN** existing rows SHALL read `input_tokens = 0` and `output_tokens = 0` until a finish reducer updates them

#### Scenario: Finish reducer persists tokens

- **WHEN** the daemon calls `report_action_run_finished` with `input_tokens = 5000` and `output_tokens = 1200`
- **THEN** the action row SHALL store those values alongside `run_finished_at` and `run_outcome`

### Requirement: Action correlation marker

Every harness prompt built by the probe daemon SHALL include as its first line the correlation marker `zenon.red{action:<action_id>}` where `<action_id>` is the numeric `agent_actions.id` for the issued action.

The marker SHALL NOT be stored in SpacetimeDB; it exists only in the prompt passed to the harness.

#### Scenario: Prompt contains marker

- **WHEN** the daemon builds a prompt for action id `42`
- **THEN** the first line of the prompt SHALL be exactly `zenon.red{action:42}`

### Requirement: Post-run session token extraction

After a harness process exits, the probe daemon SHALL derive `input_tokens` and `output_tokens` by reading harness session persistence on disk, not by parsing harness stdout.

Supported harnesses for extraction: `pi`, `hermes`, `opencode`, `openclaw`. All other harness values (including `custom`) SHALL yield `0`/`0` without error.

Extraction SHALL:

1. Dispatch to a harness-specific extractor (no shared “single artifact file” abstraction across harnesses)
2. **pi / openclaw:** stream JSONL session files; find newest file containing the marker with `mtime >= run_started_at`; scope marker-to-marker; sum usage
3. **opencode:** resolve `storage/` under `OPENCODE_DATA_DIR`, `~/.local/share/opencode`, or project `.opencode/storage`; find the newest message or part file containing the marker; prefer `opencode.db` session totals when the session has a single dispatch marker, else sum `step-finish` parts under `storage/part/` scoped after the marker (and before the next dispatch marker in `storage/message/`)
4. **hermes:** read `state.db` once; correlate via `messages.timestamp >= run_started_at` (not `state.db` mtime)
5. When a session contains more than one `zenon.red{action:` marker, sum usage only from the matching marker until the next marker or end of scope; Hermes multi-marker sessions use JSON snapshots or return `0`/`0`

#### Scenario: Successful extraction after pi run

- **GIVEN** action id `7` finished with `run_started_at` set
- **AND** a pi session JSONL file contains `zenon.red{action:7}` and assistant messages with `usage.input` and `usage.output`
- **WHEN** the daemon extracts harness usage for harness `pi`
- **THEN** the derived `input_tokens` and `output_tokens` SHALL equal the sum of usage in the scoped message range

#### Scenario: Hermes single-marker session uses row totals

- **GIVEN** action id `7` finished on harness `hermes`
- **AND** the correlated session artifact in `~/.hermes/state.db` contains exactly one `zenon.red{action:7}` marker
- **WHEN** the daemon extracts harness usage
- **THEN** `input_tokens` and `output_tokens` MAY equal the correlated `sessions` row `input_tokens` and `output_tokens` totals

#### Scenario: Hermes multi-marker session uses scoped parse

- **GIVEN** action id `7` finished on harness `hermes`
- **AND** the correlated session artifact contains `zenon.red{action:7}` and a later `zenon.red{action:8}` marker
- **WHEN** the daemon extracts harness usage
- **THEN** totals SHALL be derived from message-level usage after the marker (e.g. JSON snapshot under `~/.hermes/sessions/` when present)
- **AND** SHALL NOT use full `sessions` row totals (which include prior dispatches)

#### Scenario: Hermes multi-marker without message-level data

- **GIVEN** action id `7` on harness `hermes`
- **AND** the correlated session contains multiple action markers
- **AND** no message-level usage source allows scoping to action `7`
- **WHEN** the daemon extracts harness usage
- **THEN** `input_tokens` and `output_tokens` SHALL be `0`

### Requirement: Non-fatal extraction failure

When session lookup or parsing fails, the extractor SHALL return `input_tokens = 0` and `output_tokens = 0` without causing the action executor to fail or skip `report_action_run_finished`.

#### Scenario: Missing session file

- **GIVEN** action id `99` finished cleanly
- **AND** no session artifact contains `zenon.red{action:99}`
- **WHEN** the daemon extracts harness usage
- **THEN** `input_tokens` SHALL be `0`
- **AND** `output_tokens` SHALL be `0`
- **AND** the daemon SHALL still report run finish metadata

### Requirement: Harness session data roots

Each supported harness type SHALL define a default session data root:

| Harness | Default root |
|---------|----------------|
| pi | `~/.pi/agent/sessions/` |
| hermes | `~/.hermes/` (primary: `state.db`; snapshots: `~/.hermes/sessions/`) |
| opencode | `~/.local/share/opencode/` (`storage/message/`, `storage/part/`, `opencode.db`) |
| openclaw | `~/.openclaw/sessions/` |

Optional probe configuration MAY override these roots for lab audit mounts without changing extraction semantics.

#### Scenario: Default pi root

- **GIVEN** harness `pi` and no `harnessDataRoots` override
- **WHEN** the daemon searches for session artifacts
- **THEN** the search SHALL begin under `~/.pi/agent/sessions/`

### Requirement: Extractor memory bound

Token extraction SHALL accumulate numeric totals while parsing and SHALL NOT retain full session file contents in memory after parsing completes.

#### Scenario: Large pi session

- **GIVEN** a pi JSONL session file larger than available RAM would allow if fully buffered
- **WHEN** the daemon extracts usage
- **THEN** extraction SHALL complete by streaming the file without holding the entire file as a single in-memory string

### Requirement: Frontend token display coalesce

The agent profile UI SHALL treat missing or unset token fields as `0` when aggregating Operations stats (defensive; bindings after `#[default(0)]` publish should already return zero).

#### Scenario: Legacy row in profile aggregate

- **GIVEN** an action row with `run_started_at` set and `input_tokens` / `output_tokens` both `0`
- **WHEN** the profile computes Tokens in / Tokens out
- **THEN** the row SHALL contribute `0` to both sums
- **AND** SHALL still count toward Runs and Time worked
