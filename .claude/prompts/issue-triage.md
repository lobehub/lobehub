# Issue Triage Guide

This guide is used for triaging GitHub issues — analyzing issues and applying only the most essential business-domain labels.

## Core Principle

**Each issue should have 1-3 labels that describe its core business domain.** Do NOT apply redundant labels that can be inferred from other labels. Less is more.

## Workflow

For EACH issue, follow these steps:

### Step 1: Get Available Labels (run once per batch)

```bash
gh label list --json name,description --limit 300
```

### Step 2: Get Issue Details

For each issue number, run:

```bash
gh issue view [ISSUE_NUMBER] --json number,title,body,labels,comments
```

### Step 3: Select Labels (1-3 per issue)

Only apply labels from these THREE categories:

#### Category 1: Technology Carrier

The runtime environment or technology wrapper where the issue occurs:

| Label | When to apply |
|-------|--------------|
| `electron` | Desktop/Electron-specific issues. This REPLACES `platform:desktop`, `os:*`, `deployment:*`, `hosting:*` — do NOT add those. |
| `pwa` | PWA/mobile-app-specific issues |
| `docker` | Docker-specific deployment issues |

**Rule**: If `electron` is applied, do NOT add `platform:desktop`, `os:*`, `deployment:*`, or `hosting:*`. The `electron` label already implies all of these.

#### Category 2: Feature / Component

The functional area affected. Select the 1-2 MOST relevant:

Core Features:

- `feature:agent` - Agent/Assistant functionality
- `feature:topic` - Topic/Conversation management
- `feature:marketplace` - Agent/plugin marketplace
- `feature:settings` - Settings and configuration

Content & Knowledge:

- `feature:editor` - Lobe Editor / rich text / markdown rendering
- `feature:markdown` - Markdown rendering (if separate from editor)
- `feature:files` - File upload/management
- `feature:knowledge-base` - Knowledge base and RAG
- `feature:export` - Export functionality

Model Capabilities:

- `feature:tool` - Tool calling and function execution
- `feature:streaming` - Streaming responses
- `feature:vision` - Vision/multimodal capabilities
- `feature:image` - AI image generation
- `feature:tts` - Text-to-speech

Technical:

- `feature:api` - Backend API
- `feature:auth` - Authentication/authorization
- `feature:sync` - Cloud sync functionality
- `feature:search` - Search functionality
- `feature:mcp` - MCP integration
- `feature:thread` - Thread/Subtopic functionality

Collaboration:

- `feature:group-chat` - Group chat functionality
- `feature:memory` - Memory feature
- `feature:team-workspace` - Team workspace
- `feature:im-integration` - IM and bot integration

Other:

- `feature:schedule-task` - Scheduled task functionality

**Rule**: Pick only the 1-2 most specific feature labels. Don't stack multiple features unless the issue genuinely spans multiple areas.

#### Category 3: Model Provider

Only when the issue is SPECIFICALLY about a provider's behavior:

**Official Providers** (check title and body for these keywords):

- `openai`, `gpt` → `provider:openai`
- `gemini` → `provider:gemini`
- `claude`, `anthropic` → `provider:claude`
- `deepseek` → `provider:deepseek`
- `google` → `provider:google`
- `ollama` → `provider:ollama`
- `azure` → `provider:azure`
- `bedrock` → `provider:bedrock`
- `vertex` → `provider:vertex`
- `groq`, `grok` → `provider:groq`
- `mistral` → `provider:mistral`
- `moonshot` → `provider:moonshot`
- `zhipu` → `provider:zhipu`
- `minimax` → `provider:minimax`
- `doubao` → `provider:doubao`

**Third-party Aggregation Providers**:

- `aihubmix`, `AIHubMix`, `AIHUBMIX` → `provider:aihubmix`
- `zenmux` → `provider:zenmux`

**Rule**: Only add a provider label if the issue is specifically about that provider's behavior (e.g., "Gemini returns error X"). Do NOT add provider labels just because the issue template mentions a provider.

#### Special Labels (use sparingly)

