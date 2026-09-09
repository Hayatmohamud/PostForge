# PostForge

Minimal TypeScript Next.js App Router starter for P1-02 / TASK-002. The home route displays a static starter page. Product screens and integrations belong to later tasks in [PLAN.md](../PLAN.md).

## Runtime and installation

Use **Node.js 24.20.0** and its bundled **npm 11.19.0**, selected in the merged [compatibility report](docs/compatibility.md). Direct framework and tooling dependencies use exact versions; `package-lock.json` locks transitive dependencies. Only packages needed by this scaffold are installed.

From this `post-forge/` directory:

```sh
node --version
npm --version
npm ci
npm run dev
```

Open http://localhost:3000. To use another port, run `npm run dev -- --port 3002`. On Windows PowerShell, use `npm.cmd` if the script execution policy blocks `npm.ps1`.

To keep an existing global Node installation unchanged on Windows, download the [official Node 24.20.0 Windows x64 ZIP](https://nodejs.org/dist/v24.20.0/node-v24.20.0-win-x64.zip), verify its SHA-256 against the release's [SHASUMS256.txt](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt), and extract it outside the repository. Prepend the extracted directory to `PATH` for the current PowerShell session:

```powershell
$taskNode = 'C:\path\to\node-v24.20.0-win-x64'
$env:PATH = "$taskNode;$env:PATH"
node --version
npm.cmd --version
npm.cmd ci
```

The version commands must report `v24.20.0` and `11.19.0` before installation or verification. This changes only the current shell, not the system installation. No credentials or environment configuration are needed for the starter.

## Verification

```sh
npm ci
npm run typecheck
npm run lint
npm run build
```

`typecheck` runs `next typegen` before strict TypeScript checking, so a clean checkout does not depend on a prior build. Next.js generates the ignored `next-env.d.ts` and `.next/` route definitions. Lint runs separately because the Next.js build does not run ESLint. To serve the production build, run `npm run start`.

`agentRules: false` disables Next.js development-time generation of `AGENTS.md` and `CLAUDE.md`, keeping startup within the approved scaffold files.

For the required starter-page browser inspection, start the development server and open `/` at desktop and mobile widths. Confirm the PostForge heading and starter text render, no horizontal overflow or framework error overlay appears, and browser error output and server logs are clear. Browser verification tools remain external to the application dependencies. Keep screenshots and logs in ignored `test-results/` and stop the server/browser afterward.

Secrets, dependencies, builds, generated types, and verification artifacts are ignored. TASK-003 supplies the offline Vitest/Playwright tooling and CI; server configuration uses that existing unit-test harness.

## Server configuration

TASK-004 provides `getServerConfig()` in `src/lib/config.ts`. Copy `.env.example` to ignored `.env.local` and supply credentials locally when implementing or running the server integrations. The static starter and offline tests still need no credentials.

Call `getServerConfig()` at the beginning of each future Node.js API/workflow entry point, before database access, event dispatch, or provider calls. It reads `process.env` lazily and validates each invocation. Importing the module alone does not validate configuration during a static build. The returned nested configuration is frozen; pass its relevant values to server integrations rather than reading environment variables throughout the application.

Required values are `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `SERPER_API_KEY`, `GEMINI_API_KEY`, `IMAGE_PROVIDER`, `IMAGE_MODEL`, `MONGODB_URI`, and `MONGODB_DB`. Whitespace is trimmed and missing/blank values fail with a `ConfigurationError` naming invalid fields, never their contents. Configuration checks presence and supported provider selection, not credential validity, database reachability, model capabilities, or account access.

The development example selects `OPENROUTER_MODEL=z-ai/glm-5.3-flash`, `IMAGE_PROVIDER=gemini`, and `IMAGE_MODEL=gemini-2.5-flash-image` from the merged compatibility report. Only the Gemini image provider is accepted. A different compatible text/image model can be configured explicitly; there is no implicit model fallback. Future run creation must snapshot the selected models/provider, and resumed runs must use that snapshot.

For local Inngest Dev Server use, explicitly set `INNGEST_DEV=true` (or `1`); event/signing keys may then be omitted. With `INNGEST_DEV` omitted, `false`, or `0`, both `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are required, even under `NODE_ENV=development`. Other values, including blank values and custom URLs, are rejected by this initial configuration contract. Cloud environments must use cloud mode and their own keys. This follows Inngest's [explicit development mode](https://www.inngest.com/docs/sdk/environment-variables) and [local signing-key exception](https://www.inngest.com/docs/platform/signing-keys); no Inngest client or endpoint is added by this task.

The configuration module imports the [Next.js `server-only` marker](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning), which Next resolves internally without another package. Client Component imports fail at build time. Never return the configuration object in an API response, pass it to Client Components, log it, or rename its secrets with a `NEXT_PUBLIC_` prefix. Unit tests mock only this framework marker and use fake credentials. Public error mapping is owned by the subsequent error-handling task.

### Finite operational limits

`limitDefinitions` in `src/lib/config.ts` is the sole implementation source of defaults and inclusive minimum/maximum values. The returned `config.limits` supplies the validated numbers. Optional overrides must contain decimal integers; omit an override to use its default. Blank, fractional, non-finite, unsafe, and out-of-range values fail validation.

| Environment override | Meaning |
| --- | --- |
| `TOPIC_MAX_CHARS` | Maximum topic UTF-16 code units after consumer trimming |
| `ARTICLE_MAX_CHARS` | Maximum article UTF-16 code units |
| `SEARCH_MAX_RESULTS` | Maximum results retained per search |
| `FINDINGS_MAX_COUNT` | Maximum findings retained per run |
| `SOURCE_MAX_BYTES` | Maximum bytes fetched per source |
| `POSTER_MAX_BYTES` | Maximum generated poster bytes |
| `PROVIDER_TIMEOUT_MS` | Text/search/source request timeout in milliseconds |
| `IMAGE_TIMEOUT_MS` | Image request timeout in milliseconds |
| `DATABASE_TIMEOUT_MS` | Database operation timeout in milliseconds |
| `STAGE_CORRECTION_ATTEMPTS` | Extra corrections after the initial stage output; zero disables corrections |
| `PROVIDER_RETRIES` | Extra provider attempts after the initial call; zero disables retries |
| `NETWORK_MAX_ITERATIONS` | Total network iteration ceiling per run, including the initial iterations |

The defaults are initial application budgets, not provider guarantees. Consumers in their assigned tasks must enforce these caps, supply abort/timeout handling, and reuse the values rather than defining new defaults. This task validates configuration only; it does not execute requests or add runtime contracts/UI controls.

Run the focused, credential-free configuration checks from `post-forge/`:

```sh
npm run typecheck
npm run lint
npm run test:unit -- tests/unit/config.test.ts
```

Coverage includes valid/missing/blank variables, explicit local versus cloud Inngest keys, unsupported image providers, numeric defaults/boundaries, fake-credential redaction, and the development example. The existing unit runner forwards the path filter to Vitest.
