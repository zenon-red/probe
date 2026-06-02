import React, { useEffect, useState } from "react";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import type { DaemonEvent } from "../events.js";
import type { EventBus } from "../events.js";
import { buildStatusFromEvents, readJsonlEvents, renderStatusText } from "../status-reader.js";
import { readActionSidecar } from "../sidecar-read.js";
import { projectDaemonEvents } from "../projection.js";

/** Ink draws to stderr; daemon JSONL stays on stdout. See vadimdemedes/ink render() options. */
const INK_RENDER_OPTIONS = {
  stdout: process.stderr,
  stdin: process.stdin,
  alternateScreen: true,
  incrementalRendering: true,
  maxFps: 8,
  patchConsole: false,
} as const;

export type TuiState = {
  wallet?: string;
  harness?: string;
  host?: string;
  module?: string;
  identity?: string;
  dispatch: string;
  health: "healthy" | "degraded" | "reconnecting" | "auth failing";
  uptimeSecs: number;
  actions: Array<{ id: string; state: string }>;
  events: DaemonEvent[];
  selectedIndex: number;
  filter: string;
};

export type NexusTuiHandle = {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
};

const initialState = (seed?: Partial<TuiState>): TuiState => ({
  dispatch: "unknown",
  health: "healthy",
  uptimeSecs: 0,
  actions: [],
  events: [],
  selectedIndex: 0,
  filter: "",
  ...seed,
});

function projectTuiState(events: DaemonEvent[], seed?: Partial<TuiState>): TuiState {
  const projection = projectDaemonEvents(events, {
    wallet: seed?.wallet,
    host: seed?.host,
    module: seed?.module,
    harness: seed?.harness,
    dispatch: seed?.dispatch,
  });
  return {
    ...initialState(seed),
    wallet: projection.wallet,
    harness: projection.harness,
    host: projection.host,
    module: projection.module,
    identity: projection.identity,
    dispatch: projection.dispatch,
    health: projection.health,
    uptimeSecs: projection.uptimeSecs ?? 0,
    actions: projection.actions.map((action) => ({
      id: action.actionId,
      state: action.state,
    })),
    events: projection.events,
  };
}

type EventGroup = {
  key: string;
  type: string;
  firstAt: string;
  lastAt: string;
  count: number;
  actionId?: string;
  message?: string;
};

type Notice = {
  level: "info" | "warning" | "error";
  message: string;
};

function eventGroupKey(event: DaemonEvent): string {
  return [event.type, event.action_id ?? "", event.message ?? ""].map(String).join("\u001f");
}

function compactEventGroups(events: DaemonEvent[], limit: number): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const event of events) {
    const key = eventGroupKey(event);
    const existing = groups.get(key);
    if (existing) {
      existing.lastAt = event.at;
      existing.count += 1;
      continue;
    }
    groups.set(key, {
      key,
      type: event.type,
      firstAt: event.at,
      lastAt: event.at,
      count: 1,
      actionId: event.action_id == null ? undefined : String(event.action_id),
      message: event.message == null ? undefined : String(event.message),
    });
  }
  return [...groups.values()]
    .sort((a, b) => Date.parse(a.lastAt) - Date.parse(b.lastAt))
    .slice(-limit);
}

function eventColor(type: string): Parameters<typeof Text>[0]["color"] {
  if (type === "auth_failed" || type.includes("failed") || type.includes("error")) return "red";
  if (type === "connected" || type === "reconnected" || type === "ready") return "green";
  if (type === "disconnected" || type === "reconnecting") return "yellow";
  if (type.startsWith("action_")) return "cyan";
  return undefined;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(11, 19);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatHealth(health: TuiState["health"] | string): {
  label: string;
  color: Parameters<typeof Text>[0]["color"];
} {
  if (health === "auth failing") return { label: "auth failing", color: "red" };
  if (health === "reconnecting") return { label: "reconnecting", color: "yellow" };
  if (health === "degraded") return { label: "degraded", color: "yellow" };
  return { label: "healthy", color: "green" };
}

function metricColor(value: string): Parameters<typeof Text>[0]["color"] {
  if (value === "on" || value === "healthy") return "green";
  if (value === "off" || value === "auth failing") return "red";
  if (value === "unknown" || value === "degraded" || value === "reconnecting") return "yellow";
  return undefined;
}

function noticeColor(level: Notice["level"]): Parameters<typeof Text>[0]["color"] {
  if (level === "error") return "red";
  if (level === "warning") return "yellow";
  return "cyan";
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: Parameters<typeof Text>[0]["color"];
}) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width="20%">
      <Text dimColor>{label}</Text>
      <Text bold color={color ?? metricColor(String(value))}>
        {value}
      </Text>
    </Box>
  );
}

