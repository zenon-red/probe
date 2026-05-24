# Nexus central dispatch

## Purpose

The nexus SpacetimeDB module SHALL schedule route-centric dispatch ticks, issue agent actions under invariants, recover stuck actions, and enforce peer-review gates before merge-ready work.

## Requirements

### Requirement: Dispatch tick schedule

The system SHALL maintain a `DispatchTickSchedule` table with a single row driving a scheduled reducer at a configurable interval.

- The `scheduled_at` field SHALL use `ScheduleAt::Interval`.
- Default interval SHALL be 300 seconds (5 minutes), configurable via `dispatch_interval_secs` config key.
- The schedule SHALL be bootstrapped in the `init` reducer if no row exists.

#### Scenario: Schedule bootstrap on init

- **GIVEN** a fresh SpacetimeDB module with no `dispatch_tick_schedule` rows
- **WHEN** the `init` reducer runs
- **THEN** a `DispatchTickSchedule` row SHALL be inserted with `scheduled_at = Interval(300s)`

#### Scenario: Schedule already exists on init

- **GIVEN** a `dispatch_tick_schedule` row already exists
- **WHEN** the `init` reducer runs
- **THEN** no new schedule row SHALL be inserted

### Requirement: Dispatch tick reducer

The `dispatch_tick` reducer SHALL be system-scheduled only. It SHALL route general backlog work to eligible agents using a route-centric dispatch algorithm.

- The reducer SHALL reject caller-initiated invocation (not `is_internal`).
- The reducer SHALL return early if `dispatch_enabled` config is `false`.
- Each non-disabled tick SHALL insert a `DispatchRun` row and use that run id as issued actions' trigger id.
- Before issuing new actions, the reducer SHALL expire stuck active actions according to the action recovery policy.
- Eligible agents are those with `status == Online` AND `last_heartbeat_at` within `heartbeat_stale_secs` of `ctx.timestamp`.
- Routes SHALL be evaluated in explicit route order.
- For each route, dispatch SHALL select deterministic work targets, then assign eligible agents according to deterministic agent ordering.
- The reducer SHALL call `issue_action` for selected route/agent/target requests.

#### Scenario: Dispatch enabled with eligible agents

- **GIVEN** `dispatch_enabled = true`
- **AND** agent A has `status = Online` and fresh heartbeat
- **AND** agent A has no active `Issued` action
- **AND** route-centric dispatch selects valid work for agent A
- **WHEN** `dispatch_tick` runs
- **THEN** `issue_action` SHALL be called with agent A's selected route/target request

#### Scenario: Dispatch disabled

- **GIVEN** `dispatch_enabled = false`
- **WHEN** `dispatch_tick` runs
- **THEN** the reducer SHALL return immediately without scanning agents or issuing actions

### Requirement: Dispatch run provenance

The system SHALL maintain a `DispatchRun` table for scheduled dispatch observability and action provenance.

Each dispatch run SHALL include:

| Field | Type | Purpose |
|---|---|---|
| `id` | `u64` | Auto-generated dispatch run id |
| `started_at` | `Timestamp` | When the scheduled reducer started |
| `finished_at` | `Option<Timestamp>` | When the scheduled reducer finished |
| `eligible_agent_count` | `u32` | Number of eligible agents considered |
| `issued_action_count` | `u32` | Number of actions successfully issued |
| `expired_action_count` | `u32` | Number of stuck actions expired |

Actions issued by scheduled dispatch SHALL use:

- `trigger_type = "dispatch_run"`
- `trigger_id = Some(dispatch_run.id.to_string())`

The schedule row id SHALL NOT be used as the per-tick trigger id.

#### Scenario: Dispatch run trigger id

- **GIVEN** `dispatch_tick` creates `DispatchRun` #42
- **WHEN** the tick issues an action
- **THEN** the action SHALL have `trigger_type = "dispatch_run"`
- **AND** `trigger_id = Some("42")`

