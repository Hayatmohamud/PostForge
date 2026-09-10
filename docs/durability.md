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

## Replay and retries

Inngest retries a failed step according to the function retry policy. A retry reloads the
post and its last checkpoint. Completed stage outputs are reused; only the next unfinished
stage is eligible to run. Compare-and-swap revisions reject stale checkpoint writes, and the
stable event identity makes duplicate delivery converge on the same post/run.

The publisher remains idempotent through the existing save/finalize path. A replay of a
completed post returns the existing terminal snapshot without running providers again.

## Failure and crash boundaries

Provider errors are converted by the existing network into the safe public error catalog;
raw provider messages and credentials are not persisted. Terminal failure is checkpointed
with the failed stage and can be read by later progress APIs. A crash before a checkpoint
write can repeat the current external provider call; the next durable boundary is the
checkpoint write, so external calls are not claimed to be transactional. The later recovery
task owns bounded retry/backoff and terminal failure reconciliation.

The production HTTP registration and local Inngest runner endpoint are intentionally deferred
to TASK-030.
