import { describe, expect, it } from "bun:test";
import { resolveUnattendedPermission } from "../../src/acp/permissions.js";

describe("resolveUnattendedPermission", () => {
  it("auto-allows when allow option exists", () => {
    const result = resolveUnattendedPermission({
      options: [{ optionId: "a", kind: "allow_once", name: "Allow", title: "Allow" }],
    } as never);
    expect(result.outcome).toEqual({ outcome: "selected", optionId: "a" });
  });

  it("cancels for unrecognized option kinds", () => {
    const result = resolveUnattendedPermission({
      options: [{ optionId: "x", kind: "escalate", name: "Escalate", title: "Escalate" }],
    } as never);
    expect(result.outcome).toEqual({ outcome: "cancelled" });
  });
});
