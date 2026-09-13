# Verification record

## P12-01 / TASK-044: complete MVP happy path

`tests/e2e/generation.spec.ts` drives the real browser flow against a manually
started Next.js server. It submits through `POST /api/generate`, waits for the
real Inngest development runner to execute the AgentKit network, checks the
persisted MongoDB document and GridFS file, exercises the GET APIs, then opens
the direct post URL and library link.

The only deterministic boundary is outbound provider traffic. Loading
`tests/fixtures/providers.ts` with `NODE_OPTIONS` intercepts Serper, source
fetch, and Gemini requests in the Next.js process. AgentKit text inference is
executed by the Inngest runner, so the same fixture can be started as a local
HTTP provider endpoint for that runner. This does not intercept application
routes, Inngest, MongoDB, GridFS, or browser requests. The fixture responses
produce one fetched source, one supported finding, a grounded article, and a
valid PNG poster.

Use the configured MongoDB Atlas deployment and a dedicated database name for
each run. The database name must match `postforge_test_*`; the application and
test receive the same explicit URI and database name. Do not set
`POSTFORGE_TEST_MODE`: the normal server configuration is used with Atlas,
while the test's isolation guard prevents production database names.

From `post-forge`, start the real application with the existing command:

```powershell
$env:POSTFORGE_PROVIDER_FIXTURES = "1"
$env:POSTFORGE_PROVIDER_FIXTURE_SERVER = "0"
$env:OPENROUTER_BASE_URL = "http://127.0.0.1:8787/v1"
$env:TEST_MONGODB_DB = "postforge_test_task044_run1"
$env:MONGODB_URI = $env:TEST_MONGODB_URI  # existing Atlas URI; values are not printed
$env:MONGODB_DB = $env:TEST_MONGODB_DB
$env:OPENROUTER_API_KEY = "task044-fixture-key"
$env:OPENROUTER_MODEL = "z-ai/glm-5.3-flash"
$env:SERPER_API_KEY = "task044-fixture-key"
$env:GEMINI_API_KEY = "task044-fixture-key"
$env:IMAGE_PROVIDER = "gemini"
$env:IMAGE_MODEL = "gemini-2.5-flash-image"
$env:INNGEST_DEV = "true"
$env:NODE_OPTIONS = "--import=./tests/fixtures/providers.ts"
npm run dev -- --hostname 127.0.0.1 --port 3104
```

Before or alongside the app, start the fixture endpoint in a separate shell;
it is the only process allowed to serve deterministic provider responses:

```powershell
$env:POSTFORGE_PROVIDER_FIXTURES = "1"
$env:POSTFORGE_PROVIDER_FIXTURE_SERVER = "1"
$env:POSTFORGE_PROVIDER_FIXTURE_PORT = "8787"
node --import=./tests/fixtures/providers.ts -e "setInterval(()=>{}, 2147483647)"
```

In another shell, from the same directory, start the repository supported
Inngest endpoint:

```powershell
npx inngest-cli@latest dev -u http://127.0.0.1:3104/api/inngest
```

In a third shell, use the same test database variables and point the browser
test at the real application:

```powershell
$env:TASK044_APP_URL = "http://127.0.0.1:3104"
$env:TEST_MONGODB_DB = "postforge_test_task044_run1"
$env:MONGODB_URI = $env:TEST_MONGODB_URI  # existing Atlas URI; values are not printed
$env:MONGODB_DB = $env:TEST_MONGODB_DB
npm run test:e2e -- tests/e2e/generation.spec.ts
```

The test proves the 202 submission response, durable dispatch and run identity,
all six persisted stage completions, one final post, article and citation
agreement with verification data, completed GridFS manifest and bytes, direct
post rendering, and library retrieval. Required repository checks are:

```text
npm run typecheck
npm run lint
```

This is fixture-backed integration proof. Live OpenRouter, Serper, and Gemini
provider availability remains outside TASK-044 and belongs to TASK-047.
