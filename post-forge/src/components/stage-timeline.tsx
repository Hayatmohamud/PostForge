"use client";

import type { StageName, StageState } from "../lib/contracts/post";
import { StageDetails } from "./stage-details";

const stages: readonly StageName[] = ["research", "verify", "write", "edit", "illustrate", "publish"];

export type StageTimelineProps = {
  stages: Readonly<Record<StageName, StageState>>;
  evidenceByStage?: Partial<Record<StageName, readonly string[]>>;
};

export function StageTimeline({ stages: stageStates, evidenceByStage = {} }: StageTimelineProps) {
  return (
    <section className="stage-timeline" aria-labelledby="pipeline-heading">
      <div className="stage-timeline-header">
        <div>
          <p className="eyebrow">Live pipeline</p>
          <h2 id="pipeline-heading">Generation progress</h2>
        </div>
        <p className="stage-timeline-intro">Six stages, shown from the persisted run state.</p>
      </div>

      <ol className="stage-list" aria-label="Post generation stages">
        {stages.map((stage) => (
          <StageDetails key={stage} stage={stage} state={stageStates[stage]} evidence={evidenceByStage[stage]} />
        ))}
      </ol>

      <style>{`
        .stage-timeline { width: min(100%, 58rem); margin: 0 auto; }
        .stage-timeline-header { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 1.5rem; }
        .stage-timeline-header h2 { margin-top: 0.25rem; }
        .stage-timeline-intro { max-width: 18rem; margin: 0 0 0.2rem; color: var(--color-text-muted); font-size: 0.95rem; }
        .stage-list { display: grid; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
        .stage-item { overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--radius-md, 0.875rem); background: var(--color-surface); box-shadow: 0 0.75rem 2rem rgb(23 32 51 / 0.045); }
        .stage-summary { display: grid; width: 100%; grid-template-columns: 2.25rem minmax(0, 1fr) auto 1.5rem; align-items: center; gap: 0.75rem; padding: 1rem 1.1rem; border: 0; background: transparent; color: var(--color-text); font: inherit; text-align: left; cursor: pointer; }
        .stage-summary:hover { background: var(--color-surface-muted); }
        .stage-icon { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: 50%; background: var(--color-surface-muted); color: var(--color-text-muted); font-weight: 800; }
        .stage-active .stage-icon { background: #e8f2fc; color: var(--color-info); }
        .stage-retrying .stage-icon { background: #fff3df; color: var(--color-warning); }
        .stage-done .stage-icon { background: #e6f5ee; color: var(--color-success); }
        .stage-failed .stage-icon { background: #fdebe9; color: var(--color-error); }
        .stage-heading { display: grid; gap: 0.2rem; min-width: 0; }
        .stage-name { font-weight: 750; }
        .stage-status { color: var(--color-text-muted); font-size: 0.8rem; }
        .stage-duration { color: var(--color-text-muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; }
        .stage-chevron { color: var(--color-brand-dark); font-size: 1.2rem; font-weight: 500; text-align: center; }
        .stage-panel { padding: 0 1.1rem 1.1rem 4.1rem; }
        .stage-activity { margin: 0; color: var(--color-text); line-height: 1.55; }
        .stage-muted { color: var(--color-text-muted); }
        .stage-times { display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; margin: 1rem 0 0; color: var(--color-text-muted); font-size: 0.8rem; }
        .stage-times div { display: flex; gap: 0.35rem; }
        .stage-times dt { font-weight: 700; }
        .stage-times dd { margin: 0; }
        .stage-evidence { margin-top: 1rem; padding-top: 0.85rem; border-top: 1px solid var(--color-border); }
        .stage-evidence h3 { margin: 0 0 0.45rem; font-size: 0.85rem; letter-spacing: 0; }
        .stage-evidence ul { display: grid; gap: 0.35rem; margin: 0; padding-left: 1.1rem; color: var(--color-text-muted); font-size: 0.85rem; }
        @media (max-width: 600px) {
          .stage-timeline-header { display: block; }
          .stage-timeline-intro { margin-top: 0.75rem; }
          .stage-summary { grid-template-columns: 2.25rem minmax(0, 1fr) 1.5rem; }
          .stage-duration { display: none; }
          .stage-panel { padding-left: 1.1rem; }
        }
        @media (prefers-reduced-motion: reduce) {
          .stage-summary { transition: none; }
        }
      `}</style>
    </section>
  );
}
