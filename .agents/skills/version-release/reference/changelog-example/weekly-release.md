# Patch Release (Weekly) Changelog Example

A real-world changelog reference for weekly patch release PR bodies.

---

This weekly release includes **82 commits**. The throughline is simple: less friction when moving from idea to execution. Across agent workflows, model coverage, and desktop polish, this release removes several small blockers that used to interrupt momentum.

The result is not one headline feature, but a noticeably smoother week-to-week experience. Teams can evaluate agents with clearer structure, ship richer media flows, and spend less time debugging provider and platform edge cases.

## Agent workflows and media generation

Previously, some agent evaluation and media generation flows still felt fragmented: setup was manual, discoverability was uneven, and switching between topics could interrupt context. This release adds **Agent Benchmark** support and lands the **video generation** path end-to-end, from entry point to generation feedback.

In practice, this means users can discover and run these workflows with fewer detours. Sidebar "new" indicators improve visibility, skeleton loading makes topic switches feel less abrupt, and memory-related controls now behave more predictably under real workload pressure.

We also expanded memory controls with effort and tool-permission configuration, and improved timeout calculation for memory analysis tasks so longer runs fail less often in production-like usage.

## Models and provider coverage

Provider diversity matters most when teams can adopt new models without rewriting glue code every sprint. This release adds **Straico** and updates support for Claude Sonnet 4.6, Gemini 3.1 Pro Preview, Qwen3.5, Grok Imagine (`grok-imagine-image`), and MiniMax 2.5.

Use these updates to:

- route requests to newly available providers
- test newer model families without custom patching
- keep model parameters and related i18n copy aligned across providers

This keeps model exploration practical: faster evaluation loops, fewer adaptation surprises, and cleaner cross-provider behavior.

## Desktop and platform polish

Desktop receives a set of quality-of-life upgrades that reduce "death by a thousand cuts" moments. We integrated `electron-liquid-glass` for macOS Tahoe and improved DMG background assets and packaging flow for more consistent release output.

The desktop editor now supports image upload from the file picker, which shortens everyday authoring steps and removes one more reason to switch tools mid-task.

## Improvements and fixes

- Fixed multiple video pipeline issues across precharge refund handling, webhook token verification, pricing parameter usage, asset cleanup, and type safety.
- Fixed path traversal risk in `sanitizeFileName` and added corresponding unit tests.
- Fixed MCP media URL generation when `APP_URL` was duplicated in output paths.
- Fixed Qwen3 embedding failures caused by batch-size limits.
- Fixed several UI interaction issues, including mobile header agent selector/topic count, ChatInput scrolling behavior, and tooltip stacking context.
- Fixed missing `@napi-rs/canvas` native bindings in Docker standalone builds.
- Improved GitHub Copilot authentication retry behavior and response error handling in edge cases.

## Credits

Huge thanks to these contributors (alphabetical):

@AmAzing129 @Coooolfan @Innei @ONLY-yours @Zhouguanyang @arvinxx @eaten-cake @hezhijie0327 @nekomeowww @rdmclin2 @rivertwilight @sxjeru @tjx666
