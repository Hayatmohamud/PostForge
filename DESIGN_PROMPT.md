# PostForge — MVP Design Brief and Future Phases

Status: planning only, awaiting implementation approval. PLAN.md defines the implementation task breakdown and dependencies. This brief distinguishes required MVP designs from optional future product ideas. No designer or coding agents are being assigned.

## 1. Approved MVP boundary

Design only the interface needed for:

**Topic Input → Research → Verification → Writing → Editing → Image Generation → Save/Publish to database → Final Post + Sources.**

Publish means save to MongoDB; it does not mean publishing to social media. A run proceeds autonomously without a human review gate, with clear failure when supported content cannot be produced.

Required MVP UI:

1. New Post/topic input.
2. Live agent pipeline.
3. Final post detail.
4. Sources and verification information.
5. Basic past-post library.

Authentication, analytics dashboard, settings UI, scheduling/cron UI or scheduled execution, social media publishing, and pricing/marketing features are **future-only**. Their designs, backend services, and integrations must not block MVP.

## 2. Model and configuration assumptions

- **GLM-5.3-Flash through OpenRouter** is the default development text model.
- A shared provider-neutral model factory reads **OPENROUTER_MODEL** and server-only **OPENROUTER_API_KEY**. Agent code must not hard-code model identifiers.
- The exact GLM catalog identifier/capabilities are verified during the first approved implementation task; the environment example then records that identifier.
- Switching later to GPT-5 or another compatible OpenRouter model uses environment configuration plus restart/redeploy, without agent-code edits.
- Missing/blank model configuration is an explicit server configuration error, not a silent alternative-model fallback.
- Capture selected model/provider metadata per run. There are no model selectors or settings controls in MVP.
- Initial poster generation uses the planned Gemini/Nano Banana adapter, with IMAGE_PROVIDER and IMAGE_MODEL configured server-side. Alternative image adapters remain future work.

## 3. Design direction

Use one coherent, modern, minimal **light theme**. Favor clear typography, generous spacing, restrained surfaces, and a confident brand accent. The six-stage pipeline is the main visual focus.

Make evidence easy to inspect: show sources, verification outcomes, and concise descriptions of what each stage actually did. Verification is an evidence assessment, not a guarantee of truth.

Define a small reusable system:

- Neutral background/surface/border/text palette, one brand accent, and semantic success/warning/error/info colors.
- Consistent distinct stage accents for Research, Verify, Write, Edit, Illustrate, Publish. Status must also use text/icons rather than color alone.
- Modern sans-serif UI typography and readable editorial article typography; clear heading/body/caption scale.
- Consistent spacing, content widths, radius, subtle elevation, and borders.
- One line-icon set and accessible focus styling.
- Brief purposeful state transitions and reduced-motion alternatives.

Only implement components used by required screens. Do not build a full generic design system or unused component suite as a prerequisite.

## 4. Required MVP screens and states

### A. Minimal application shell

- New Post at / and Library at /library.
- Simple logo and navigation between these two destinations.
- Post progress/final output share /posts/[id].
- Responsive navigation without a dashboard, account menu, user avatar, settings, or scheduling destinations.
- No marketing landing page: the home route starts the product flow.

### B. New Post / topic input

- Prominent labeled topic field, a few helper examples, and Generate action.
- Input validation uses the same limits as the API.
- States: default, invalid input, submitting, and submission failure with retry.
- Preserve topic and submission identity through an ambiguous network failure so retry does not create another run.
- Successful submission opens the saved run URL.
- No model/image-provider pickers, tone/length controls, or settings form in MVP.

### C. Live agent pipeline

Show all six stages in order:

**Research → Verify → Write → Edit → Illustrate → Publish**

- Horizontal layout on larger screens and vertical/stacked layout on narrow screens.
- Queued, active, retrying, done, and failed states with icons and text.
- Emphasize the active stage with restrained animation.
- Show persisted elapsed time and actual available activity summaries.
- Research: search/source summaries. Verify: supported/unsupported/conflicting claims and evidence summaries. Write/Edit: available saved output summaries. Illustrate: generation status and finished poster when available. Publish: confirmed database save.
- Completed stages have expandable summaries.
- Start with initial loading/queued state; handle temporary polling errors separately from generation failure.
- Failed run shows failed stage and useful reason; unstarted stages remain queued. Allow navigation to New Post; do not imply an unimplemented run-resume feature.
- Completion reveals the final deliverable at the same URL.
- Refreshing/reopening the URL restores persisted progress.

