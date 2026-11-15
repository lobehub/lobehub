import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { agentPassRecord, asksAgentNote } from '../review/state';
import { writeReviews } from '../review/store';
import type { StoredRun } from '../server/api';
import { reviewPayload, reviewState } from '../server/review';

const shortKey = (key: string) => key.slice(key.indexOf('|') + 1);

const header = (stored: StoredRun) => {
  const pr = stored.run.pr as { branch?: string; number?: number; title?: string } | undefined;
  const range = `${String(stored.run.base ?? '').slice(0, 7)}..${String(stored.run.head ?? '').slice(0, 7)}`;
  return pr?.number ? `#${pr.number} ${pr.title ?? ''}（${pr.branch ?? ''}）${range}` : range;
};

export const reworkList = async (stored: StoredRun, format: 'json' | 'text' = 'text') => {
  const payload = await reviewPayload(stored);
  const open = payload.items.filter((item) => item.state === 'reworked' && item.rework);
  if (format === 'json')
    return JSON.stringify({ items: open, pr: payload.pr, run: payload.run }, null, 2);
  if (!open.length) return `${header(stored)}\n没有未处理的打回。`;
  return [
    header(stored),
    ...open.map((item) =>
      [
        `- ${shortKey(item.key)}（${item.title}）`,
        `  文件：${item.file}`,
        `  原因：${item.rework!.note}`,
        ...(item.summary.length ? [`  工具看到：${item.summary.join('；')}`] : []),
        ...(item.differingConditions.length
          ? [`  不一致的条件：${item.differingConditions.slice(0, 6).join(', ')}`]
          : []),
      ].join('\n'),
    ),
  ].join('\n');
};

export const annotateList = async (stored: StoredRun) => {
  const payload = await reviewPayload(stored);
  return payload.items.filter(asksAgentNote).map((item) => ({
    ask: item.ask,
    component: item.component,
    file: item.file,
    flags: item.flags,
    hash: item.hash,
    key: item.key,
    source: {
      base: `git show ${String(stored.run.base ?? '')}:${item.file}`,
      head: `git show ${String(stored.run.head ?? '')}:${item.file}`,
    },
    state: item.state,
    title: item.title,
  }));
};

export interface NoteInput {
  finding: string;
  key: string;
  suggestion: 'pass' | 'rework';
}

export const applyNotes = async (stored: StoredRun, notes: NoteInput[]) => {
  const { items } = await reviewState(stored);
  const now = new Date().toISOString();
  for (const note of notes) {
    const item = items.find((entry) => entry.key === note.key);
    if (!item) throw new Error(`UNKNOWN_CASE:${note.key}`);
    if (!note.finding?.trim()) throw new Error(`FINDING_REQUIRED:${note.key}`);
    if (note.suggestion !== 'pass' && note.suggestion !== 'rework')
      throw new Error(`INVALID_SUGGESTION:${note.key}`);
    const pass = note.suggestion === 'pass' ? agentPassRecord(item, note.finding, now) : undefined;
    await writeReviews(stored.recordsDir, item.file, {
      notes: [
        {
          at: now,
          finding: note.finding.trim(),
          hash: item.hash,
          key: item.key,
          suggestion: note.suggestion,
        },
      ],
      ...(pass ? { passes: [pass] } : {}),
    });
  }
};

export const latestRunForPr = async (recordsDir: string, pr: number) => {
  const runs = (await readdir(recordsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const run of runs) {
    try {
      const meta = JSON.parse(await readFile(path.join(recordsDir, run, 'run.json'), 'utf8'));
      if (meta.pr?.number === pr) return path.join(recordsDir, run);
    } catch {
      continue;
    }
  }
  throw new Error(`NO_RUN_FOR_PR:${pr}`);
};
