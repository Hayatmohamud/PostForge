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

Secrets, dependencies, builds, generated types, and verification artifacts are ignored. Automated test tooling and CI are assigned to TASK-003; this task adds no test framework or service integrations.