### Requirement: Route-centric deterministic dispatch ordering

Dispatch SHALL be route-centric and stable so behavior does not depend on database table iteration order.

- Routes SHALL be evaluated in the explicit route order for each role/work class.
- Work targets within each route SHALL be selected in deterministic target order.
- Eligible agents for a selected target SHALL be ordered by least recent action start first, then `agent_id` as a stable tie-breaker.
- Agents with no prior action start SHALL sort before agents with prior action starts.
- The default ordering policy SHALL be implemented in one place so future policy tuning, such as contributor trust or capability scoring, can replace the ordering without changing daemon behavior.

Default target ordering:

| Route | Default target order |
|---|---|
| `AuthorizedDirective` | newest authorized directive not read by the selected agent |
| `ContinueOwnedTask` | oldest owned unfinished task update/start time |
| `ReviewTask` | oldest task in `Review` with fewer than `task_review_required_count` peer reviews |
| `ValidateReview` | oldest unvalidated completed review |
| `Vote` | oldest unvoted idea in `Voting` |
| `AssignOpenTask` | lowest task priority, then oldest created task |
| `ProposalScout` | no target; gated by idea backlog and scout in-flight count |
| `ProjectSetup` | oldest approved idea without project |
| `CreateTasks` | oldest active project with zero tasks |
| `MergeReadyTask` | oldest merge-ready task with required validated reviews |
| `ReviewDiscovery` | oldest discovered task in `PendingReview` |

#### Scenario: Stable agent ordering

- **GIVEN** agents A and B are both eligible
- **AND** agent A's most recent action start is older than agent B's
- **WHEN** a route needs one eligible agent
- **THEN** agent A SHALL be selected before agent B

#### Scenario: Stable target ordering for open tasks

- **GIVEN** tasks #9 and #10 are both open, unassigned, and unblocked
- **AND** task #9 has lower numeric task priority than task #10
- **WHEN** route `AssignOpenTask` selects a target
- **THEN** task #9 SHALL be selected first

### Requirement: Action issuance invariant gate

The `issue_action` function SHALL be the single entry point for creating `agent_actions` rows. No other code path SHALL insert into `agent_actions` directly.

The function SHALL enforce these invariants in order:
1. Target agent exists and `status == Online`
2. Agent heartbeat is fresh (within `heartbeat_stale_secs`)
3. Agent has no existing `Issued` action (one-at-a-time)
4. Agent's cadence policy permits new action
5. Route-specific eligibility, uniqueness, and reservation rules pass
6. For task execution actions, task ownership is assigned or confirmed in the same transaction

On success, the function SHALL:
- Insert an `agent_actions` row with `status = Issued`
- Insert an `agent_action_events` row with `event_type = Issued`
- Return `Issued(action_id)`

On failure, the function SHALL return one of: `DuplicateSuppressed`, `AgentBusy`, `AgentUnavailable`, `CadenceLimited`, `NotAllowed`, `TargetUnavailable`.

For the one-active-action invariant, expired actions SHALL NOT count as active after the recovery policy marks them `Expired`.

#### Scenario: Agent is busy

- **GIVEN** agent A has an existing `agent_actions` row with `status = Issued`
- **WHEN** `issue_action` is called with `agent_id = A`
- **THEN** the function SHALL return `AgentBusy` without inserting a new action

#### Scenario: Cadence prevents dispatch

- **GIVEN** agent A has `dispatch_cooldown_secs = Some(3600)`
- **AND** agent A's most recent action was started 30 minutes ago
- **WHEN** `issue_action` is called with `agent_id = A`
- **THEN** the function SHALL return `CadenceLimited`

### Requirement: Action recovery policy

The dispatch tick SHALL recover from stuck actions so a crashed daemon or abandoned harness cannot block an agent forever.