type NexusTuiAppProps = {
  bus?: EventBus;
  seedEvents?: DaemonEvent[];
  initial?: Partial<TuiState>;
  wallet?: string;
};

function NexusTuiApp({ bus, seedEvents, initial, wallet }: NexusTuiAppProps) {
  const [state, setState] = useState<TuiState>(() => initialState(initial));
  const [filterMode, setFilterMode] = useState(false);
  const [filterDraft, setFilterDraft] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const { exit } = useApp();
  const { stdout } = useStdout();

  useEffect(() => {
    if (!seedEvents?.length) return;
    setState((prev) => ({
      ...projectTuiState(seedEvents, initial),
      selectedIndex: prev.selectedIndex,
      filter: prev.filter,
    }));
  }, [seedEvents, initial]);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setState((prev) => {
        const next = projectTuiState(prev.events, prev);
        return {
          ...next,
          selectedIndex: prev.selectedIndex,
          filter: prev.filter,
          uptimeSecs: prev.events.some((event) => event.type === "connected")
            ? next.uptimeSecs
            : Math.floor((Date.now() - startedAt) / 1000),
        };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!bus) return;
    return bus.subscribe((event) => {
      setState((prev) => {
        const next = projectTuiState([...prev.events, event], prev);
        return {
          ...next,
          selectedIndex: Math.min(prev.selectedIndex, Math.max(0, next.actions.length - 1)),
          filter: prev.filter,
        };
      });
    });
  }, [bus]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const openSelectedSession = async (): Promise<void> => {
    const selected = state.actions[state.selectedIndex];
    if (!wallet || !selected) {
      setNotice({ level: "warning", message: "No wallet or action selected" });
      return;
    }
    const sidecar = await readActionSidecar(wallet, selected.id);
    const path = sidecar?.sessionFile;
    if (!path || !existsSync(path)) {
      setNotice({ level: "warning", message: `No session file for action ${selected.id}` });
      return;
    }
    const pager = process.env.PAGER || "less";
    spawnSync(pager, [path], { stdio: "inherit" });
  };

  useInput((input, key) => {
    if (filterMode) {
      if (key.return) {
        setState((prev) => ({ ...prev, filter: filterDraft, selectedIndex: 0 }));
        setFilterMode(false);
        return;
      }
      if (key.escape) {
        setFilterMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setFilterDraft((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFilterDraft((prev) => prev + input);
      }
      return;
    }

    if (input === "q") {
      exit();
      return;
    }
    if (input === "/") {
      setFilterDraft(state.filter);
      setFilterMode(true);
      return;
    }
    if (input === "s") {
      void openSelectedSession();
      return;
    }
    if (key.upArrow) {
      setState((prev) => ({
        ...prev,
        selectedIndex: Math.max(0, prev.selectedIndex - 1),
      }));
    }
    if (key.downArrow) {
      setState((prev) => ({
        ...prev,
        selectedIndex: Math.min(Math.max(0, prev.actions.length - 1), prev.selectedIndex + 1),
      }));
    }
  });

  const selected = state.actions[state.selectedIndex];
  const filteredEvents = state.filter
    ? state.events.filter((e) => JSON.stringify(e).includes(state.filter))
    : state.events;
  const actionEvents = selected
    ? filteredEvents.filter((e) => String(e.action_id ?? "") === selected.id)
    : filteredEvents;
  const errors = projectDaemonEvents(state.events).recentErrors.length;
  const health = formatHealth(state.health);
  const completedActions = state.actions.filter((a) => a.state === "completed").length;
  const failedActions = state.actions.filter((a) => a.state === "failed").length;
  const terminalHeight = stdout.rows ?? process.stderr.rows ?? 24;
  const rootHeight = Math.max(20, terminalHeight);
  const mainHeight = Math.max(8, rootHeight - (filterMode ? 13 : 12));
  const visibleActionCount = Math.max(1, mainHeight - 4);
  const visibleEventCount = Math.max(1, mainHeight - 4);
  const visibleActionStart = Math.max(
    0,
    Math.min(
      state.selectedIndex - Math.floor(visibleActionCount / 2),
      state.actions.length - visibleActionCount,
    ),
  );
  const visibleActions = state.actions.slice(
    visibleActionStart,
    visibleActionStart + visibleActionCount,
  );
  const eventGroups = compactEventGroups(actionEvents, visibleEventCount);

  return (
    <Box flexDirection="column" paddingX={1} height={rootHeight}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Nexus daemon
        </Text>
        <Text dimColor>
          {state.host ?? "host?"}/{state.module ?? "module?"}
        </Text>
      </Box>

      <Box flexDirection="row">
        <Metric label="health" value={health.label} color={health.color} />
        <Metric label="dispatch" value={state.dispatch} />
        <Metric
          label="actions"
          value={`${completedActions}/${state.actions.length}`}
          color={failedActions > 0 ? "red" : undefined}
        />
        <Metric label="errors 5m" value={errors} color={errors > 0 ? "red" : "green"} />
        <Metric label="uptime" value={`${state.uptimeSecs}s`} color="cyan" />
      </Box>

      <Box borderStyle="single" paddingX={1} justifyContent="space-between">
        <Text>
          wallet <Text bold>{state.wallet ?? "not detected"}</Text>
        </Text>
        <Text>
          identity <Text bold>{state.identity ?? "unknown"}</Text>
        </Text>
        <Text>
          harness <Text bold>{state.harness ?? "unknown"}</Text>
        </Text>
      </Box>

      {filterMode ? (
        <Box paddingX={1}>
          <Text color="yellow">filter: {filterDraft}_</Text>
        </Box>
      ) : null}

      <Box flexDirection="row" height={mainHeight} flexGrow={1}>
        <Box width="38%" flexDirection="column" borderStyle="single" paddingX={1}>
          <Box justifyContent="space-between">
            <Text bold>Action queue</Text>
            <Text dimColor>{state.actions.length} total</Text>
          </Box>
          {state.actions.length === 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>No assigned actions.</Text>
              <Text dimColor>Waiting for Nexus dispatch…</Text>
            </Box>
          ) : (
            visibleActions.map((a, i) => {
              const actionIndex = visibleActionStart + i;
              const selectedAction = actionIndex === state.selectedIndex;
              return (
                <Box key={a.id} justifyContent="space-between">
                  <Text color={selectedAction ? "cyan" : undefined}>
                    {selectedAction ? "›" : " "} #{a.id}
                  </Text>
                  <Text
                    color={
                      a.state === "failed" ? "red" : a.state === "completed" ? "green" : "yellow"
                    }
                  >
                    {a.state}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>
        <Box width="62%" flexDirection="column" borderStyle="single" paddingX={1}>
          <Box justifyContent="space-between">
            <Text bold>Activity</Text>
            <Text dimColor>{selected ? `action #${selected.id}` : "all events"}</Text>
          </Box>
          {eventGroups.length === 0 ? (
            <Box marginTop={1}>
              <Text dimColor>No matching events.</Text>
            </Box>
          ) : (
            eventGroups.map((group) => (
              <Box key={`${group.key}-${group.firstAt}`} justifyContent="space-between">
                <Text color={eventColor(group.type)} wrap="truncate-end">
                  {formatTime(group.lastAt)} {group.type}
                  {group.actionId ? ` #${group.actionId}` : ""}
                  {group.count > 1 ? ` ×${group.count}` : ""}
                </Text>
                <Text dimColor wrap="truncate-end">
                  {group.message ? truncate(group.message, 40) : ""}
                </Text>
              </Box>
            ))
          )}
        </Box>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>s open session · / filter · ↑↓ select · q quit</Text>
        <Text dimColor>repeated events are compacted</Text>
      </Box>
      <Box borderStyle="single" paddingX={1}>
        {notice ? (
          <Text color={noticeColor(notice.level)} wrap="truncate-end">
            {notice.message}
          </Text>
        ) : (
          <Text dimColor>ready</Text>
        )}
      </Box>
    </Box>
  );
}

export function mountNexusTui(
  bus: EventBus,
  options?: { initial?: Partial<TuiState>; wallet?: string },
): NexusTuiHandle | null {
  if (!process.stderr.isTTY) return null;

  const instance = render(
    <NexusTuiApp bus={bus} initial={options?.initial} wallet={options?.wallet} />,
    INK_RENDER_OPTIONS,
  );

  return {
    unmount: () => instance.unmount(),
    waitUntilExit: async () => {
      await instance.waitUntilExit();
    },
  };
}

export async function runReplayTui(replayPath: string): Promise<void> {
  const events = await readJsonlEvents(replayPath);
  if (!process.stderr.isTTY) {
    process.stderr.write(`${renderReplaySnapshot(events)}\n`);
    return;
  }

  const instance = render(<NexusTuiApp seedEvents={events} />, INK_RENDER_OPTIONS);
  await instance.waitUntilExit();
}

export function renderReplaySnapshot(events: DaemonEvent[]): string {
  return renderStatusText(buildStatusFromEvents(events, {}));
}
