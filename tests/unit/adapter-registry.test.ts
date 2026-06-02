import { describe, expect, it } from "bun:test";
import {
  lookupRegistryAgent,
  metadataFromAgent,
  remediationFromNpx,
  resolveAdapterLaunch,
  type RegistryDocument,
} from "../../src/acp/agents/adapter-registry.js";

const fallbackDoc: RegistryDocument = {
  version: "fallback",
  agents: [
    {
      id: "claude-acp",
      name: "Claude",
      version: "0.39.0",
      distribution: { npx: { package: "@agentclientprotocol/claude-agent-acp@0.39.0" } },
    },
  ],
};

function fetchJson(value: unknown): typeof fetch {
  return (async () =>
    ({
      ok: true,
      json: async () => value,
    }) as Response) as unknown as typeof fetch;
}

function fetchError(error: Error): typeof fetch {
  return (async () => {
    throw error;
  }) as unknown as typeof fetch;
}

describe("adapter-registry", () => {
  it("uses pinned fallback metadata when registry agent is present", () => {
    const agent = lookupRegistryAgent(fallbackDoc, "claude-acp");
    expect(agent?.version).toBe("0.39.0");
    const meta = metadataFromAgent(agent!, "fallback");
    expect(meta.remediation).toBe(remediationFromNpx(meta.npx!));
  });

  it("ignores stale cached launch commands", async () => {
    const doc: RegistryDocument = {
      version: "1",
      agents: [
        {
          id: "pi-acp",
          name: "Pi",
          version: "1.0.0",
          distribution: { npx: { package: "pi-acp@1.0.0" } },
        },
      ],
    };

    const launch = await resolveAdapterLaunch("pi", {
      fetchFn: fetchJson(doc),
      readCacheFn: async () => ({
        version: 1,
        entries: {
          pi: {
            registryId: "pi-acp",
            version: "1.0.0",
            command: "/definitely/missing/pi-acp",
            args: [],
            source: "path",
          },
        },
      }),
      writeCacheFn: async () => {},
    });

    expect(launch.source).toBe("npx");
    expect(launch.command).toBe("npx");
  });
});

describe("adapter-registry fetch", () => {
  it("uses registry document when fetch succeeds", async () => {
    const { fetchRegistryDocument } = await import("../../src/acp/agents/adapter-registry.js");
    const doc = {
      version: "1",
      agents: [
        {
          id: "claude-acp",
          name: "Claude",
          version: "1.0.0",
          distribution: { npx: { package: "@agentclientprotocol/claude-agent-acp@1.0.0" } },
        },
      ],
    };
    const result = await fetchRegistryDocument({
      fetchFn: fetchJson(doc),
    });
    expect(result.source).toBe("registry");
    expect(result.doc.agents[0]?.version).toBe("1.0.0");
  });

  it("falls back when fetch fails", async () => {
    const { fetchRegistryDocument, lookupRegistryAgent } =
      await import("../../src/acp/agents/adapter-registry.js");
    const result = await fetchRegistryDocument({
      fetchFn: fetchError(new Error("offline")),
      readCacheFn: async () => null,
    });
    expect(result.source).toBe("fallback");
    const agent = lookupRegistryAgent(result.doc, "claude-acp");
    expect(agent?.id).toBe("claude-acp");
  });
});