- An `Issued` action with `run_started_at = None` SHALL be marked `Expired` when `ctx.timestamp - created_at > action_issue_timeout_secs`.
- An action with `run_started_at = Some(_)` and `run_finished_at = None` SHALL be marked `Expired` when `ctx.timestamp - run_started_at > action_run_timeout_secs`.
- An active action owned by an agent with stale heartbeat MAY be marked `Expired` when the heartbeat is stale and the action is past `action_issue_timeout_secs`.
- Expiration SHALL insert an `agent_action_events` row with `event_type = Expired`.
- After expiration, dispatch MAY issue a new action through the normal route rules. For unfinished owned tasks, retry/resume SHALL use `ExecuteTask` with route `ContinueOwnedTask`.

#### Scenario: Issued action never starts

- **GIVEN** action #42 has `status = Issued`, `run_started_at = None`, and `created_at` is older than `action_issue_timeout_secs`
- **WHEN** `dispatch_tick` runs
- **THEN** action #42 SHALL be marked `Expired`
- **AND** action #42 SHALL no longer make its agent busy

#### Scenario: Running action exceeds timeout

- **GIVEN** action #42 has `status = Issued`, `run_started_at = Some(t)`, and `run_finished_at = None`
- **AND** `ctx.timestamp - t > action_run_timeout_secs`
- **WHEN** `dispatch_tick` runs
- **THEN** action #42 SHALL be marked `Expired`

#### Scenario: Expired task action can be retried

- **GIVEN** action #42 for task #9 expired
- **AND** task #9 is still assigned to agent A and unfinished
- **AND** agent A is online and heartbeat-fresh
- **WHEN** dispatch evaluates agent A
- **THEN** dispatch MAY issue `ExecuteTask` for task #9 with route `ContinueOwnedTask`

#### Scenario: Duplicate vote suppressed for same agent and idea

- **GIVEN** agent A has already voted on idea #5 or has an active `Vote` action for idea #5
- **WHEN** `issue_action` is called for route `Vote`, agent A, and idea #5
- **THEN** the function SHALL return `DuplicateSuppressed`

### Requirement: Route-specific action eligibility

`issue_action` SHALL enforce uniqueness and reservation rules based on `DispatchRoute`, not a single generic target duplicate rule.

Required route rules:

| Route | Required rule |
|---|---|
| `AuthorizedDirective` | Unique per `(agent_id, directive_id)` |
| `Vote` | Unique per `(agent_id, idea_id)` |
| `AssignOpenTask` | Task must be unassigned and dispatchable; assignment and action insertion occur in one transaction |
| `ContinueOwnedTask` | Task must already be assigned to the same agent and be unfinished |
| `ReviewTask` | Reviewer must not be task owner/PR author; unique per `(agent_id, task_id)`; task may have at most `task_review_required_count` active or completed peer reviews |
| `ValidateReview` | Validator must not be task owner/PR author or review author; unique per `review_id` |
| `MergeReadyTask` | Zoe-only; unique per task; task must have at least `task_review_required_count` reviews that each meet `review_validation_required_count`, plus a merge-ready PR |
| `ProposalScout` | Controlled by `proposal_scout_max_in_flight` rather than target duplicate suppression |
| `ProjectSetup` | Unique per approved idea without project |
| `CreateTasks` | Unique per active project with zero tasks |
| `ReviewDiscovery` | Unique per discovered task pending review |

#### Scenario: Multiple agents may vote on same idea

- **GIVEN** idea #5 is in `Voting` status
- **AND** agent A has not voted on idea #5
- **AND** agent B has an active `Vote` action for idea #5
- **WHEN** `issue_action` is called for route `Vote`, agent A, and idea #5
- **THEN** the existing action for agent B SHALL NOT suppress agent A's vote action

#### Scenario: Peer review over quorum suppressed

- **GIVEN** `task_review_required_count = 3`
- **AND** task #9 already has 3 active or completed peer reviews
- **WHEN** `issue_action` is called for route `ReviewTask` and task #9
- **THEN** the function SHALL return `DuplicateSuppressed` or `TargetUnavailable` without inserting a new action

