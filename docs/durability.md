# Durable generation workflow

TASK-028 registers the generation workflow around the existing `post/generate.requested`
event, AgentKit network, and persisted checkpoint APIs. It does not create a second stage
orchestration layer.

## Durable boundaries

The workflow has three Inngest steps:

1. `load-saved-post` validates the event identity against the persisted post.
2. `mark-dispatch-started` records the stable event identity as the run identity.
3. `run-agent-network` executes the existing six-stage network with a checkpoint store
   backed by the post repository.

Each step returns bounded JSON-safe data. The network itself remains the owner of stage
ordering, validation, budgets, provider calls, and terminal-state rules. It is deliberately
not nested inside additional Inngest steps: its persisted checkpoints are the replay boundary
for stage outputs.

## Replay, retries, and duplicate delivery

Inngest retries a failed step according to the function's bounded retry policy. A retry reloads
the post and its last checkpoint. Completed stage outputs are reused; only the next unfinished
stage is eligible to run. Transient workflow failures are allowed to exhaust that finite policy;
the failure handler then retries only the database reconciliation boundary with bounded delays.
Provider calls are not repeated by the failure handler.

The event identity is used for idempotency and the post identity is a singleton key, so duplicate
deliveries cannot compete for the same run. Compare-and-swap revisions reject stale checkpoint
writes. A replay of an already terminal post is read-only.

The publisher remains idempotent through the existing save/finalize path. A replay of a
completed post returns the existing terminal snapshot without running providers again.

## Failure and crash boundaries

Provider errors are converted by the existing network into the safe public error catalog;
raw provider messages and credentials are not persisted. Exhausted failure is reconciled through
the current active/retrying stage and can be read by later progress APIs. Persistence itself is
retried a bounded number of times; a database outage therefore returns a safe retry-exhausted
result rather than looping indefinitely. A crash before a checkpoint write can repeat the current
external provider call; the next durable boundary is the checkpoint write, so external calls are
not claimed to be transactional. A late failure is ignored after the post is done.

The production HTTP registration and local Inngest runner endpoint are intentionally deferred
to TASK-030.
