/**
 * @vitest-environment happy-dom
 *
 * The offline report reads the discussion through the same verify store hooks
 * and selectors as the hosted page, so the stub has to provide them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { LocalAcceptanceSource } from '@lobechat/utils/verify/localAcceptance';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectStubUsage, parseStubSurface, stubUsageGaps } from '../../../app/stubs/surface';

const source: LocalAcceptanceSource = {
  acceptance: {
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'acc-1',
    requirement: 'Rename keeps the title',
    subjectKey: 'standalone-rename',
  },
  format: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  reviews: [],
  rounds: [
    {
      dir: '20260101-000000-first',
      evidence: [],
      proposal: 'Rename now keeps the title after a reload.',
      report: null,
      results: [],
      run: {
        context: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        goal: null,
        id: 'run-1',
        metadata: null,
        plan: null,
        roundIndex: 1,
        scenario: 'coding',
        title: 'Rename',
      },
    },
  ],
};

const openPage = async () => {
  document.body.innerHTML = `<script id="acceptance-local-data" type="application/json">${JSON.stringify(source)}</script>`;
  vi.resetModules();
  return import('./verifyStore');
};

describe('local verify store discussion', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('serves the page discussion as already confirmed', async () => {
    const { useVerifyStore, verifySelectors } = await openPage();
    const state = useVerifyStore.getState();

    const comments = verifySelectors.acceptanceComments('acc-1')(state);
    expect(comments?.canComment).toBe(false);
    expect(comments?.items).toHaveLength(1);
    expect(verifySelectors.isAcceptanceCommentsConfirmed('acc-1')(state)).toBe(true);
    expect(verifySelectors.acceptanceComments('other')(state)).toBeUndefined();
    expect(state.useFetchAcceptanceComments('acc-1').error).toBeUndefined();
  });

  it('covers every verify store API the comment list reads', () => {
    const root = path.resolve(import.meta.dirname, '../../../../..');
    const hook = readFileSync(
      path.join(root, 'src/features/Acceptance/Viewer/Comments/useAcceptanceCommentList.ts'),
      'utf8',
    );
    const stub = readFileSync(path.join(import.meta.dirname, 'verifyStore.ts'), 'utf8');

    const usage = collectStubUsage(hook, '@/store/verify');
    expect(usage).not.toBeNull();
    expect(stubUsageGaps(parseStubSurface(stub), usage!)).toEqual([]);
  });
});
