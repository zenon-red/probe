import type { HelpSpec } from "./help.js";
import { JSON_FLAG_HELP_DETAIL } from "./help.js";

const NEXUS_CONNECTION_OPTIONS = [
  { name: "--wallet", detail: "Wallet name" },
  { name: "--host, --module", detail: "SpacetimeDB host and module overrides" },
  { name: "--json", detail: JSON_FLAG_HELP_DETAIL },
];

export const LEAF_HELP_OVERRIDES: Record<string, Partial<HelpSpec>> = {
  "probe idea propose": {
    description: "Propose a new idea for a proposal_scout dispatch action",
    usage: [
      "probe idea propose --action-id <id> --title <title> --description <text> [options]",
      'probe idea propose --action-id 42 --title "Better task scoring" --description "..." --category planning',
    ],
    options: [
      { name: "--action-id", detail: "Dispatch action ID from proposal_scout (required)" },
      { name: "--title", detail: "Idea title (required)" },
      { name: "--description", detail: "Idea description (required)" },
      { name: "--category", detail: "Category (default: general)" },
      ...NEXUS_CONNECTION_OPTIONS,
    ],
    notes: [
      "Obtain --action-id from `probe action show <id>` when assigned a proposal_scout route.",
    ],
  },
  "probe idea vote": {
    description: "Vote on an idea with dimension scores for a vote dispatch action",
    usage: [
      "probe idea vote <idea-id> --action-id <id> <score-flags> [options]",
      "probe idea vote 7 --action-id 42 --ecosystem-impact 8 --implementation-readiness 7",
      "probe idea vote 7 --action-id 42 --score ecosystem_impact=8 --score implementation_readiness=7",
    ],
    options: [
      { name: "<idea-id>", detail: "Idea ID (required positional)" },
      { name: "--action-id", detail: "Dispatch action ID from vote route (required)" },
      {
        name: "--ecosystem-impact, …",
        detail: "Per-dimension integer scores (see probe idea dimensions)",
      },
      { name: "--score", detail: "Additional dimension as name=value (repeatable)" },
      ...NEXUS_CONNECTION_OPTIONS,
    ],
    notes: [
      "Run `probe idea dimensions` for active dimension names and score ranges.",
      "Provide every active dimension via score flags or --score.",
    ],
  },
  "probe task create": {
    description: "Create a task in a project",
    usage: [
      "probe task create --project <id> --title <title> --spec-requirement <name> [options]",
      'probe task create --project 3 --title "Implement API" --spec-requirement req-auth',
    ],
    options: [
      { name: "--project", detail: "Project ID (required)" },
      { name: "--title", detail: "Task title (required)" },
      { name: "--spec-requirement", detail: "OpenSpec requirement name (required)" },
      { name: "--description", detail: "Task description" },
      { name: "--priority", detail: "Priority 1-10 (default: 5)" },
      { name: "--github-issue-url", detail: "GitHub issue URL" },
      ...NEXUS_CONNECTION_OPTIONS,
    ],
  },
  "probe project create": {
    description: "Create a new project from an approved idea",
    usage: [
      "probe project create --name <name> --github-repo <org/repo> --source-idea <id> [options]",
      'probe project create --name "nexus-api" --github-repo org/repo --source-idea 12',
    ],
    options: [
      { name: "--name", detail: "Project name (required)" },
      { name: "--github-repo", detail: "GitHub repository org/repo (required)" },
      { name: "--source-idea", detail: "Source idea ID (required)" },
      { name: "--description", detail: "Project description" },
      ...NEXUS_CONNECTION_OPTIONS,
    ],
    notes: ["Plan ref must be submitted and approved before tasks can be created."],
  },
  "probe action show": {
    description: "Show details of a dispatch action",
    usage: ["probe action show <id> [options]", "probe action show 42"],
    options: [
      { name: "<id>", detail: "Action ID (required positional)" },
      ...NEXUS_CONNECTION_OPTIONS,
    ],
  },
};
