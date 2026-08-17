import { BRANDING_PROVIDER } from './branding';

export * from './branding';
export * from './llm';
export * from './url';

export const ENABLE_BUSINESS_FEATURES = false;

/**
 * Master switch for the (now removed) conversational agent-onboarding flow.
 *
 * Soft-disabled: kept in the codebase but permanently off. No client code
 * reads this anymore now that the agent-onboarding flow has been deleted.
 */
export const AGENT_ONBOARDING_ENABLED = false;

/**
 * Whether the classic onboarding flow ends with the agent-marketplace picker.
 *
 * The picker lists templates fetched from the hosted marketplace
 * (`market.agent.getOnboardingFull`). A self-hosted deployment with no route to
 * that service can only ever render an empty grid, so the step is dead weight
 * there — turn this off and the flow finishes on the last form step instead.
 */
export const ONBOARDING_AGENT_PICKER_ENABLED = true;

/**
 * Whether the assistant is told it can connect third-party services.
 *
 * The credentials tool advertises two catalogues to the model: the built-in
 * OAuth providers (GitHub, Linear, Microsoft, Notion, X) and the Composio
 * integrations (Gmail, Google Calendar, Slack, …). Both are advertised
 * unconditionally — the Composio guidelines name services even when no
 * COMPOSIO_API_KEY is configured — so a deployment that ships none of them
 * still has an assistant claiming it can read the user's mail.
 *
 * Turning this off drops those sections from the system prompt *and* the
 * corresponding tool entries from the manifest. Local credential management
 * (saveCreds, sandbox injection) is unaffected.
 */
export const EXTERNAL_INTEGRATIONS_ENABLED = true;

/**
 * Whether this distribution ships a desktop build users can download.
 *
 * The web app offers the desktop app in several places — the execution-target
 * menu (both the header link and the empty-state card), the platform-agent
 * creation hint, and the device-connect wizard. They all point at
 * `DOWNLOAD_URL`, which serves the official build. A distribution that has no
 * desktop build of its own must not send users there, so turn this off and
 * every one of those entry points disappears.
 *
 * Local execution itself is untouched: a desktop client that already exists
 * still enrolls and runs normally. This only governs the *download* offer.
 */
export const DESKTOP_APP_ENABLED = true;

/**
 * Whether this distribution reaches the hosted skill marketplace.
 *
 * Governs the prompt, not a button. The activator's `<skill_store_discovery>`
 * block teaches the model to recognise `lobehub.com/skills/…` URLs and route
 * them to `importFromMarket` — so on a deployment with no marketplace the model
 * is told about an address it cannot use, and repeats that address back to the
 * user in its replies. UI gating cannot reach that: the link is something the
 * model writes, not something the app renders.
 *
 * Same reasoning as EXTERNAL_INTEGRATIONS_ENABLED: don't describe a capability
 * to the model that this deployment does not have.
 */
export const SKILL_MARKETPLACE_ENABLED = true;

/**
 * Whether this distribution offers the CLI as a way to enrol a device.
 *
 * The `lh connect` flow installs the first-party CLI from the public npm
 * registry, so a distribution that does not publish its own is offering a
 * command that either fails or reaches somebody else's package. Separate from
 * DESKTOP_APP_ENABLED because the two dead-end independently: shipping a
 * desktop build does not make the CLI installable, and vice versa.
 */
export const CLI_CONNECT_ENABLED = true;

/**
 * Whether this distribution has a changelog to point users at.
 *
 * `CHANGELOG_URL` is the hosted site's, so a rebranded or self-hosted build
 * offering it sends users to another product's release notes, on another
 * product's release cadence, over a network a closed deployment may not have.
 *
 * The `changelog` feature flag governs the same surfaces and stays in force,
 * but it is resolved from server config at runtime — which makes it the wrong
 * tool for a build that must simply never show the entry. Turn this off and it
 * is gone from the artifact, whatever the deployment's flags say.
 */
export const CHANGELOG_ENABLED = true;

/**
 * Whether the home composer shows the "New" model shortcut row.
 *
 * The row is a hardcoded editorial list (`starterModels.ts`) — the freshest
 * chat/image/video models at release time. It is not derived from the models a
 * deployment actually serves, so on any deployment with its own model
 * catalogue the buttons are dead: clicking one writes a model id the provider
 * has never heard of. Turn it off where the catalogue is deployment-specific.
 */
export const HOME_MODEL_SHOWCASE_ENABLED = true;

/**
 * Settings tabs this distribution does not ship, by `SettingsTabs` value.
 *
 * A deny-list rather than a flag per tab: which tabs apply is a property of the
 * deployment, not of the product, and the set differs per distribution — a
 * boolean each would mean a new slot every time somebody drops one more.
 * Entries are plain strings so this package stays free of a dependency on the
 * store's enum.
 *
 * A group whose items are all hidden disappears with them; an empty settings
 * group is worse than a missing one, because it reads as a section that failed
 * to load.
 */
export const SETTINGS_HIDDEN_TABS: readonly string[] = [];

