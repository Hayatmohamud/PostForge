"use client";

import { useId, useState } from "react";
import type { StageName, StageState } from "../lib/contracts/post";

const stageLabels: Record<StageName, string> = {
  research: "Research",
  verify: "Verify",
  write: "Write",
  edit: "Edit",
  illustrate: "Illustrate",
  publish: "Publish",
};

const statusLabels: Record<StageState["status"], string> = {
  queued: "Queued",
  active: "Active",
  retrying: "Retrying",
  done: "Done",
  failed: "Failed",
};

const statusIcons: Record<StageState["status"], string> = {
  queued: "○",
  active: "◐",
  retrying: "↻",
  done: "✓",
  failed: "!",
};

export function formatStageDuration(state: StageState, now = Date.now()): string | null {
  if (!state.startedAt) return null;
  const started = Date.parse(state.startedAt);
  const finished = state.endedAt ? Date.parse(state.endedAt) : now;
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  const seconds = Math.max(0, Math.round((finished - started) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatTimestamp(value?: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export type StageDetailsProps = {
  stage: StageName;
  state: StageState;
  evidence?: readonly string[];
  initiallyExpanded?: boolean;
};

export function StageDetails({ stage, state, evidence = [], initiallyExpanded = false }: StageDetailsProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const panelId = useId();
  const duration = formatStageDuration(state);
  const started = formatTimestamp(state.startedAt);
  const ended = formatTimestamp(state.endedAt);

  return (
    <li className={`stage-item stage-${state.status}`}>
      <button
        className="stage-summary"
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="stage-icon" aria-hidden="true">{statusIcons[state.status]}</span>
        <span className="stage-heading">
          <span className="stage-name">{stageLabels[stage]}</span>
          <span className="stage-status">{statusLabels[state.status]}</span>
        </span>
        <span className="stage-duration">{duration ?? "—"}</span>
        <span className="stage-chevron" aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>

      <div className="stage-panel" id={panelId} hidden={!expanded}>
        {state.activity ? <p className="stage-activity">{state.activity}</p> : <p className="stage-activity stage-muted">No activity summary yet.</p>}
        <dl className="stage-times">
          {started ? <div><dt>Started</dt><dd><time dateTime={state.startedAt}>{started}</time></dd></div> : null}
          {ended ? <div><dt>Ended</dt><dd><time dateTime={state.endedAt}>{ended}</time></dd></div> : null}
          <div><dt>Attempts</dt><dd>{state.attempts}</dd></div>
        </dl>
        {evidence.length ? (
          <div className="stage-evidence">
            <h3>Evidence activity</h3>
            <ul>{evidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </li>
  );
}
