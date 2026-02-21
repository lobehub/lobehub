# Patch Release (Weekly) Changelog Example

A real-world changelog reference for weekly patch release PR bodies.

---

This release includes **82 commits** , Key updates are below.

### New Features and Enhancements

- Added **Agent Benchmark** support for more systematic agent performance evaluation.
- Introduced the **video generation** feature end-to-end, including entry points, sidebar "new" badge support, and skeleton loading for topic switching.
- Expanded memory capabilities: support for memory effort/tool permission configuration and improved timeout calculation for memory analysis tasks.
- Added desktop editor support for image upload via file picker.

### Models and Provider Expansion

- Added a new provider: **Straico**.
- Added/updated support for:
  - Claude Sonnet 4.6
  - Gemini 3.1 Pro Preview
  - Qwen3.5 series
  - Grok Imagine (`grok-imagine-image`)
  - MiniMax 2.5
- Added related i18n copy and model parameter adaptations.

### Desktop Improvements

- Integrated `electron-liquid-glass` (macOS Tahoe).
- Improved DMG background assets and desktop release workflow.

### Stability, Security, and UX Fixes

- Fixed multiple video generation pipeline issues: precharge refund handling, webhook token verification, pricing parameter usage, asset cleanup, and type safety.
- Fixed `sanitizeFileName` path traversal risks and added unit tests.
- Fixed MCP media URL generation with duplicated `APP_URL` prefix.
- Fixed Qwen3 embedding failures caused by batch-size limits.
- Fixed multiple UI/interaction issues, including mobile header agent selector/topic count, ChatInput scrolling behavior, and tooltip stacking context.
- Fixed missing `@napi-rs/canvas` native bindings in Docker standalone builds.
- Improved GitHub Copilot authentication retry behavior and response error handling in edge cases.

### Credits

Huge thanks to these contributors (alphabetical):

@AmAzing129 @Coooolfan @Innei @ONLY-yours @Zhouguanyang @arvinxx @eaten-cake @hezhijie0327 @nekomeowww @rdmclin2 @rivertwilight @sxjeru @tjx666