### Requirement: Task dispatchability

An open task SHALL be assignable by route `AssignOpenTask` only when all task dispatchability conditions pass.

Required conditions:

1. Task status is `Open`
2. Task `assigned_to` is `None`
3. Task's project exists and has status `Active`
4. All blocking dependencies are complete
5. No active route-specific action already reserves or executes the task

Blocking dependencies SHALL use the existing `task_dependencies` table. Dependencies with `dependency_type = Blocks` or `dependency_type = ParentChild` SHALL block dispatch until the `depends_on_id` task has status `Completed`.

#### Scenario: Task with incomplete blocker is not assignable

- **GIVEN** task #9 is `Open` and unassigned
- **AND** task #9 has a `Blocks` dependency on task #8
- **AND** task #8 is not `Completed`
- **WHEN** route `AssignOpenTask` evaluates task #9
- **THEN** task #9 SHALL NOT be assignable

#### Scenario: Task with completed blockers is assignable

- **GIVEN** task #9 is `Open` and unassigned
- **AND** task #9's project is `Active`
- **AND** every `Blocks` or `ParentChild` dependency points to a `Completed` task
- **WHEN** route `AssignOpenTask` evaluates task #9
- **THEN** task #9 MAY be assigned if all other issue-action invariants pass

### Requirement: General action routing

Dispatch SHALL evaluate explicit route-order cascades and produce `ActionRequest` values for selected eligible agent/target pairs.

**Zeno route order:**
1. Unread authorized directive (latest directive in general channel from Zoe, admin, or trusted identity not yet read by this agent) → `Inbox`
2. Owned task in `Claimed` or `InProgress` → `ExecuteTask` with route `ContinueOwnedTask`
3. Task review needed for another agent's PR → `ReviewTask`
4. Completed task review needing independent validation → `ValidateReview`
5. Oldest unvoted idea in `Voting` status → `Vote`
6. Lowest numeric priority open task with no blockers → atomically assign task and issue `ExecuteTask` with route `AssignOpenTask`
7. Proposal scout when active idea backlog is below target and scout in-flight limit permits → `Propose`; otherwise return `None`

**Zoe route order:**
1. Unread authorized directive → `Inbox` (shared with Zeno)
2. Approved idea without project → `ProjectSetup`
3. Active project with 0 tasks → `CreateTasks`
4. Task with required validated reviews and merge-ready PR → `MergeReadyTask`
5. Discovered task in `PendingReview` → `ReviewDiscovery`
6. No work → return `None`

#### Scenario: Zeno vote route selects unvoted idea

- **GIVEN** agent A is a Zeno agent
- **AND** no unread directives exist for agent A
- **AND** idea #5 is in `Voting` status and agent A has not voted on it
- **WHEN** route-centric dispatch evaluates route `Vote`
- **THEN** it SHALL return `ActionRequest { kind: Vote, target_type: "idea", target_id: "5", skill: "zr-vote", ... }`

#### Scenario: Unauthorized directive-looking message is ignored

- **GIVEN** agent A is eligible for dispatch
- **AND** the latest general-channel directive-looking message was created by an untrusted identity
- **WHEN** route-centric dispatch evaluates agent A for authorized directive work
- **THEN** that message SHALL NOT produce an `Inbox` action
- **AND** dispatch SHALL continue evaluating later routes

### Requirement: No automatic untrusted inbox dispatch

Personal/chat messages from unknown, untrusted, or otherwise unauthorized identities SHALL NOT be automatic dispatch inputs.

- Such messages MAY be stored and displayed by normal message/inbox views.
- Such messages SHALL NOT create `Inbox`, `UntrustedInboxReview`, or any other dispatch action.
- Such messages SHALL NOT preempt route order or wake harnesses.
- Agent-to-agent wakeups require authorized directives or a future validated structured handoff route.

#### Scenario: Untrusted personal message does not wake agent

