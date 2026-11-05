import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Browser } from '@playwright/test';

import { analyzeRun, type CaseResult } from '../analyze/diff';
import { captureRun } from '../capture/runner';
import { serveDirectories } from '../capture/staticServer';
import { type CorpusExpectation, CSS_CORPUS, cssCorpusPage } from './cssCorpus';

export type CorpusOutcome = CorpusExpectation | 'error' | 'unstable';

export interface CorpusResult {
  actual: CorpusOutcome;
  detail: string[];
  expected: CorpusExpectation;
  feature: string;
  id: string;
  passed: boolean;
}

export const outcomeOf = (result: CaseResult | undefined): CorpusOutcome => {
  if (!result || result.errors.length) return 'error';
  if (result.unstableConditions.length) return 'unstable';
  if (result.status === 'difference') return 'changed';
  return result.gaps.length ? 'flagged' : 'equivalent';
};

const CONCURRENCY = 4;

export const runCssCorpus = async ({ browser, only }: { browser: Browser; only?: string[] }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'style-eq-css-corpus-'));
  const entries = CSS_CORPUS.filter((entry) => !only || only.includes(entry.id));
  for (const entry of entries)
    for (const side of ['before', 'after'] as const) {
      await mkdir(path.join(root, entry.id, side), { recursive: true });
      await writeFile(path.join(root, entry.id, side, 'index.html'), cssCorpusPage(entry, side));
    }
  const server = await serveDirectories(root);
  const results: CorpusResult[] = [];
  try {
    const queue = [...entries];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let entry = queue.shift(); entry; entry = queue.shift()) {
          const capture = await captureRun({
            browser,
            conditions: { themeAttribute: 'data-theme', themes: ['light'], widths: [375, 1280] },
            urls: {
              base: `${server.url}/${entry.id}/before/`,
              head: `${server.url}/${entry.id}/after/`,
            },
          });
          const [result] = analyzeRun(capture);
          const actual = outcomeOf(result);
          results.push({
            actual,
            detail: [
              ...(result?.errors ?? []),
              ...(result?.gaps ?? []),
              ...(result?.differingConditions ?? []),
            ],
            expected: entry.expected,
            feature: entry.feature,
            id: entry.id,
            passed: actual === entry.expected,
          });
        }
      }),
    );
  } finally {
    await server.close();
    await rm(root, { force: true, recursive: true });
  }
  return entries.map((entry) => results.find((result) => result.id === entry.id)!);
};

export interface SelfTestReport {
  css: CorpusResult[];
  passed: boolean;
  source: CorpusResult[];
}

export const formatSelfTest = (report: SelfTestReport) => {
  const count = (results: CorpusResult[]) =>
    `${results.filter((entry) => entry.passed).length}/${results.length}`;
  return [
    `self-test ${report.passed ? 'passed' : 'FAILED'} · CSS corpus ${count(report.css)} · source corpus ${count(report.source)}`,
    ...[...report.css, ...report.source]
      .filter((entry) => !entry.passed)
      .map(
        (entry) =>
          `  ✗ ${entry.id} (${entry.feature})  expected ${entry.expected}, got ${entry.actual}${entry.detail.length ? `  ${entry.detail.slice(0, 3).join(' · ')}` : ''}`,
      ),
  ].join('\n');
};
