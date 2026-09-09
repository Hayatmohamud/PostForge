import { z } from "zod";

/** Bounds shared by research, verification, writer, and API consumers. */
export const EVIDENCE_LIMITS = Object.freeze({
  maxFindings: 100,
  maxSources: 100,
  maxClaimChars: 2_000,
  maxTitleChars: 500,
  maxEvidenceChars: 20_000,
  maxRationaleChars: 4_000,
  maxUrlChars: 2_048,
});

const safeToken = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const sourceToken = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** IDs generated for persisted records (Mongo ObjectId or UUID). */
export const generatedIdSchema = z.string().refine(
  (value) => /^[a-f\d]{24}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  "Expected a Mongo ObjectId or UUID",
);

/** Stable IDs for findings and source references. */
export const referenceIdSchema = z.string().regex(sourceToken, "Expected a stable reference ID");
export const submissionKeySchema = z.string().regex(safeToken, "Expected a safe submission key");

const publicUrlSchema = z.string().max(EVIDENCE_LIMITS.maxUrlChars).url().refine((value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password || !url.hostname) return false;
    const hostname = url.hostname.toLowerCase();
    // Source URLs are fetched by a server. Reject local targets and other
    // non-public host forms before they reach a fetch tool.
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname)) return false;
    if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}, "Expected a public HTTP(S) URL");

export const sourceSchema = z.object({
  sourceId: referenceIdSchema,
  url: publicUrlSchema,
  title: z.string().trim().min(1).max(EVIDENCE_LIMITS.maxTitleChars),
  fetchedEvidence: z.string().trim().min(1).max(EVIDENCE_LIMITS.maxEvidenceChars),
  fetchedAt: z.string().datetime({ offset: true }).max(64).optional(),
}).strict();

export const sourceReferenceSchema = sourceSchema.pick({ sourceId: true, url: true, title: true });

export const verdictSchema = z.enum(["supported", "unsupported", "conflicting"]);
export type Verdict = z.infer<typeof verdictSchema>;

export const findingSchema = z.object({
  findingId: referenceIdSchema,
  claim: z.string().trim().min(1).max(EVIDENCE_LIMITS.maxClaimChars),
  sourceId: referenceIdSchema,
  evidence: z.string().trim().min(1).max(EVIDENCE_LIMITS.maxEvidenceChars),
  verdict: verdictSchema,
  rationale: z.string().trim().min(1).max(EVIDENCE_LIMITS.maxRationaleChars),
  corroboratingSourceIds: z.array(referenceIdSchema).max(EVIDENCE_LIMITS.maxSources).default([]),
}).strict().superRefine((finding, context) => {
  if (finding.corroboratingSourceIds.includes(finding.sourceId)) {
    context.addIssue({ code: "custom", path: ["corroboratingSourceIds"], message: "A finding cannot corroborate itself" });
  }
});

export const evidenceBundleSchema = z.object({
  findings: z.array(findingSchema).min(0).max(EVIDENCE_LIMITS.maxFindings),
  sources: z.array(sourceSchema).min(0).max(EVIDENCE_LIMITS.maxSources),
}).strict().superRefine((bundle, context) => {
  const sourceIds = new Set(bundle.sources.map((source) => source.sourceId));
  const findingIds = new Set<string>();
  for (const [index, finding] of bundle.findings.entries()) {
    if (findingIds.has(finding.findingId)) {
      context.addIssue({ code: "custom", path: ["findings", index, "findingId"], message: "Finding IDs must be unique" });
    }
    findingIds.add(finding.findingId);
    if (!sourceIds.has(finding.sourceId)) {
      context.addIssue({ code: "custom", path: ["findings", index, "sourceId"], message: "Finding references an unknown source" });
    }
    for (const sourceId of finding.corroboratingSourceIds) {
      if (!sourceIds.has(sourceId)) {
        context.addIssue({ code: "custom", path: ["findings", index, "corroboratingSourceIds"], message: "Finding references an unknown corroborating source" });
      }
    }
  }
  const seenSources = new Set<string>();
  for (const [index, source] of bundle.sources.entries()) {
    if (seenSources.has(source.sourceId)) {
      context.addIssue({ code: "custom", path: ["sources", index, "sourceId"], message: "Source IDs must be unique" });
    }
    seenSources.add(source.sourceId);
  }
});

export type Source = z.infer<typeof sourceSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