/**
 * Entries this distribution drops from the sidebar help menu, by item key:
 * `setting`, `inviteFriend`, `docs`, `feedback`, `discord`, `changelog`,
 * `get-app`, `github`, `eval`.
 *
 * Same shape and reasoning as SETTINGS_HIDDEN_TABS. Most of this menu points
 * outward — the hosted docs site, the LobeHub Discord, the feedback form, the
 * upstream GitHub repo — so on a closed network the entries are dead links, and
 * on any private deployment they route users to somebody else's support channel
 * for a product that is not the one they are using.
 *
 * `github` covers the standalone icon in the expanded layout too: hiding the
 * menu entry while leaving a GitHub button beside it would say two things at
 * once. Dividers left stranded by the hidden entries collapse with them.
 */
export const FOOTER_HIDDEN_MENU_KEYS: readonly string[] = [];

/**
 * Whether the side-panel copilots (page editor, task manager) let the user
 * switch which agent answers.
 *
 * These panels are bound to a purpose-built agent — the page agent, the task
 * agent — and the switcher lets any agent in the workspace take over that slot.
 * Where the deployment intends those panels to have one behaviour, the switcher
 * is a way to get a different one with no indication that anything changed.
 */
export const AGENT_SWITCHING_ENABLED = true;

/**
 * Built-in skills this distribution does not ship, by skill identifier.
 *
 * Same shape and reasoning as SETTINGS_HIDDEN_TABS: which built-ins apply is a
 * property of the deployment. The `lobehub` skill in particular documents the
 * first-party CLI and its bot channels, so it is only useful where those are
 * actually shipped.
 */
export const BUILTIN_SKILLS_HIDDEN: readonly string[] = [];

/**
 * Whether users can create agent teams (multi-agent groups).
 *
 * Turning this off removes the creation entry points only — the command menu
 * item and the home starter. Existing groups stay reachable and usable, so a
 * deployment that decides mid-flight not to offer the feature does not strand
 * anything already made with it.
 */
export const AGENT_GROUP_CREATION_ENABLED = true;

/**
 * Whether the home dashboard shows the Chief Agent portrait and the speech
 * bubble beside it.
 *
 * A slot rather than a constant because the artwork is served from the hosted
 * ops bucket (`OPS_ASSETS_BASE_URL`), so it is the one thing on the dashboard a
 * self-hosted deployment cannot render from its own origin — an air-gapped
 * install gets a broken image, and any install gets a third-party request on
 * every home view.
 *
 * The bubble is covered by the same switch on purpose: its tail points at the
 * portrait and its copy is written as the agent speaking, so on its own it is a
 * caption with nothing to caption. The greeting reclaims the width both of them
 * were holding (see `--home-greeting-measure`).
 */
export const HOME_PORTRAIT_ENABLED = true;

/**
 * Service identifier returned by `GET /api/v1/health`.
 *
 * That endpoint is public and unauthenticated, so this string is readable by
 * anyone who can reach the deployment — which makes it a branding surface, not
 * an internal name. A slot rather than a literal so a white-label distribution
 * does not answer health checks with someone else's product name.
 *
 * The default keeps the historical `lobe-chat-api` value: nothing in this repo
 * reads it, but external monitoring may match on it, so upstream's observable
 * output stays byte-identical.
 */
export const API_SERVICE_ID = 'lobe-chat-api';

/**
 * The infrastructure the cloud sandbox actually runs on, as told to the model.
 *
 * A slot rather than a literal because this is a deployment fact, not a product
 * one: the sentence is stated confidently enough that the assistant repeats it
 * to users, so a distribution wiring the sandbox elsewhere would otherwise have
 * an assistant naming the wrong vendor with nothing in the prompt to correct it.
 */
export const SANDBOX_INFRASTRUCTURE = 'AWS Bedrock AgentCore';

/**
 * What the sandbox image actually ships, as told to the model.
 *
 * A slot because it describes one specific image. The default below is the
 * upstream `lobehubbot/python-node` image; a deployment running a different one
 * has an assistant reaching for tools that are not installed, and finding out
 * only when the command fails. Keep it to what has been verified present.
 */
export const SANDBOX_PREINSTALLED_SOFTWARE = `**Base Image:** lobehubbot/python-node:latest (Debian-based)

**Programming Languages & Runtimes:**
- Python (with pip)
- Node.js (with npm)
- Bun
- Bash/Shell

**Package Managers:**
- pip (Python)
- npm / pnpm (Node.js)

**System Tools (apt):**
- curl, wget, unzip, jq - Common utilities
- build-essential - gcc/g++/make compilation toolchain
- FFmpeg - Audio/video processing
- LibreOffice - Office document processing
- Pandoc - Document format conversion
- poppler-utils - PDF tools (pdftotext, pdftoppm, etc.)
- GitHub CLI (gh)

**JS/TS Tools:**
- marp-cli - Markdown to PPT/PDF presentation
- Chromium (installed via Playwright, also used by marp-cli)
- Playwright - Browser automation

**Python Libraries (Pre-installed):**
- Data Science/ML: numpy, pandas, scipy, scikit-learn
- Visualization: matplotlib, plotly
- Data Processing: pyyaml, toml, python-dotenv, Pillow, opencv-python-headless
- File Processing: openpyxl, xlrd, python-docx, PyPDF2, reportlab
- Async: aiofiles, anyio
- Testing: pytest
- Server: fastapi, uvicorn, pydantic`;

export const OFFICIAL_PROVIDER_DISABLE_ERROR = 'The official provider cannot be disabled.';

export const isOfficialProvider = (id: string) =>
  ENABLE_BUSINESS_FEATURES && id === BRANDING_PROVIDER;