**MVP uses polling.** Do not require token streaming, partially rendered images, simulated search activity, fake progress percentages, or a graph editor.

### D. Final post detail

- Title, poster image with useful alt text, and readable article body.
- Inline citation references and a clearly separated Sources section.
- Creation metadata; selected model may appear as secondary generation metadata.
- States: initial loading, completed post, missing post, fetch error, and image loading/failure.
- A failed poster request must leave the article and evidence readable.
- Direct links and browser refresh work.
- Copy/download conveniences can be added later; regenerate, delete, and social publishing controls are not MVP requirements.

### E. Sources and verification information

This is required within the pipeline and final detail, not a separate administration screen.

- Stable links between article claims and cited sources.
- Source title/domain and clickable public URL.
- Claim-level supported, unsupported, or conflicting verdict with concise explanation.
- Separate rejected/conflicting research from evidence actually used in the final article.
- Unsupported findings must not appear as supported article citations.
- Explain insufficient-evidence failure when no finding qualifies for writing.
- Render fetched/model content safely and never expose raw provider errors or credentials.
- Clearly communicate what the system checked without implying absolute factual certainty.

### F. Basic past-post library

- One responsive list of persisted runs/posts, latest first.
- Show title or topic, status, date, and optional poster thumbnail.
- Open each record at its existing post URL.
- Empty/loading/error states and bounded load-more pagination.
- Refresh list when returning after a new submission.
- Search, date/status filter suites, analytics, and card/list toggles are deferred.

### G. Shared states and accessibility

- Consistent form errors, loading indicators, missing-record states, and retriable connection errors.
- Distinguish a temporary request problem from a terminal pipeline failure.
- Desktop, tablet, and mobile layouts for each MVP screen.
- WCAG AA contrast, visible focus, keyboard navigation, semantic headings, accessible status announcements, adequate touch targets, and reduced motion.
- Do not build unrelated global-state screens or unused controls.

## 5. MVP design deliverables and completion

Required deliverables:

1. A compact visual system applied to the required screens/components.
2. Responsive designs for New Post, pipeline, final post/evidence, and basic library in their listed states.
3. Clear transitions from submission to live run to saved deliverable and back to library.
4. Browser verification of actual implemented loading, success, empty, and error states.

These are implementation deliverables after approval; this document does not require a separate exhaustive design phase before the MVP can proceed. Full implementation acceptance and testing are defined by the 48 tasks in PLAN.md.

## 6. Future design phases — excluded from MVP

The following preserves the broader product vision. Ordering is illustrative and does not authorize implementation or add prerequisites to the MVP.

| Future phase | Potential scope | Additional design work |
|---|---|---|
| Accounts and identity | Sign in/up, social sign-in, account/profile management | Auth forms, validation/loading/error states, account menu and protected navigation |
| Analytics dashboard | Generated-post counts, success/failure trends, duration and agent/token activity | Dashboard layout, chart states, metric definitions, empty and partial data |
| Settings and integrations | Profile, integration credentials, connection checks, model/image/tone/length defaults | Masked server-backed credential forms, test-connection feedback, save/error states |
| Scheduling | Recurring topics/themes, schedule editing, enable/disable, run now, upcoming/last run | Schedule list/forms, cadence controls, background scheduling behavior |
| Social publishing | Explicit external destinations and publishing actions | Connection setup, destination selection, publish/failure feedback |
| Marketing and pricing | Public landing page, pipeline preview, feature sections, social proof, pricing/CTA/footer | Public site and commercial flows, separate from application entry |
| Advanced library and editing | Search/filters/view toggles, copy/download conveniences, regenerate/delete | Expanded navigation/actions, confirmation/error states, richer library controls |
| Richer live experience | Token streaming, finer-grained events, additional model/image adapters and per-run controls | Streaming states, configuration controls, provider-specific availability feedback |
| Prior-post intelligence | History retrieval and duplicate-topic awareness | Explain retrieved context and duplicate-topic suggestions |

Future phases may expand the shell to Dashboard, New Post, Library, Scheduled, and Settings with account controls. That expanded shell is not part of the current MVP.

## Approval boundary

Planning documents only. Do not scaffold, create folders, install dependencies, write application code, or assign coding agents. Stop after the task breakdown and dependency graph for user approval.
