import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { verify } from "../../src/agents/verify";

describe("verify agent", () => {
  test("rejects claims that do not reference a retrieved source", async () => {
    await expect(verify({ sources: [], findings: [{ findingId: "finding1", claim: "Claim", sourceId: "source1", evidence: "Evidence", corroboratingSourceIds: [] }] })).resolves.toMatchObject({ status: "invalid_output" });
  });

  test("does not treat empty input as supported evidence", async () => {
    await expect(verify({ sources: [], findings: [] })).resolves.toMatchObject({ status: "insufficient_evidence", evidence: { sources: [], findings: [] } });
  });
});
