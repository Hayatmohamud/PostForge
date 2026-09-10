import { z } from "zod";
import { evidenceBundleSchema, type EvidenceBundle, type Finding } from "../lib/contracts/evidence";

const verificationResultSchema = z.object({
  status: z.enum(["writer_ready", "insufficient_evidence", "invalid_input"]),
  evidence: evidenceBundleSchema,
  audit: z.object({
    supportedFindingIds: z.array(z.string()),
    rejectedFindingIds: z.array(z.string()),
    rejectedFindings: z.array(z.unknown()),
  }).strict(),
  reason: z.string().optional(),
}).strict();

export type VerificationPolicyResult = z.infer<typeof verificationResultSchema>;

function audit(findings: Finding[]) {
  const supported = findings.filter((finding) => finding.verdict === "supported");
  const rejected = findings.filter((finding) => finding.verdict !== "supported");
  return {
    supportedFindingIds: supported.map((finding) => finding.findingId),
    rejectedFindingIds: rejected.map((finding) => finding.findingId),
    rejectedFindings: rejected,
  };
}

/** Route verified evidence once; rejected findings remain available for audit but never reach the writer. */
export function routeVerification(value: unknown): VerificationPolicyResult {
  const parsed = evidenceBundleSchema.safeParse(value);
  if (!parsed.success) {
    return verificationResultSchema.parse({
      status: "invalid_input",
      evidence: { findings: [], sources: [] },
      audit: { supportedFindingIds: [], rejectedFindingIds: [], rejectedFindings: [] },
      reason: "Evidence bundle failed validation.",
    });
  }
  const evidence: EvidenceBundle = {
    sources: parsed.data.sources,
    findings: parsed.data.findings.filter((finding) => finding.verdict === "supported"),
  };
  const summary = audit(parsed.data.findings);
  if (!evidence.findings.length) {
    return { status: "insufficient_evidence", evidence, audit: summary, reason: "No supported evidence is available for writing." };
  }
  return { status: "writer_ready", evidence, audit: summary };
}

export const applyVerificationPolicy = routeVerification;
export const verificationPolicy = routeVerification;
export const verificationInput = evidenceBundleSchema;
