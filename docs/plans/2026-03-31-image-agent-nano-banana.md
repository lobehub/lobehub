# Image Agent Nano Banana Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch the preset image-generation shared agent to `google/gemini-2.5-flash-image` locally.

**Architecture:** Update the preset source of truth and keep the existing shared-agent sync path responsible for reconciling stored records. Only the preset definition and its focused sync tests need changes.

**Tech Stack:** TypeScript, Vitest, shared agent preset sync

---

### Task 1: Update preset source

**Files:**

- Modify: `src/server/services/user/presetAgents.ts`

**Step 1: Write the failing test**

- Existing sync test already encodes the expected preset values.

**Step 2: Run test to verify it fails**
Run: `bunx vitest run --silent='passed-only' 'src/server/services/sharedAgent/syncPresetSharedAgents.test.ts'`

**Step 3: Write minimal implementation**

- Change the preset `provider` to `google`
- Change the preset `model` to `gemini-2.5-flash-image`

**Step 4: Run test to verify it passes**
Run: `bunx vitest run --silent='passed-only' 'src/server/services/sharedAgent/syncPresetSharedAgents.test.ts'`

### Task 2: Align focused tests

**Files:**

- Modify: `src/server/services/sharedAgent/syncPresetSharedAgents.test.ts`

**Step 1: Update assertions**

- Expect the image preset to use `google/gemini-2.5-flash-image`

**Step 2: Run focused tests**
Run: `bunx vitest run --silent='passed-only' 'src/server/services/sharedAgent/syncPresetSharedAgents.test.ts' 'src/server/services/agent/index.test.ts'`
