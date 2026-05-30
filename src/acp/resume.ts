import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import type { StoredAcpSession } from "./session-store.js";

export async function resumeOrCreateSession(options: {
  connection: ClientSideConnection;
  cwd: string;
  mcpServers: Parameters<ClientSideConnection["newSession"]>[0]["mcpServers"];
  stored?: StoredAcpSession;
}): Promise<{ sessionId: string; resumed: boolean }> {
  if (options.stored?.sessionId) {
    try {
      await options.connection.resumeSession({
        sessionId: options.stored.sessionId,
        cwd: options.cwd,
        mcpServers: options.mcpServers,
      });
      return {
        sessionId: options.stored.sessionId,
        resumed: true,
      };
    } catch {
      // fall through to new session
    }
  }

  const created = await options.connection.newSession({
    cwd: options.cwd,
    mcpServers: options.mcpServers,
  });
  return {
    sessionId: created.sessionId,
    resumed: false,
  };
}