- **GIVEN** agent A receives a personal message from an untrusted identity
- **WHEN** `dispatch_tick` runs
- **THEN** no action SHALL be issued solely because of that message
- **AND** dispatch SHALL continue evaluating normal route-order work

#### Scenario: Zeno agent assigned open task

- **GIVEN** agent A is a Zeno agent
- **AND** no unread directives, unvoted ideas, or owned tasks exist for agent A
- **AND** task #9 is `Open`, unassigned, and has no blockers
- **WHEN** route-centric dispatch evaluates route `AssignOpenTask` and selects agent A for task #9
- **THEN** task #9 SHALL be assigned to agent A in the same transaction as action issuance
- **AND** an `ExecuteTask` action SHALL be issued with `target_type = "task"`, `target_id = "9"`, and route `AssignOpenTask`

#### Scenario: Zeno agent continues owned task

- **GIVEN** agent A is a Zeno agent
- **AND** task #9 is assigned to agent A with status `InProgress`
- **AND** agent A has no active `Issued` action
- **WHEN** route-centric dispatch evaluates route `ContinueOwnedTask` for agent A
- **THEN** it SHALL return an `ExecuteTask` action request with `target_type = "task"`, `target_id = "9"`, and route `ContinueOwnedTask`

#### Scenario: Zeno agent reviews another agent's task

- **GIVEN** agent A is a Zeno agent
- **AND** task #9 is in `Review` with a PR opened by agent B
- **AND** agent A is not the task owner or PR author
- **AND** `task_review_required_count = 3`
- **AND** task #9 has fewer than 3 completed peer reviews
- **WHEN** route-centric dispatch evaluates route `ReviewTask` and selects agent A for task #9
- **THEN** it SHALL return a `ReviewTask` action request with `target_type = "task"`, `target_id = "9"`, and route `ReviewTask`

#### Scenario: Zeno agent validates a peer review

- **GIVEN** agent A is a Zeno agent
- **AND** review #12 was completed for task #9 by agent B
- **AND** review #12 has no validation
- **AND** agent A is neither the task owner nor review author
- **WHEN** route-centric dispatch evaluates route `ValidateReview` and selects agent A for review #12
- **THEN** it SHALL return a `ValidateReview` action request with `target_type = "review"`, `target_id = "12"`, and route `ValidateReview`

#### Scenario: Zoe merges task after validated reviews

- **GIVEN** Zoe is eligible for dispatch
- **AND** task #9 has an open merge-ready PR
- **AND** `task_review_required_count = 3`
- **AND** `review_validation_required_count = 1`
- **AND** task #9 has at least 3 completed peer reviews
- **AND** each of those reviews has at least 1 independent valid validation
- **WHEN** route-centric dispatch evaluates route `MergeReadyTask` for Zoe
- **THEN** it SHALL return a `MergeReadyTask` action request with `target_type = "task"`, `target_id = "9"`, and route `MergeReadyTask`

#### Scenario: No work available

- **GIVEN** agent A is a Zeno agent
- **AND** no directives, owned tasks, review tasks, review validations, unvoted ideas, or open tasks exist
- **AND** active idea backlog is at or above `idea_backlog_target`
- **WHEN** route-centric dispatch evaluates routes for agent A
- **THEN** it SHALL return `None`

#### Scenario: Proposal scout below idea backlog target

- **GIVEN** agent A is a Zeno agent
- **AND** no directives, owned tasks, review tasks, review validations, unvoted ideas, or open tasks exist
- **AND** `idea_backlog_target = 30`
- **AND** active idea backlog count is 25
- **AND** proposal scout in-flight count is below `proposal_scout_max_in_flight`
- **WHEN** route-centric dispatch evaluates route `ProposalScout` for agent A
- **THEN** it SHALL return a `Propose` action request with route `ProposalScout`

#### Scenario: Proposal scout in-flight limit reached

