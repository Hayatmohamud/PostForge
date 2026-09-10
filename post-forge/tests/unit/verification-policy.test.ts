import { describe, expect, test } from "vitest";

import { routeVerification } from "../../src/agents/verification-policy";

const source = { sourceId: "source-1", url: "https://example.com/report", title: "Report", fetchedEvidence: "Evidence" };
const finding = (verdict: "supported" | "unsupported" | "conflicting", findingId: string) => ({ findingId, claim: "Claim", sourceId: source.sourceId, evidence: source.fetchedEvidence, verdict, rationale: "Reviewed", corroboratingSourceIds: [] });

describe("verification routing policy", () => {
  test("routes supported findings to the writer and excludes rejected findings", () => {
    const result = routeVerification({ sources: [source], findings: [finding("supported", "supported-1"), finding("unsupported", "unsupported-1")] });
    expect(result.status).toBe("writer_ready");
    expect(result.evidence.findings.map(({ findingId }) => findingId)).toEqual(["supported-1"]);
    expect(result.audit.rejectedFindingIds).toEqual(["unsupported-1"]);
    expect(result.audit.rejectedFindings).toHaveLength(1);
  });

  test("terminates with insufficient evidence when no finding is supported", () => {
    const result = routeVerification({ sources: [source], findings: [finding("conflicting", "conflicting-1")] });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.evidence.findings).toEqual([]);
    expect(result.audit.rejectedFindingIds).toEqual(["conflicting-1"]);
  });

  test("does not accept malformed evidence or initiate a research loop", () => {
    const result = routeVerification({ sources: [], findings: [{ verdict: "supported" }] });
    expect(result).toMatchObject({ status: "invalid_input" });
  });
});
