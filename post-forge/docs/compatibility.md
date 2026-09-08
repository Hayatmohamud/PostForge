# PostForge integration compatibility baseline

Task: **P1-01 / TASK-001 — Validate integration assumptions**
Owner: Architecture Reviewer; independent tester and Code Review remain pending.
Observed: **2026-09-07**; catalog, selected release metadata, and cited AgentKit source rechecked **2026-09-08**, using public provider catalogs, official documentation, npm metadata, and released upstream source.
Base: `origin/main` at `859e6c134c80093aab0a49915c9ad65324f83f38`.
Branch: `task/001-validate-integrations`.
Worktree: `.worktrees/task-001-validate-integrations` in the primary repository.

This documentation-only investigation establishes a baseline for review. No application was scaffolded, no dependencies were installed, and no credentials or live inference were used. `PLAN.md` remains authoritative; this report resolves its explicitly delegated compatibility questions without changing MVP scope.

## Decision and evidence status

**No blocking catalog or declared peer-version conflict was found for the selected baseline.** The requested text model exists. This is a documentation/source compatibility result, not proof that the unimplemented application builds or that live providers work together. Package installation, compilation, durable replay, database behavior, and account-specific access remain assigned to subsequent tasks.

| Requirement | Observation / decision | Status |
| --- | --- | --- |
| GLM-5.3-Flash through OpenRouter | Exact catalog ID: `z-ai/glm-5.3-flash` | Verified public catalog |
| Tools and structured output | Model advertises `tools`, `tool_choice`, `response_format`, `structured_outputs`; provider support varies | Verified public metadata; live calls deferred |
| Configurable text model | Shared factory takes `OPENROUTER_MODEL`; no model literal in individual agents | Required implementation contract |
| AgentKit custom endpoint | `openai` adapter exposes `apiKey`, `baseUrl`, and model string | Documented support |
| Durable network integration | Released source uses Inngest inference steps when execution context exists; custom tools need explicit steps | Verified source; runtime replay deferred |
| Initial image model | `IMAGE_PROVIDER=gemini`, `IMAGE_MODEL=gemini-2.5-flash-image` | Official stable model documented; account access deferred |
| Runtime/packages | Exact candidate pins below satisfy inspected relevant engine/peer ranges | Metadata check passed; install/build deferred |

## Text model and configuration contract