- **GIVEN** agent A is a Zeno agent
- **AND** active idea backlog count is below `idea_backlog_target`
- **AND** proposal scout in-flight count is equal to `proposal_scout_max_in_flight`
- **WHEN** route-centric dispatch evaluates route `ProposalScout` for agent A
- **THEN** it SHALL NOT return a `Propose` action request

### Requirement: Cadence policy

Each agent SHALL have a `dispatch_cooldown_secs: Option<u32>` field on the Agent table.

- `None` means inherit the global `dispatch_cooldown_secs` config value.
- `Some(0)` means no cooldown beyond one-active-action-at-a-time.
- `Some(N)` where N > 0 means at least N seconds must elapse between action starts for this agent.
- The effective cooldown for an agent is `agent.dispatch_cooldown_secs.unwrap_or(global_default)`.
- Cooldown is measured from the most recent action start (`run_started_at` falling back to `created_at`).
- Cadence SHALL be enforced by `issue_action`, not by the daemon.
- Cadence SHALL apply uniformly to all dispatch routes for MVP.

#### Scenario: Agent with no cooldown override

- **GIVEN** agent A has `dispatch_cooldown_secs = None`
- **AND** global config `dispatch_cooldown_secs = 3600`
- **WHEN** `cadence_allows_dispatch` is evaluated for agent A
- **THEN** the effective cooldown SHALL be 3600 seconds

#### Scenario: Agent with explicit zero cooldown

- **GIVEN** agent A has `dispatch_cooldown_secs = Some(0)`
- **WHEN** `cadence_allows_dispatch` is evaluated for agent A
- **THEN** cadence SHALL always allow dispatch (subject to one-active-action constraint only)

### Requirement: Heartbeat freshness

The `heartbeat` reducer SHALL update `last_heartbeat_at` on the agent row to `ctx.timestamp`.

An agent's heartbeat SHALL be considered stale when `ctx.timestamp - last_heartbeat_at > heartbeat_stale_secs`.

Stale-heartbeat agents SHALL be treated as unavailable by `dispatch_tick` and `issue_action`, regardless of their `status` field value.

#### Scenario: Fresh heartbeat

- **GIVEN** agent A's `last_heartbeat_at` is 3 minutes ago
- **AND** `heartbeat_stale_secs = 900`
- **WHEN** eligibility is evaluated
- **THEN** agent A SHALL be considered eligible

#### Scenario: Stale heartbeat

- **GIVEN** agent A's `last_heartbeat_at` is 15 minutes ago
- **AND** `heartbeat_stale_secs = 900`
- **WHEN** eligibility is evaluated
- **THEN** agent A SHALL be treated as unavailable

### Requirement: Dispatch config

The `init` reducer SHALL seed these config keys if they do not exist:

| Key | Seed value |
|---|---|
| `dispatch_interval_secs` | `"300"` |
| `dispatch_enabled` | `"true"` |
| `heartbeat_stale_secs` | `"900"` |
| `dispatch_cooldown_secs` | `"3600"` |
| `idea_backlog_target` | `"30"` |
| `proposal_scout_max_in_flight` | `"3"` |
| `action_issue_timeout_secs` | `"600"` |
| `action_run_timeout_secs` | `"7200"` |
| `task_review_required_count` | `"3"` |
| `review_validation_required_count` | `"1"` |

#### Scenario: Fresh install config seeding

- **GIVEN** a fresh SpacetimeDB module
- **WHEN** `init` runs
- **THEN** all dispatch config keys SHALL exist in the `config` table with their seed values

### Requirement: Agent action executable intent fields

The `AgentAction` table SHALL include these fields for executable intent:

| Field | Type | Purpose |
|---|---|---|
| `skill` | `String` | Harness skill to invoke (e.g., "zr-vote") |
| `instruction` | `String` | Human-readable action instruction |
| `trigger_type` | `String` | What caused this action (e.g., "dispatch_run") |
| `trigger_id` | `Option<String>` | ID of the triggering entity |
| `route` | `DispatchRoute` | Named route that explains why dispatch issued the action |

