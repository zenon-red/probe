export type AcpMcpServerConfig = {
  enabled?: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type AcpConfig = {
  /** When false, do not attach per-session MCP servers to ACP sessions. */
  attachPerSessionMcp?: boolean;
  mcp?: {
    nexus?: AcpMcpServerConfig;
    seti?: AcpMcpServerConfig;
    voize?: AcpMcpServerConfig;
  };
  hermes?: {
    browserTools?: boolean;
  };
};

export const DEFAULT_ACP_MCP: NonNullable<AcpConfig["mcp"]> = {
  nexus: { enabled: true, command: "probe", args: ["mcp", "serve"] },
  seti: { enabled: true, command: "seti" },
  voize: { enabled: true, command: "voize" },
};