An unauthenticated GET of [OpenRouter's model catalog](https://openrouter.ai/api/v1/models) returned 428 models on the resumption check (430 in the original observation). Exactly one standard model matched `z-ai/glm-5.3-flash`; batch and moving aliases are separate records. Its advertised parameters were:

`frequency_penalty`, `include_reasoning`, `logit_bias`, `logprobs`, `max_tokens`, `min_p`, `presence_penalty`, `reasoning`, `reasoning_effort`, `repetition_penalty`, `response_format`, `seed`, `stop`, `structured_outputs`, `temperature`, `tool_choice`, `tools`, `top_k`, `top_logprobs`, `top_p`.

The [model page](https://openrouter.ai/z-ai/glm-5.3-flash) independently identifies the requested model. The [provider endpoint catalog](https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints) lists multiple providers. For example, DeepInfra and Wafer each advertise all four required parameters above; some other providers advertise `response_format` without `structured_outputs`. Catalog presence establishes advertised availability, not account quota, latency, uptime, or successful inference.

For P2-01, the development example must set **`OPENROUTER_MODEL=z-ai/glm-5.3-flash`**. Empty or missing configuration must fail server validation. P3-03 creates one server-side factory using the saved run model, the explicitly supplied `OPENROUTER_API_KEY`, and `baseUrl=https://openrouter.ai/api/v1`. Individual agents consume that factory/network default. OpenRouter documents this API base in its [quickstart](https://openrouter.ai/docs/quickstart); AgentKit documents its differently cased `baseUrl` option in the [OpenAI-compatible model reference](https://agentkit.inngest.com/reference/model-openai).

Do not use the moving `~z-ai/glm-flash-latest` alias or the batch variant as the default. New submissions snapshot the configured model; existing runs resume with their saved value. A later compatible model switch changes environment configuration and restarts the server, without edits to agent definitions. Snapshot provider and generation parameters needed for replay as required by `PLAN.md`.

OpenRouter's [structured-output guide](https://openrouter.ai/docs/guides/features/structured-outputs) documents JSON Schema response formatting. Its [provider routing guide](https://openrouter.ai/docs/guides/routing/provider-selection) documents `provider.require_parameters` for routing only to providers supporting supplied parameters. P3-03 must confirm serialization of these request options through the pinned adapter; P12-04 must verify actual responses. Strict output validation and finite correction budgets remain required even when metadata advertises structured output. No alternate text model is selected in this report.

## Selected runtime and package baseline

These are exact **review candidates for later installation**, not files or dependencies added by this task. Registry links address the selected release, rather than a mutable `latest` tag. Engines/peers below are the relevant declared constraints; metadata agreement is necessary but does not establish full transitive or behavioral compatibility.

| Component | Selected version | Relevant evidence / constraint |
| --- | --- | --- |
| Node.js | **24.20.0 LTS (Krypton)** | [Official release index](https://nodejs.org/dist/index.json): released 2026-08-26; [v24 distribution](https://nodejs.org/download/release/latest-v24.x/) |
| npm | **11.19.0** | Bundled with Node 24.20.0 in the official release index; use a committed lockfile in later tasks |
| Next.js | **16.3.4** | [Metadata](https://registry.npmjs.org/next/16.3.4): Node `>=20.9.0`; React/React DOM accept `^19.0.0` |
| React / React DOM | **19.2.8 / 19.2.8** | [React](https://registry.npmjs.org/react/19.2.8), [React DOM](https://registry.npmjs.org/react-dom/19.2.8): React DOM requires React `^19.2.8` |
| TypeScript | **5.9.3** | [Metadata](https://registry.npmjs.org/typescript/5.9.3): Node `>=14.17`; conservative compiler baseline despite newer major releases |
| AgentKit | **0.13.2** | [Metadata](https://registry.npmjs.org/%40inngest%2Fagent-kit/0.13.2): peers Inngest `>=3.43.1`, Zod `>=4 <5`; depends on `@inngest/ai` **0.1.6** |
| Inngest | **3.54.2** | [Metadata](https://registry.npmjs.org/inngest/3.54.2): Node `>=20`; relevant peers Next `>=12.0.0`, TypeScript `>=5.8.0`, Zod `^3.25.0` or `^4.0.0` |
| Zod | **4.5.4** | [Metadata](https://registry.npmjs.org/zod/4.5.4); satisfies both AgentKit and Inngest peer ranges |
| MongoDB Node driver | **7.6.0** | [Metadata](https://registry.npmjs.org/mongodb/7.6.0): Node `>=20.19.0`; includes GridFS, no separate GridFS package |
| Google Gen AI SDK | **2.21.0** | [Metadata](https://registry.npmjs.org/%40google%2Fgenai/2.21.0): Node `>=20.0.0`; use only the Gemini image adapter surface |
| ESLint / Next ESLint config | **9.39.4 / 16.3.4** | [ESLint](https://registry.npmjs.org/eslint/9.39.4), [Next config](https://registry.npmjs.org/eslint-config-next/16.3.4): config accepts ESLint `>=9.0.0` and TypeScript `>=3.3.1` |
| Node types | **24.10.1** | [Metadata](https://registry.npmjs.org/%40types%2Fnode/24.10.1): match Node major 24 |
| React / React DOM types | **19.2.18 / 19.2.7** | [React types](https://registry.npmjs.org/%40types%2Freact/19.2.18), [DOM types](https://registry.npmjs.org/%40types%2Freact-dom/19.2.7): DOM types require React types `^19.2.0` |

Node 24.20.0 satisfies the inspected package engines. Local baseline observations supplied by the Planner were Node **24.19.0**, npm **12.0.2**, Git **2.55.0.windows.3**, and GitHub CLI **2.98.0**. Local Node satisfies those engine ranges but differs from the selected pin. P1-02 must reconcile the runtime/package-manager pins before generating the lockfile; this task changes no installed tools. On Windows PowerShell, `npm.cmd` avoids the local script execution-policy issue.

**Inngest version choice:** public npm `latest` was 4.20.0, while the latest stable v3 record was 3.54.2. Select v3 for this baseline because official AgentKit examples use the v3 three-argument function registration pattern. The [v3-to-v4 migration guide](https://www.inngest.com/docs/reference/typescript/v4/migrations/v3-to-v4) confirms a migration is involved. A permissive AgentKit peer range alone does not prove v4 runtime compatibility. This is a deliberate pin, not a claim that v3 is npm's current default.

P1-02 validates scaffold compilation and linting with these pins; P1-03 selects and validates test tooling in its own scope. MongoDB deployment/server version, credentials, and database access are not inspected here; P2-03 records and verifies the actual isolated deployment. No Serper SDK is needed for the planned HTTP tool; authenticated search is checked in P4-01/P12-04.

## AgentKit and durable execution boundaries

The official [`@inngest/agent-kit@0.13.2` release tag](https://api.github.com/repos/inngest/agent-kit/git/ref/tags/%40inngest%2Fagent-kit%400.13.2) resolves through its annotated tag to commit **`2320d07c6a86b9933d14b3cefd5fd44046e3ec17`**. Source checks used that commit, not moving `main`:

| Released source | Verified behavior |
| --- | --- |
| [models.ts](https://github.com/inngest/agent-kit/blob/2320d07c6a86b9933d14b3cefd5fd44046e3ec17/packages/agent-kit/src/models.ts) | Re-exports the OpenAI-compatible adapter from `@inngest/ai` |
| [util.ts](https://github.com/inngest/agent-kit/blob/2320d07c6a86b9933d14b3cefd5fd44046e3ec17/packages/agent-kit/src/util.ts) | Discovers Inngest steps through `getAsyncCtx` from `inngest/experimental`, supporting two context shapes |
| [model.ts](https://github.com/inngest/agent-kit/blob/2320d07c6a86b9933d14b3cefd5fd44046e3ec17/packages/agent-kit/src/model.ts) | Calls `step.ai.infer` when context supplies steps; otherwise makes a direct provider request |
| [agent.ts](https://github.com/inngest/agent-kit/blob/2320d07c6a86b9933d14b3cefd5fd44046e3ec17/packages/agent-kit/src/agent.ts) | Invokes custom tool handlers directly with `step` in context; catches ordinary tool-handler errors into tool-result data |

The [AgentKit retry example](https://agentkit.inngest.com/advanced-patterns/retries) calls `network.run` from an Inngest function handler. The [multi-step tool guide](https://agentkit.inngest.com/advanced-patterns/multi-steps-tools) demonstrates explicit durable operations inside tools. This supports the planned integration without a separate production AgentKit server: P7-04 exposes the Next.js Inngest endpoint using the framework adapter.

Implementation requirements derived from this evidence and `PLAN.md`:

1. Run the network inside the registered Inngest handler. Do not enclose the entire network in one `step.run` callback; the network's inference and tools need their own boundaries.
2. Wrap Serper requests, URL retrieval, image generation/storage, and persistence in explicit, stably identified durable operations. Custom handler existence does not make its side effects durable.
3. Return JSON-safe tool/step outputs, then apply state transitions from those outputs outside memoized callbacks. A state mutation performed only inside a completed callback is skipped on replay.
4. Checkpoint stage activity and results with guarded repository writes. Reconstruct validated state and the saved model/provider configuration; do not recalculate configuration during replay.
5. Inspect tool-result error data explicitly. A swallowed provider/tool error must not advance the stage or mark publishing complete. P6/P7 tests must establish how retryable versus terminal outcomes propagate to Inngest.
6. Use bounded retries and logical operation identities. A provider call can succeed before its checkpoint is acknowledged: durable execution is not a blanket exactly-once guarantee for external charges or uploads. P7-03 records residual crash windows and tests completed-result reuse.

Inngest's [v3 step reference](https://www.inngest.com/docs/reference/typescript/v3/functions/step-run) specifies step IDs, per-step retry behavior, and JSON serialization. The [AgentKit history guide](https://agentkit.inngest.com/concepts/history) separately shows database persistence through explicit steps. Database checkpoints remain necessary for PostForge's browser polling contract; workflow execution history does not replace the post repository.

P6-04 and P7-02/P7-03 must inspect actual development-runner traces and interrupt/resume execution to establish these properties. No runner or database was started for TASK-001.

## Initial image provider

Select **Gemini / `gemini-2.5-flash-image`** behind the planned image-provider interface. Google's [model reference](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image) lists that stable identifier, image/text input and output, and image generation capability. It is the original Nano Banana model; the preview identifier is deprecated. The [current image-generation guide](https://ai.google.dev/gemini-api/docs/image-generation) also lists newer Nano Banana generations and recommends migration from the original model. Their existence does not require expanding the initial adapter or silently changing the agreed provider choice.

Use the Google Gen AI SDK's content-generation API and inspect response parts for image bytes and MIME type. Do not assume the first part is an image or treat text-only output as success. Configure `GEMINI_API_KEY`, `IMAGE_PROVIDER`, and `IMAGE_MODEL` only on the server. The Illustrator's text reasoning still uses the shared OpenRouter model; image generation is a separate tool/provider call. P2-05 and P4-03 verify malformed/empty/image outputs and storage; P12-04 confirms actual account access and image generation. The model may change before that task, so recheck availability then.

## Read-only checks and handoff

| Check performed | Result | Limit |
| --- | --- | --- |
| Worktree path, branch, resume status | Passed | Existing task branch/worktree at the recorded base; one untracked compatibility draft preserved; primary main clean |
| `PLAN.md` first task, scope, dependencies | Passed | P1-01 has no predecessor tasks; user explicitly authorized resumption, commit, push, and PR; repository protection enforcement was not reverified |
| Public model catalog exact-ID match and required parameters | Passed | Metadata only; no authenticated completion request |
| Public provider endpoint capability comparison | Passed | Capability lists differ; account/provider routing not exercised |
| Official AgentKit adapter docs and immutable release source | Passed | Source inspection, not compiled application behavior |
| Exact npm release metadata, relevant engines and peers | Passed | No install, lock resolution, audit, typecheck, or build performed |
| Official Node release and Google image model documents | Passed | Local runtime unchanged; image request not made |
| Report scope and acceptance coverage | Passed | Only `post-forge/docs/compatibility.md`; all TASK-001 compatibility questions covered; no PLAN amendment needed |
| Staged whitespace and exact path check | Commit gate | Run `git diff --cached --check` and inspect `git diff --cached --name-only` after staging; record the result in the PR |

Read-only reproduction: GET `https://openrouter.ai/api/v1/models`, select `data` by the exact ID, and inspect `supported_parameters`; GET its linked endpoint catalog; GET each version-specific npm URL above and compare `engines`/`peerDependencies`; resolve the linked release tag and inspect its four source files. All provider checks were unauthenticated. A sandbox network failure was rerun with the required escalation; an unsuccessful upstream source fetch was resolved using the immutable GitHub release API. Neither failure is represented as a passing live integration test.

**Acceptance for this task:** requested compatibility questions have documented observations and decisions. Independent Test Agent verification and Code Review must assess the pushed PR head before merge. No Architecture self-approval is valid because that role owns this task. The remaining live/build/replay checks are explicitly deferred to their implementation tasks, rather than reported as passed here.

**Resumption checkpoint (2026-09-08):** the agent registry exposed only the current coordinator, with no previous specialist available to resume. No duplicate agents were launched. The saved compatibility draft was resumed in place. GitHub inspection found no existing TASK-001 remote branch or PR, and remote `main` still matched the recorded base. The coordinator repeated the read-only catalog, package metadata, official documentation, and immutable-source checks; these are local verification evidence, not independent Test or Code Review approval. Those reviews remain pending against the eventual pushed head.

**Handoff:** commit and push this report only, open the single TASK-001 PR to `main`, report its exact commit and checks, and stop. Do not merge, delete the review worktree, mark successors runnable, or start TASK-002 in this execution.