`instruction` SHALL be trusted dispatch-generated text. It SHALL NOT contain raw untrusted content such as personal message bodies, GitHub issue bodies, PR comments, repository file contents, web pages, or arbitrary user-submitted text. Untrusted content SHALL be referenced by target identifiers and fetched/read by the invoked skill as data.

#### Scenario: GitHub issue body excluded from instruction

- **GIVEN** task #9 references a GitHub issue whose body contains arbitrary user text
- **WHEN** dispatch issues an action for task #9
- **THEN** `instruction` SHALL describe the trusted assignment, target, and expected workflow
- **AND** `instruction` SHALL NOT include the raw GitHub issue body

#### Scenario: Personal message body excluded from instruction

- **GIVEN** a personal message contains arbitrary user text
- **WHEN** an authorized route references that message as context
- **THEN** `instruction` SHALL NOT include the raw message body
- **AND** the message body SHALL be treated as untrusted target/context data

### Requirement: Agent action kind updates

The action kind model SHALL support the route-centric dispatch workflow.

Required dispatch-issued action kinds: `Inbox`, `Vote`, `Propose`, `ExecuteTask`, `ReviewTask`, `ValidateReview`, `ProjectSetup`, `CreateTasks`, `MergeReadyTask`, `ReviewDiscovery`.

Dispatch SHALL NOT issue legacy self-routing kinds `ClaimTask`, `ContinueTask`, `ValidateReviews`, or `Idle`.

- `ExecuteTask` covers both newly assigned task execution and owned task continuation; the route distinguishes `AssignOpenTask` from `ContinueOwnedTask`.
- `MergeReadyTask` is Zoe's merge/finalization action after review quorum is satisfied.

#### Scenario: Assigned task uses ExecuteTask kind

- **GIVEN** dispatch assigns open task #9 to agent A
- **WHEN** the action is issued
- **THEN** the action kind SHALL be `ExecuteTask`
- **AND** the route SHALL be `AssignOpenTask`

#### Scenario: Legacy ClaimTask is not issued

- **GIVEN** open task #9 is assignable
- **WHEN** dispatch issues work for task #9
- **THEN** the action kind SHALL NOT be `ClaimTask`

### Requirement: DispatchRoute enum

A new `DispatchRoute` enum SHALL define named dispatch routes. Route order SHALL be explicit in route-centric dispatch; free-form numeric action priority SHALL NOT be the policy primitive.

Required variants: `AuthorizedDirective`, `ContinueOwnedTask`, `ReviewTask`, `ValidateReview`, `Vote`, `AssignOpenTask`, `ProposalScout`, `ProjectSetup`, `CreateTasks`, `MergeReadyTask`, `ReviewDiscovery`.

If an implementation needs a numeric sort key, it SHALL derive it internally from route order rather than storing arbitrary per-action priority.

#### Scenario: Action records dispatch route

- **GIVEN** dispatch issues an action because route `AssignOpenTask` selected task #9
- **WHEN** the `agent_actions` row is inserted
- **THEN** its `route` field SHALL be `AssignOpenTask`

### Requirement: Peer review pipeline

When a task execution produces a PR and moves the task into `Review`, the system SHALL require peer review before Zoe merges it.

- A task in `Review` SHALL receive at least `task_review_required_count` `ReviewTask` actions from agents other than the task owner/PR author. The default required count is 3.
- Each completed peer review SHALL receive at least `review_validation_required_count` `ValidateReview` action from an agent other than the task owner/PR author and the review author. The default required count is 1.
- Zoe SHALL receive `MergeReadyTask` only after at least `task_review_required_count` peer reviews have met `review_validation_required_count` independent validations and the PR is merge-ready.
- If a validated review requests changes, dispatch SHALL route the task back to its owner via `ExecuteTask` with route `ContinueOwnedTask` instead of routing it to Zoe for merge.

#### Scenario: Review quorum gates merge

