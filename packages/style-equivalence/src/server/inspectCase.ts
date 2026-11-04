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

const CROP_PADDING = 16;

interface Rect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export const cropClip = (section: Rect, box: number[], padding: number): Rect => {
  const [x, y, width, height] = box;
  const left = Math.max(section.x, section.x + x - padding);
  const top = Math.max(section.y, section.y + y - padding);
  const right = Math.min(section.x + section.width, section.x + x + width + padding);
  const bottom = Math.min(section.y + section.height, section.y + y + height + padding);
  return { height: bottom - top, width: right - left, x: left, y: top };
};

export const caseShot = async (
  request: CaseRequest & { crop?: boolean; side: 'base' | 'head' },
) => {
  const errors: string[] = [];
  const { page, snapshots } = await capturePage(
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
    const snapshot = snapshots[`${request.key}|${request.combo}`];
    const target = request.crop && isSnapshot(snapshot) ? targetOf(snapshot).target : undefined;
    const origin = target ? await section.boundingBox() : null;
    if (!target || !origin || target.box[2] <= 0 || target.box[3] <= 0)
      return await section.screenshot({ animations: 'disabled' });
    return await page.screenshot({
      animations: 'disabled',
      clip: cropClip(origin, target.box, CROP_PADDING),
    });
  } finally {
    await page.close();
  }
};
