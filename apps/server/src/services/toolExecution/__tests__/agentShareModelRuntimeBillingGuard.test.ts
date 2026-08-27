import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural guard for agent share billing.
 *
 * `ServerLLMTransport` forwards the share-visitor billing marker into every
 * ordinary `call_llm` step via `buildAgentShareModelRuntimeContext`
 * (`modules/ModelRuntime/index.ts`) so a shared-agent visitor's inference
 * bills the creator's agentShare budget instead of their ordinary personal
 * budget. Any OTHER code path that calls `initModelRuntimeFromDB` — most
 * commonly a tool runtime issuing a nested/secondary model call, such as
 * `lobe-agent`'s `analyzeMedia`, the memory tool's `searchMemory` query
 * embedding, or the knowledge-base tool's `searchKnowledgeBase` query
 * embedding — must route through the exact same helper, or it silently bills
 * the creator's ordinary billing instead and lets a visitor bypass the
 * configured share-spend limit.
 *
 * This exact bug has resurfaced across independent call sites in this PR's
 * review rounds — each fixed only after a reviewer named that specific file
 * (`serverRuntimes/lobeAgent.ts`'s `analyzeMedia`), while sibling nested
 * model-runtime calls (`serverRuntimes/memory.ts`'s `searchMemory`,
 * `services/knowledgeBase/index.ts`'s `semanticSearchForChat`) kept the leak
 * alive. This test does not verify the billing context is correct (that is
 * `ServerLLMTransport.test.ts` / the regression tests next to each fixed call
 * site) — it only makes sure a FUTURE `initModelRuntimeFromDB` call anywhere
 * in the server cannot land silently without threading
 * `buildAgentShareModelRuntimeContext`: a new call site fails this test until
 * a human either wires the helper through or documents in `ALLOWED_FILES`
 * below why that call is not reachable from any tool-runtime / share-visitor
 * code path.
 */
// Keys are relative paths from `apps/server/src`.
const ALLOWED_FILES = new Set([
  // The helper's own home: the two real `initModelRuntimeFromDB` definitions
  // receive their `context` param from every caller (enforced by this test
  // at each *caller*, not here), and the third match is a JSDoc `@example`
  // comment, not a call.
  'modules/ModelRuntime/index.ts',
  // `ServerLLMTransport` already builds the marker via the shared helper —
  // this file IS the canonical call site the doc comment above points at.
  'modules/AgentRuntime/adapters/ServerLLMTransport.ts',
  // Everything below is invoked only from a tRPC router/background job/cron,
  // never from `BuiltinToolsExecutor.execute` (the share-visitor tool
  // dispatch chokepoint) — a share-visitor run has no way to reach these.
  'routers/async/image.ts',
  'routers/async/video.ts',
  'routers/async/file.ts',
  'routers/async/ragEval.ts',
  'routers/lambda/chunk.ts',
  'routers/lambda/asr.ts',
  'routers/lambda/aiProvider.ts',
  'routers/lambda/userMemories.ts',
  'routers/lambda/video/index.ts',
  'services/taskReview/index.ts',
  'services/taskLifecycle/index.ts',
  'services/systemAgent/index.ts',
  'services/aiGeneration/index.ts',
  'services/agentSignal/policies/analyzeIntent/feedbackSatisfaction.ts',
  'services/agentSignal/policies/analyzeIntent/skillIntent.ts',
  'services/agentSignal/policies/analyzeIntent/feedbackDomainAgent.ts',
  'services/generation/videoBackgroundPolling.ts',
]);

const ROOT = path.join(__dirname, '../../../');

const CALL_PATTERN = /initModelRuntimeFromDB\(/g;
const SHARE_CONTEXT_PATTERN = /buildAgentShareModelRuntimeContext\(/;

const listTsFiles = (dir: string): string[] => {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__') continue;

    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
};

/**
 * Extracts the full, paren-balanced argument-list text starting right after
 * `openIndex` (the index of the `(` following `initModelRuntimeFromDB`).
 * Calls span multiple lines in this codebase's formatting, so a simple
 * same-line regex would miss the trailing `context` argument.
 */
const extractCallArgs = (content: string, openIndex: number): string => {
  let depth = 0;
  let i = openIndex;
  for (; i < content.length; i++) {
    if (content[i] === '(') depth++;
    else if (content[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  return content.slice(openIndex, i + 1);
};

describe('agent share model-runtime billing guard', () => {
  it('every initModelRuntimeFromDB call threads buildAgentShareModelRuntimeContext', () => {
    const offenders: string[] = [];

    for (const file of listTsFiles(ROOT)) {
      const relativePath = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOWED_FILES.has(relativePath)) continue;

      const content = readFileSync(file, 'utf8');
      const matches = [...content.matchAll(CALL_PATTERN)];
      if (matches.length === 0) continue;

      for (const match of matches) {
        const openIndex = match.index! + match[0].length - 1;
        const argsText = extractCallArgs(content, openIndex);
        // Some call sites resolve the billing context into a local variable
        // one or two statements above the call (e.g. `lobeAgent.ts`'s
        // `analyzeMedia`) instead of inlining
        // `buildAgentShareModelRuntimeContext(...)` directly as an argument.
        // Accept either shape: the helper referenced directly in the call's
        // own argument list, or referenced anywhere in the ~600 chars
        // immediately preceding the call (same function body, few statements
        // back) — comfortably wider than any real intervening statement, but
        // not so wide it would credit an unrelated call elsewhere in a large
        // file.
        const precedingWindow = content.slice(Math.max(0, match.index! - 600), match.index!);
        if (!SHARE_CONTEXT_PATTERN.test(argsText) && !SHARE_CONTEXT_PATTERN.test(precedingWindow)) {
          offenders.push(`${relativePath}@${match.index}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
