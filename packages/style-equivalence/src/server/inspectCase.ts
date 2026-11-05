import type { Browser } from '@playwright/test';

import { ownDifferences } from '../analyze/diff';
import { capturePage, type PageCondition, type SectionSnapshot } from '../capture/runner';
import { compareSnapshots, type StyleSnapshot } from '../capture/snapshot';
import type { CaptureState } from '../capture/states';
import type { ConditionVariant } from '../config';
import { ApiError } from './api';

const STATE = /^(default|hover-chain|hover-target|focus-visible|force(-chain)?:[a-z+-]+)$/;
const VARIANTS = new Set(['reduced-motion', 'rtl']);

export const parseCondition = (label: string | null): PageCondition => {
  const [theme, width, state, variant] = (label ?? '').split('/');
  const pixels = Number(width);
  if (
    !theme ||
    !/^[\w-]+$/.test(theme) ||
    !Number.isInteger(pixels) ||
    pixels < 200 ||
    pixels > 4000
  )
    throw new ApiError(400, 'INVALID_CONDITION');
  if (!STATE.test(state ?? '') || (variant && !VARIANTS.has(variant)))
    throw new ApiError(400, 'INVALID_CONDITION');
  return {
    state: state as CaptureState,
    theme,
    variant: variant as ConditionVariant | undefined,
    width: pixels,
  };
};

export const parseCombo = (value: string | null) => {
  const combo = Number(value ?? 0);
  if (!Number.isInteger(combo) || combo < 0 || combo > 4096)
    throw new ApiError(400, 'INVALID_COMBO');
  return combo;
};

const isSnapshot = (
  value: SectionSnapshot | undefined,
): value is StyleSnapshot & { targetKey?: string } => Boolean(value && !('error' in value));

interface CaseRequest {
  browser: Browser;
  combo: number;
  condition: PageCondition;
  key: string;
  url: string;
}

const pageUrl = (url: string, side: 'base' | 'head', key: string, combo: number) =>
  `${url}/${side}/?case=${encodeURIComponent(key)}&combo=${combo}`;

const sectionOf = async (request: CaseRequest, side: 'base' | 'head') => {
  const errors: string[] = [];
  const { page, snapshots } = await capturePage(
    request.browser,
    pageUrl(request.url, side, request.key, request.combo),
    request.condition,
    errors,
  );
  await page.close();
  return snapshots[`${request.key}|${request.combo}`];
};

const targetOf = (snapshot: SectionSnapshot | undefined) => {
  if (!isSnapshot(snapshot))
    return { error: snapshot ? (snapshot as { error: string }).error : 'CASE_NOT_RENDERED' };
  const targetKey = snapshot.targetKey ?? 'root';
  const node = snapshot.nodes.find((item) => item.key === targetKey);
  return {
    target: node && {
      box: node.box,
      key: node.key,
      tag: node.tag,
      values: snapshot.styles[node.style],
    },
    targetKey,
  };
};

export const caseSnapshot = async (request: CaseRequest) => {
  const [base, head] = await Promise.all([sectionOf(request, 'base'), sectionOf(request, 'head')]);
  const all =
    isSnapshot(base) && isSnapshot(head)
      ? ownDifferences(compareSnapshots(base, head), base.targetKey ?? 'root')
      : [];
  return {
    base: targetOf(base),
    differences: all.filter((item) => !item.diagnosticReason),
    head: targetOf(head),
    ignored: all
      .filter((item) => item.diagnosticReason)
      .map(({ diagnosticReason, key, property }) => ({ key, property, reason: diagnosticReason! })),
  };
};

export const caseShot = async (request: CaseRequest & { side: 'base' | 'head' }) => {
  const errors: string[] = [];
  const { page } = await capturePage(
    request.browser,
    pageUrl(request.url, request.side, request.key, request.combo),
    request.condition,
    errors,
  );
  try {
    const section = page.locator(
      `[data-case="${`${request.key}|${request.combo}`.replaceAll('"', '\\"')}"]`,
    );
    if (!(await section.count())) throw new ApiError(404, 'CASE_NOT_RENDERED');
    return await section.screenshot({ animations: 'disabled' });
  } finally {
    await page.close();
  }
};
