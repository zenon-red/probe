import { describe, expect, it } from "bun:test";
import { mapStopReasonToOutcome } from "../../src/acp/outcome.js";

describe("mapStopReasonToOutcome", () => {
  it("maps spawn and timeout flags", () => {
    expect(mapStopReasonToOutcome(undefined, true, false)).toBe("SpawnFailed");
    expect(mapStopReasonToOutcome(undefined, false, true)).toBe("Timeout");
  });

  it("maps stop reasons", () => {
    expect(mapStopReasonToOutcome("end_turn", false, false)).toBe("Clean");
    expect(mapStopReasonToOutcome("cancelled", false, false)).toBe("Timeout");
    expect(mapStopReasonToOutcome("refusal", false, false)).toBe("Signal");
  });
});