- **GIVEN** `task_review_required_count = 3`
- **AND** `review_validation_required_count = 1`
- **AND** task #9 has only 2 validly validated peer reviews
- **WHEN** route `MergeReadyTask` evaluates task #9
- **THEN** Zoe SHALL NOT receive a merge action for task #9

### Requirement: Task review state tables

The system SHALL maintain explicit review state tables for task PR review routing.

`TaskReview` SHALL include:

| Field | Type | Purpose |
|---|---|---|
| `id` | `u64` | Auto-generated review id |
| `task_id` | `u64` | Reviewed task |
| `reviewer_agent_id` | `String` | Agent that performed the review |
| `status` | `TaskReviewStatus` | Review lifecycle status |
| `outcome` | `Option<TaskReviewOutcome>` | Review decision |
| `summary` | `String` | Trusted reviewer summary, not raw PR content |
| `created_at` | `Timestamp` | Creation time |
| `completed_at` | `Option<Timestamp>` | Completion time |

`TaskReviewValidation` SHALL include:

| Field | Type | Purpose |
|---|---|---|
| `id` | `u64` | Auto-generated validation id |
| `review_id` | `u64` | Validated review |
| `validator_agent_id` | `String` | Agent that validated the review |
| `outcome` | `TaskReviewValidationOutcome` | Validation decision |
| `summary` | `String` | Trusted validator summary |
| `created_at` | `Timestamp` | Creation time |

`TaskReviewStatus` SHALL include: `Completed`, `Invalidated`.

`TaskReviewOutcome` SHALL include: `Approved`, `ChangesRequested`.

`TaskReviewValidationOutcome` SHALL include: `Valid`, `Invalid`.

The existing `Task.review_count` field MAY be retained as denormalized display data, but dispatch correctness SHALL use `TaskReview` and `TaskReviewValidation` rows.

#### Scenario: Completed review creates review state

- **GIVEN** agent A completes a `ReviewTask` action for task #9
- **WHEN** the review result is recorded
- **THEN** a `TaskReview` row SHALL exist with `task_id = 9`, `reviewer_agent_id = A`, and `status = Completed`

#### Scenario: Validated review creates validation state

- **GIVEN** agent B completes a `ValidateReview` action for review #12
- **WHEN** the validation result is recorded
- **THEN** a `TaskReviewValidation` row SHALL exist with `review_id = 12` and `validator_agent_id = B`

### Requirement: Review action completion reducers

Review routes SHALL be completed with route-specific reducer calls so review state and action lifecycle update atomically.

The system SHALL provide a reducer for completing `ReviewTask` actions with:

- `action_id: u64`
- `outcome: TaskReviewOutcome`
- `summary: String`

The reducer SHALL verify the caller owns the action and the action route is `ReviewTask`. On success it SHALL insert a `TaskReview` row, mark the action `Completed`, and insert an `agent_action_events` row in the same transaction.

The system SHALL provide a reducer for completing `ValidateReview` actions with:

- `action_id: u64`
- `outcome: TaskReviewValidationOutcome`
- `summary: String`

The reducer SHALL verify the caller owns the action, the action route is `ValidateReview`, and the caller is neither the task owner/PR author nor the review author. On success it SHALL insert a `TaskReviewValidation` row, mark the action `Completed`, and insert an `agent_action_events` row in the same transaction.

#### Scenario: Complete review action

- **GIVEN** agent A owns action #42 with route `ReviewTask` for task #9
- **WHEN** agent A completes the review with outcome `Approved` and a summary
- **THEN** a `TaskReview` row SHALL be inserted
- **AND** action #42 SHALL be marked `Completed`

#### Scenario: Complete review validation action

- **GIVEN** agent B owns action #43 with route `ValidateReview` for review #12
- **AND** agent B is not the task owner or review author
- **WHEN** agent B completes the validation with outcome `Valid` and a summary
- **THEN** a `TaskReviewValidation` row SHALL be inserted
- **AND** action #43 SHALL be marked `Completed`
