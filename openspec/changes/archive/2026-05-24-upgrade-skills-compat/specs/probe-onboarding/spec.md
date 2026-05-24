## ADDED Requirements

### Requirement: Pinned global skills install on onboard

When probe onboard installs zenon-red skills, it SHALL run a global install that includes the probe-bundled expected git tag in the source URL (`zenon-red/skills#<EXPECTED_SKILLS_REF>`) and install all routed skills (`--skill='*'`).

The install command SHALL use the same `EXPECTED_SKILLS_REF` constant as post-upgrade `checkSkillsCompat()`.

Recovery hints on install failure SHALL include the same pinned install command.

#### Scenario: Onboard installs pinned skills tag

- **GIVEN** onboard runs the skills install step successfully
- **WHEN** the global skills lock file is read afterward
- **THEN** every `zenon-red/skills` entry SHALL have `ref` equal to the probe expected ref
