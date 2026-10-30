/**
 * @vitest-environment happy-dom
 *
 * The offline report keeps the reader's decisions in the browser until they are
 * saved, and forgets each one only once a re-rendered page carries it.
 */
import type {
  LocalAcceptanceSource,
  LocalReviewEvent,
} from '@lobechat/utils/verify/localAcceptance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = (reviews: LocalReviewEvent[] = []): LocalAcceptanceSource => ({
  acceptance: {
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'acc-1',
    requirement: 'Rename keeps the title',
    subjectKey: 'standalone-rename',
  },
  format: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  reviews,
  rounds: [
    {
      dir: '20260101-000000-first',
      evidence: [],
      proposal: null,
      report: null,
      results: [
        {
          checkItemId: 'rename',
          checkItemIndex: 0,
          checkItemTitle: 'Rename keeps the title',
          createdAt: '2026-01-01T00:00:00.000Z',
          id: 'result-1',
          metadata: null,
          required: true,
          suggestion: null,
          toulmin: null,
          verdict: 'passed',
        },
      ],
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
});

const accept: LocalReviewEvent = {
  action: 'accept',
  createdAt: '2026-01-01T01:00:00.000Z',
  id: 'event-1',
  kind: 'checks',
  roundIndex: 1,
  targets: [{ checkId: 'rename', resultId: 'result-1' }],
};

/** A fresh page load: new document data, new module instance, same localStorage. */
const openPage = async (data: LocalAcceptanceSource) => {
  document.body.innerHTML = `<script id="acceptance-local-data" type="application/json">${JSON.stringify(data)}</script>`;
  vi.resetModules();
  const { getLocalReport } = await import('./localReportData');
  return getLocalReport();
};

describe('local report data', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('holds a decision across reloads until it is saved', async () => {
    const page = await openPage(source());
    page.append(accept);
    expect(page.bundle().checks[0]!.userReview).toMatchObject({ action: 'accept' });
    expect(page.unsavedCount()).toBe(1);

    page.markExported();
    expect(page.unsavedCount()).toBe(0);
    expect(page.pendingCount()).toBe(1);
    expect(page.exportLog()).toEqual({ acceptanceId: 'acc-1', events: [accept], format: 1 });

    const reloaded = await openPage(source());
    expect(reloaded.pendingCount()).toBe(1);
    expect(reloaded.unsavedCount()).toBe(0);
    expect(reloaded.bundle().checks[0]!.userReview).toMatchObject({ action: 'accept' });
  });

  it('forgets a decision once the re-rendered page carries it', async () => {
    const page = await openPage(source());
    page.append(accept);

    const rerendered = await openPage(source([accept]));
    expect(rerendered.pendingCount()).toBe(0);
    expect(rerendered.exportLog().events).toEqual([accept]);
    expect(rerendered.bundle().checks[0]!.userReview).toMatchObject({ action: 'accept' });
  });

  it('refuses a page without acceptance data', async () => {
    document.body.innerHTML = '';
    vi.resetModules();
    const { getLocalReport } = await import('./localReportData');
    expect(() => getLocalReport()).toThrow('no acceptance data');
  });
});