- `i18n` - Internationalization / translation issues
- `Duplicate` - Only if duplicate of an OPEN issue (mention issue number)
- `🤔 Need Reproduce` - Needs reproduction steps
- `good-first-issue` - Good for first-time contributors

### Step 4: Apply Labels

```bash
gh issue edit [ISSUE_NUMBER] --add-label "label1,label2"
gh issue edit [ISSUE_NUMBER] --remove-label "unconfirm"
```

### Step 5: Log Summary

For each issue, provide a brief reasoning (1-2 sentences) explaining why each label was chosen.

## What NOT to Label

These categories are INTENTIONALLY OMITTED — do NOT apply them:

| Do NOT apply | Reason |
|-------------|--------|
| `platform:web`, `platform:desktop`, `platform:mobile` | Inferred from `electron`/`pwa` or issue context |
| `os:windows`, `os:macos`, `os:linux`, `os:ios`, `os:android` | Low triage value; inferred from `electron` |
| `device:pc`, `device:mobile` | Redundant with platform |
| `hosting:cloud`, `hosting:self-host`, `hosting:vercel`, etc. | Low triage value unless deployment-specific |
| `deployment:server`, `deployment:client`, `deployment:pglite` | Low triage value; inferred from `electron` |
| `priority:high`, `priority:medium`, `priority:low` | Maintainers judge priority themselves |
| `🐛 Bug`, `💄 Design`, `📝 Documentation`, `⚡️ Performance` | Issue type is already indicated by GitHub issue template |
| `Inactive` | Handled separately; do NOT add during triage |

## Examples

### Example 1: Electron desktop bug

**Issue**: "Connection failure when executing tasks on macOS desktop app"

**Analysis**: Desktop Electron app issue with task scheduling.

**Labels**: `electron,feature:schedule-task`

**Why**: `electron` covers the desktop platform. `feature:schedule-task` identifies the affected feature. No need for `platform:desktop`, `os:macos`, `hosting:cloud`, `priority:*`, or `Bug`.

### Example 2: Provider-specific issue

**Issue**: "Gemini tool calling returns empty response on desktop"

**Analysis**: Desktop app issue, but the core problem is Gemini provider behavior with tool calling.

**Labels**: `electron,provider:gemini`

**Why**: `electron` for the desktop context. `provider:gemini` because the issue is about Gemini's behavior. The tool calling aspect is secondary — the provider is the key domain.

### Example 3: Feature-specific issue

**Issue**: "Underscore auto-escaped in markdown editor"

**Analysis**: Markdown rendering bug in the editor component.

**Labels**: `feature:markdown`

**Why**: Single label is sufficient — the issue is purely about markdown rendering. No need for platform, OS, or priority labels.

### Example 4: Web-only feature request

**Issue**: "Add search functionality to plugin marketplace"

**Analysis**: Feature request for marketplace search. Web platform, no specific provider.

**Labels**: `feature:marketplace,feature:search`

**Why**: Two feature labels capture the core domain. No platform label needed — it's a web app by default.

### Example 5: Ollama self-hosted issue

**Issue**: "Ollama model not loading on self-hosted Docker deployment"

**Analysis**: Provider-specific issue with Ollama on Docker.

**Labels**: `docker,provider:ollama`

**Why**: `docker` for the deployment context, `provider:ollama` for the model provider. No need for `hosting:self-host` or `platform:*`.

## Important Rules

1. **1-3 labels per issue** — Never exceed 3 labels. If you find yourself adding more, you're being too granular.
2. **`electron` replaces all platform/OS/deployment labels** — Never combine `electron` with `platform:desktop`, `os:*`, `deployment:*`, or `hosting:*`.
3. **Provider only when relevant** — Only add `provider:*` if the issue is specifically about that provider's behavior.
4. **No priority, no type** — Do NOT add `priority:*`, `🐛 Bug`, `💄 Design`, etc. Maintainers handle these.
5. **No comments** — Only apply labels. Do NOT post comments to issues.
6. **Remove `unconfirm`** — Always remove the `unconfirm` label when applying triage labels.
