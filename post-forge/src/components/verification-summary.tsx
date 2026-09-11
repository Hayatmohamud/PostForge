import type { EvidenceBundle, Finding, Verdict } from "../lib/contracts/evidence";
import { getSafeSourceUrl } from "./source-list";

const verdictLabels: Record<Verdict, string> = {
  supported: "Supported findings",
  unsupported: "Unsupported findings",
  conflicting: "Conflicting findings",
};

const verdictDescriptions: Record<Verdict, string> = {
  supported: "Evidence that met the verification threshold for consideration in the article.",
  unsupported: "These findings did not have enough support and are not article citations.",
  conflicting: "These findings had material disagreement and are not article citations.",
};

export type VerificationSummaryProps = {
  evidence: EvidenceBundle;
};

function sourceLabel(finding: Finding, evidence: EvidenceBundle) {
  const source = evidence.sources.find((candidate) => candidate.sourceId === finding.sourceId);
  if (!source) return <span className="finding-source-unavailable">Source reference unavailable</span>;

  const safeUrl = getSafeSourceUrl(source.url);
  if (!safeUrl) return <span className="finding-source-unavailable">{source.title} · link unavailable</span>;

  return (
    <a className="finding-source" href={safeUrl} target="_blank" rel="noreferrer noopener">
      <span>{source.title}</span>
      <span className="finding-source-domain">{new URL(safeUrl).hostname}</span>
    </a>
  );
}

function FindingGroup({ verdict, findings, evidence }: { verdict: Verdict; findings: readonly Finding[]; evidence: EvidenceBundle }) {
  if (!findings.length) return null;

  return (
    <section className={`finding-group finding-${verdict}`} aria-labelledby={`findings-${verdict}`}>
      <div className="finding-group-heading">
        <h3 id={`findings-${verdict}`}>{verdictLabels[verdict]}</h3>
        <span className="finding-count">{findings.length}</span>
      </div>
      <p className="finding-group-description">{verdictDescriptions[verdict]}</p>
      <ol className="finding-list">
        {findings.map((finding) => (
          <li className="finding-item" key={finding.findingId}>
            <h4>{finding.claim}</h4>
            <p><strong>Rationale:</strong> {finding.rationale}</p>
            <p><strong>Evidence:</strong> {finding.evidence}</p>
            <p className="finding-source-row"><strong>Primary source:</strong> {sourceLabel(finding, evidence)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function VerificationSummary({ evidence }: VerificationSummaryProps) {
  const findingsByVerdict: Record<Verdict, Finding[]> = {
    supported: evidence.findings.filter((finding) => finding.verdict === "supported"),
    unsupported: evidence.findings.filter((finding) => finding.verdict === "unsupported"),
    conflicting: evidence.findings.filter((finding) => finding.verdict === "conflicting"),
  };

  return (
    <section className="verification-summary" aria-labelledby="verification-heading">
      <div className="verification-header">
        <div>
          <p className="eyebrow">Evidence assessment</p>
          <h2 id="verification-heading">Verification summary</h2>
        </div>
        <p className="verification-disclaimer">This assessment describes what was checked; it is not a guarantee of factual certainty.</p>
      </div>
      <div className="finding-groups">
        <FindingGroup verdict="supported" findings={findingsByVerdict.supported} evidence={evidence} />
        <FindingGroup verdict="unsupported" findings={findingsByVerdict.unsupported} evidence={evidence} />
        <FindingGroup verdict="conflicting" findings={findingsByVerdict.conflicting} evidence={evidence} />
      </div>
      {!evidence.findings.length ? <p className="verification-empty">No verification findings were recorded.</p> : null}

      <style>{`
        .verification-summary { width: min(100%, 58rem); margin: 2.5rem auto 0; min-width: 0; }
        .verification-header { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 1rem; }
        .verification-header .eyebrow { margin-bottom: 0.55rem; }
        .verification-disclaimer { max-width: 25rem; margin: 0 0 0.2rem; color: var(--color-text-muted); font-size: 0.9rem; }
        .finding-groups { display: grid; gap: 1rem; }
        .finding-group { padding: 1.1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md, 0.875rem); background: var(--color-surface); }
        .finding-unsupported, .finding-conflicting { border-color: #ead9bd; background: #fffaf1; }
        .finding-group-heading { display: flex; align-items: center; gap: 0.65rem; }
        .finding-group h3 { font-size: 1.05rem; letter-spacing: -0.015em; }
        .finding-count { display: inline-grid; min-width: 1.5rem; height: 1.5rem; padding: 0 0.3rem; place-items: center; border-radius: 999px; background: var(--color-surface-muted); color: var(--color-text-muted); font-size: 0.75rem; font-weight: 750; }
        .finding-group-description { margin: 0.55rem 0 0; color: var(--color-text-muted); font-size: 0.9rem; }
        .finding-list { display: grid; gap: 0.75rem; margin: 1rem 0 0; padding: 0; list-style: none; }
        .finding-item { padding-top: 0.85rem; border-top: 1px solid var(--color-border); }
        .finding-item h4 { margin: 0; font-size: 1rem; line-height: 1.35; overflow-wrap: anywhere; }
        .finding-item p { margin: 0.5rem 0 0; color: var(--color-text-muted); font-size: 0.9rem; line-height: 1.5; overflow-wrap: anywhere; }
        .finding-item strong { color: var(--color-text); }
        .finding-source-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem; }
        .finding-source { display: inline-flex; flex-wrap: wrap; gap: 0.35rem 0.55rem; color: var(--color-brand-dark); font-weight: 700; }
        .finding-source-domain { color: var(--color-text-muted); font-size: 0.85em; font-weight: 500; }
        .finding-source-unavailable { color: var(--color-text-muted); }
        .verification-empty { margin: 0; color: var(--color-text-muted); }
        @media (max-width: 600px) {
          .verification-header { display: block; }
          .verification-disclaimer { margin-top: 0.7rem; }
        }
      `}</style>
    </section>
  );
}
