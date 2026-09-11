"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  clearPendingSubmission,
  createSubmissionKey,
  GenerationApiError,
  readPendingSubmission,
  submitGeneration,
  writePendingSubmission,
  type PendingSubmission,
} from "../lib/client/api";
import { Button } from "./ui/button";
import { Status } from "./ui/status";

export const TOPIC_MAX_CHARS = 500;

type TopicFormProps = {
  onSubmit?: (topic: string) => Promise<void>;
};

type FormState = "idle" | "pending" | "success" | "error";

const examples = [
  "How community solar is changing local energy access",
  "The science behind better sleep routines",
  "What small teams should know about AI safety",
];

export function TopicForm({ onSubmit }: TopicFormProps) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pendingSubmission = useRef<PendingSubmission | null>(null);
  const requestInFlight = useRef(false);

  /* eslint-disable react-hooks/set-state-in-effect -- rehydrate browser-only retry state after SSR */
  useEffect(() => {
    const pending = readPendingSubmission();
    if (!pending) return;
    pendingSubmission.current = pending;
    setTopic(pending.topic);
    setState("error");
    setError("Your previous post is ready to retry.");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    const trimmed = topic.trim();

    if (!trimmed) {
      setState("error");
      setError("Enter a topic before generating a post.");
      return;
    }
    if (trimmed.length > TOPIC_MAX_CHARS) {
      setState("error");
      setError(`Keep your topic to ${TOPIC_MAX_CHARS.toLocaleString()} characters or fewer.`);
      return;
    }

    const submission = pendingSubmission.current?.topic === trimmed
      ? pendingSubmission.current
      : { topic: trimmed, submissionKey: createSubmissionKey() };
    pendingSubmission.current = submission;
    writePendingSubmission(submission);
    requestInFlight.current = true;
    setState("pending");
    setError(null);
    try {
      if (onSubmit) {
        await onSubmit(trimmed);
        clearPendingSubmission();
        pendingSubmission.current = null;
        setState("success");
        return;
      }
      const result = await submitGeneration(submission);
      clearPendingSubmission();
      pendingSubmission.current = null;
      setState("success");
      router.push(`/posts/${result.postId}`);
    } catch (caughtError) {
      setState("error");
      setError(caughtError instanceof GenerationApiError
        ? caughtError.message
        : "We could not start this post. Your topic is still here to retry.");
    } finally {
      requestInFlight.current = false;
    }
  }

  const describedBy = error ? "topic-help topic-error" : "topic-help";

  return (
    <form className="topic-form" onSubmit={handleSubmit} noValidate>
      <div className="topic-form-heading">
        <div>
          <p className="eyebrow">New post</p>
          <h1>Turn a topic into a sourced story.</h1>
        </div>
        <p className="topic-form-intro">PostForge researches, verifies, writes, edits, illustrates, and saves the result for you.</p>
      </div>

      <div className="topic-card surface-card">
        <label className="topic-label" htmlFor="topic">What should we explore?</label>
        <textarea
          id="topic"
          name="topic"
          value={topic}
          onChange={(event) => {
            const nextTopic = event.target.value;
            setTopic(nextTopic);
            if (pendingSubmission.current && pendingSubmission.current.topic !== nextTopic.trim()) {
              pendingSubmission.current = null;
              clearPendingSubmission();
            }
            if (state !== "pending") {
              setState("idle");
              setError(null);
            }
          }}
          placeholder="Describe the topic you want to understand..."
          rows={4}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          disabled={state === "pending"}
        />
        <div className="topic-meta" id="topic-help">
          <span>Be specific so the research can find useful evidence.</span>
          <span>{topic.length.toLocaleString()} / {TOPIC_MAX_CHARS.toLocaleString()}</span>
        </div>

        {error ? <p className="topic-error" id="topic-error" role="alert">{error}</p> : null}
        {state === "success" ? <Status tone="success" icon="✓">Topic captured. Your run is ready to start.</Status> : null}

        <div className="topic-actions">
          <Button type="submit" disabled={state === "pending"}>
            {state === "pending" ? "Preparing…" : "Generate post"}
          </Button>
          <span className="topic-action-note">Six stages · sources included</span>
        </div>
      </div>

      <div className="topic-examples" aria-labelledby="topic-examples-heading">
        <p className="topic-examples-heading" id="topic-examples-heading">Try a focused question</p>
        <ul>
          {examples.map((example) => <li key={example}>{example}</li>)}
        </ul>
      </div>

      <style jsx>{`
        .topic-form { width: min(100%, 54rem); margin: 0 auto; }
        .topic-form-heading { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(14rem, 0.85fr); align-items: end; gap: 2rem; margin-bottom: 2.25rem; }
        .topic-form-heading h1 { max-width: 12ch; }
        .topic-form-intro { margin: 0 0 0.35rem; color: var(--color-text-muted); font-size: 1.05rem; }
        .topic-card { padding: clamp(1.25rem, 4vw, 2rem); }
        .topic-label { display: block; margin-bottom: 0.65rem; font-size: 1rem; font-weight: 750; }
        textarea { display: block; width: 100%; min-height: 9.5rem; resize: vertical; padding: 0.9rem 1rem; border: 1px solid var(--color-border-strong, var(--color-border)); border-radius: var(--radius-md, 0.875rem); background: var(--color-surface); color: var(--color-text); font: inherit; font-size: 1rem; line-height: 1.55; }
        textarea::placeholder { color: var(--color-text-muted); }
        textarea:focus { border-color: var(--color-brand); outline: 3px solid rgb(49 88 212 / 0.16); outline-offset: 1px; }
        textarea[aria-invalid="true"] { border-color: var(--color-error); }
        textarea:disabled { cursor: wait; opacity: 0.7; }
        .topic-meta { display: flex; justify-content: space-between; gap: 1rem; margin-top: 0.6rem; color: var(--color-text-muted); font-size: 0.8rem; }
        .topic-error { margin: 0.8rem 0 0; color: var(--color-error); font-size: 0.875rem; font-weight: 650; }
        .topic-actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.35rem; }
        .topic-action-note { color: var(--color-text-muted); font-size: 0.85rem; }
        .topic-examples { margin-top: 1.75rem; }
        .topic-examples-heading { margin: 0 0 0.7rem; color: var(--color-text-muted); font-size: 0.82rem; font-weight: 750; letter-spacing: 0.06em; text-transform: uppercase; }
        .topic-examples ul { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
        .topic-examples li { padding: 0.85rem 0.9rem; border: 1px solid var(--color-border); border-radius: var(--radius-md, 0.875rem); background: rgb(255 255 255 / 0.55); color: var(--color-text-muted); font-size: 0.9rem; line-height: 1.45; }
        @media (max-width: 680px) {
          .topic-form-heading { display: block; }
          .topic-form-intro { max-width: 34rem; margin-top: 1rem; }
          .topic-examples ul { grid-template-columns: 1fr; }
        }
        @media (max-width: 480px) {
          .topic-meta, .topic-actions { align-items: flex-start; flex-direction: column; }
          .topic-actions .button { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          textarea { transition: none; }
        }
      `}</style>
    </form>
  );
}
