/**
 * Optional real-model evaluation for change-impact analysis (Cascade direction).
 *
 * Unit tests use a scripted model; this script runs the *same prompt and
 * validator* against a real model and checks the outcome the design document
 * asks for: the 「最终验收 → 分阶段验收」 edit must surface the payment trigger,
 * the warranty start and the delivery obligation on termination, while keeping
 * direct wording changes apart from semantic impacts.
 *
 * Usage (from apps/server):
 *   bun scripts/evalDocumentReviewImpact.ts --claude
 *   bun scripts/evalDocumentReviewImpact.ts --claude --record ./impact-eval.json
 *   EVAL_OPENAI_API_KEY=... bun scripts/evalDocumentReviewImpact.ts --openai
 *   bun scripts/evalDocumentReviewImpact.ts --input ./recorded-answer.json
 *
 * `--claude` shells out to the local Claude Code CLI; `--openai` calls any
 * OpenAI-compatible chat-completions endpoint (EVAL_OPENAI_BASE_URL,
 * EVAL_MODEL). Without a model it is a no-op, so it is safe to wire into CI.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  chainDocumentReviewImpact,
  DOCUMENT_REVIEW_IMPACT_JSON_SCHEMA,
  DOCUMENT_REVIEW_IMPACT_PROMPT_VERSION,
  DOCUMENT_REVIEW_IMPACT_SCHEMA_NAME,
} from '@lobechat/prompts';

import {
  BASELINE_CONTRACT,
  CURRENT_CONTRACT,
  editorDataFromText,
} from '../src/services/documentReviewImpact/__tests__/fixtures';
import { computeTextDiff, formatDiffBlocks } from '../src/services/documentReviewImpact/diff';
import type { DocumentImpactError } from '../src/services/documentReviewImpact/errors';
import { parseImpactAnalysisResponse } from '../src/services/documentReviewImpact/schema';
import {
  buildAnchor,
  extractDocumentText,
  textFromEditorData,
} from '../src/services/documentReviewImpact/text';

interface EvalItem {
  category: string;
  confidence?: number;
  kind: string;
  relatedStatus: 'invalid' | 'located' | 'missing';
  sourceStatus: 'invalid' | 'located';
  title: string;
}

const args = process.argv.slice(2);
const mode = args.includes('--claude') ? 'claude' : args.includes('--openai') ? 'openai' : 'input';
const valueOf = (flag: string) => args.find((arg) => arg.startsWith(`${flag}=`))?.split('=')[1];
const inputPath = valueOf('--input');
const recordPath = valueOf('--record');

const baselineText = textFromEditorData(editorDataFromText(BASELINE_CONTRACT));
const currentText = extractDocumentText({ editorData: editorDataFromText(CURRENT_CONTRACT) });
const diff = computeTextDiff(baselineText, currentText);
const chain = chainDocumentReviewImpact({
  baselineText,
  currentText,
  diff: formatDiffBlocks(diff.blocks),
  documentTitle: '技术服务采购合同',
});
const [systemMessage, userMessage] = chain.messages;

/**
 * Claude often narrates before/after the answer and may correct itself. Collect
 * every balanced JSON object and keep the last one that parses — for a model
 * that says "that was wrong, here is the corrected output", the last object is
 * the answer.
 */
const extractJson = (raw: string): unknown => {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) candidates.push(raw.slice(start, index + 1));
    }
  }

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // keep looking at earlier candidates
    }
  }

  return raw;
};

const callClaude = (): { model: string; response: unknown } => {
  const prompt = `${systemMessage.content}\n\n${userMessage.content}`;
  const model = process.env.EVAL_MODEL;
  const cliArgs = ['-p', '--output-format', 'text', '--tools', ''];
  if (model) cliArgs.push('--model', model);
  const result = spawnSync(
    process.env.CLAUDE_CLI ?? `${process.env.HOME}/.local/bin/claude`,
    cliArgs,
    {
      encoding: 'utf8',
      input: prompt,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `claude exited ${result.status}`);
  return { model: model ?? 'claude-code-default', response: extractJson(result.stdout) };
};

const callOpenAi = async (): Promise<{ model: string; response: unknown }> => {
  const apiKey = process.env.EVAL_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Set EVAL_OPENAI_API_KEY (or OPENAI_API_KEY) for --openai');
  const baseUrl = process.env.EVAL_OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.EVAL_MODEL ?? 'gpt-4o-mini';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    body: JSON.stringify({
      messages: [systemMessage, userMessage],
      model,
      response_format: {
        json_schema: {
          name: DOCUMENT_REVIEW_IMPACT_SCHEMA_NAME,
          schema: DOCUMENT_REVIEW_IMPACT_JSON_SCHEMA.schema,
          strict: true,
        },
        type: 'json_schema',
      },
    }),
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw new Error(`provider ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return { model, response: extractJson(body.choices?.[0]?.message?.content ?? '') };
};

const loadRecorded = (path: string): unknown => {
  const raw = readFileSync(path, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return parsed.response ?? parsed;
  } catch {
    return extractJson(raw);
  }
};

const main = async () => {
  let model = 'recorded';
  let response: unknown;

  if (mode === 'claude') {
    ({ model, response } = callClaude());
  } else if (mode === 'openai') {
    ({ model, response } = await callOpenAi());
  } else {
    if (!inputPath) {
      console.log('No model selected. Pass --claude, --openai, or --input=<file>.');
      return;
    }
    response = loadRecorded(inputPath);
  }

  let parsed;
  try {
    parsed = parseImpactAnalysisResponse(response);
  } catch (error) {
    const impactError = error as DocumentImpactError;
    console.error(`SCHEMA_INVALID: ${impactError.message}`);
    console.error(JSON.stringify(impactError.details ?? {}, null, 2));
    console.error('--- raw response ---');
    console.error(JSON.stringify(response, null, 2));
    process.exitCode = 1;
    return;
  }

  const items: EvalItem[] = parsed.items.map((item) => ({
    category: item.category,
    confidence: item.confidence,
    kind: item.kind,
    relatedStatus: item.relatedQuote
      ? buildAnchor(currentText, item.relatedQuote)
        ? 'located'
        : 'invalid'
      : 'missing',
    sourceStatus: buildAnchor(currentText, item.sourceQuote) ? 'located' : 'invalid',
    title: item.title,
  }));

  const has = (pattern: RegExp, category?: string) =>
    items.some(
      (item) =>
        pattern.test(item.title) &&
        (!category || item.category === category) &&
        (item.relatedStatus === 'located' || item.sourceStatus === 'located'),
    );

  const checks = [
    { label: '付款触发条件（semantic）', pass: has(/付款|支付/, 'semantic') },
    { label: '质保起算时间（semantic）', pass: has(/质保|保修/, 'semantic') },
    { label: '终止时交付义务（semantic）', pass: has(/终止|解除/, 'semantic') },
    {
      label: '直接文字差异与语义影响分开',
      pass:
        items.some((item) => item.category === 'textual') &&
        items.some((item) => item.category === 'semantic'),
    },
    {
      label: '每个触发锚点都能在当前正文定位',
      pass: items.every((item) => item.sourceStatus === 'located'),
    },
  ];

  console.log(`model: ${model}`);
  console.log(
    `prompt: ${DOCUMENT_REVIEW_IMPACT_SCHEMA_NAME} ${DOCUMENT_REVIEW_IMPACT_PROMPT_VERSION} · diff blocks: ${diff.blocks.length}`,
  );
  console.log('\n| 标题 | 类别 | 类型 | 置信度 | 触发锚点 | 关联锚点 |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const item of items) {
    console.log(
      `| ${item.title} | ${item.category} | ${item.kind} | ${item.confidence?.toFixed(2) ?? '-'} | ${item.sourceStatus} | ${item.relatedStatus} |`,
    );
  }
  console.log('\nchecks:');
  for (const check of checks) console.log(`${check.pass ? '✓' : '✗'} ${check.label}`);

  const pass = checks.every((check) => check.pass);
  console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exitCode = 1;

  if (recordPath) {
    writeFileSync(
      recordPath,
      JSON.stringify(
        {
          checks,
          model,
          promptVersion: DOCUMENT_REVIEW_IMPACT_PROMPT_VERSION,
          recordedAt: new Date().toISOString(),
          response,
        },
        null,
        2,
      ),
    );
    console.log(`recorded → ${recordPath}`);
  }
};

await main();
