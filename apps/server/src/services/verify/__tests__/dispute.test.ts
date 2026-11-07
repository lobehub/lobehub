// @vitest-environment node
import { HOLISTIC_CHECK_TITLE } from '@lobechat/const/verify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { fileCheckDispute } from '../dispute';

const mocks = vi.hoisted(() => ({
  acceptance: vi.fn(),
  document: vi.fn(),
  evidence: vi.fn(),
  generate: vi.fn(),
  listByAcceptance: vi.fn(),
  listByRuns: vi.fn(),
  panel: vi.fn(),
  run: vi.fn(),
  runById: vi.fn(),
  findResult: vi.fn(),
  write: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      findById: mocks.runById,
      findByOperation: mocks.run,
      listByAcceptance: mocks.listByAcceptance,
    };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return {
      findById: mocks.findResult,
      listByRuns: mocks.listByRuns,
      upsertByCheckItem: mocks.upsert,
      writeDisputeIfOpen: mocks.write,
    };
  }),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { listByCheckResult: mocks.evidence };
  }),
}));
vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(function () {
    return { findById: mocks.acceptance };
  }),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findById: mocks.document };
  }),
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(function () {
    return { generateObject: mocks.generate };
  }),
}));
vi.mock('../goalReviewModelConfig', () => ({
  DISPUTE_PANEL_SIZE: 3,
  resolveDisputePanelModelConfigs: mocks.panel,
}));

const db = {} as LobeChatDatabase;
const item = {
  id: 'c2',
  index: 1,
  required: true,
  sourceCriterionId: 'crit-2',
  title: 'Exports a PDF',
  verifierType: 'agent',
};
const panel = [
  { model: 'a', provider: 'pa' },
  { model: 'b', provider: 'pb' },
  { model: 'c', provider: 'pc' },
];
const file = (params: Partial<Parameters<typeof fileCheckDispute>[2]> = {}) =>
  fileCheckDispute(
    db,
    'u1',
    {
      checkItemId: 'c2',
      kind: 'invalid_criterion',
      reason: 'The requirement only asks for an on-screen report; PDF export is never mentioned.',
      runOperationId: 'op1',
      ...params,
    },
    'w1',
  );
/** Answer each panel member (keyed by model) with a fixed ruling or a failure. */
const rule = (rulings: Record<string, boolean | 'fail'>) =>
  mocks.generate.mockImplementation(async ({ model }: { model: string }) => {
    const ruling = rulings[model];
    if (ruling === 'fail') throw new Error('provider down');
    return { reason: `${model} says ${ruling}`, upheld: ruling };
  });
const savedDispute = () => mocks.write.mock.calls.at(-1)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({
    acceptanceId: 'a1',
    id: 'r2',
    plan: [{ ...item, id: 'c1', index: 0, title: 'Shows the report' }, item],
  });
  mocks.upsert.mockResolvedValue({ id: 'res2', metadata: { visualization: 'kept' } });
  mocks.write.mockResolvedValue({ id: 'res2' });
  mocks.runById.mockImplementation(async () => mocks.run());
  mocks.listByAcceptance.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
  mocks.listByRuns.mockResolvedValue([]);
  mocks.acceptance.mockResolvedValue({ config: {}, requirement: 'Show a sales report' });
  mocks.evidence.mockResolvedValue([{ id: 'e1' }]);
  mocks.panel.mockResolvedValue(panel);
});

describe('fileCheckDispute — invalid criterion', () => {
  it('waives the check when the panel majority upholds it', async () => {
    rule({ a: true, b: true, c: false });

    const result = await file();

    expect(result).toMatchObject({ success: true });
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(savedDispute()).toMatchObject({
      arbitration: { outcome: 'upheld' },
      kind: 'invalid_criterion',
    });
    // The check is claimed before the panel runs, and only that claim writes the ruling.
    const [claimCall, rulingCall] = mocks.write.mock.calls;
    expect(claimCall[1].arbitratingSince).toEqual(expect.any(String));
    expect(rulingCall[2].holder).toBe(claimCall[1].arbitratingSince);
    expect(rulingCall[1].arbitratingSince).toBeUndefined();
    expect(result.message).toContain('waived');
  });

  it('keeps the check when the majority overrules it, even with a member down', async () => {
    rule({ a: false, b: 'fail', c: false });

    const result = await file();

    expect(savedDispute().arbitration.outcome).toBe('overruled');
    expect(savedDispute().arbitration.votes.find((v: any) => v.model === 'b')).toMatchObject({
      status: 'errored',
    });
    expect(result.message).toContain('stands');
  });

  it('rules nothing without a majority, retrying a failed member only once', async () => {
    rule({ a: true, b: false, c: 'fail' });

    await file();

    expect(savedDispute().arbitration.outcome).toBe('undecided');
    const calls = mocks.generate.mock.calls.map(([params]) => params.model);
    expect(calls.filter((model) => model === 'c')).toHaveLength(2);
    expect(calls.filter((model) => model === 'a')).toHaveLength(1);
  });

  it("puts the builder's argument in front of the panel as data", async () => {
    rule({ a: false, b: false, c: false });

    await file();

    const [{ messages }] = mocks.generate.mock.calls[0];
    expect(messages[1].content).toContain('PDF export is never mentioned');
    expect(messages[1].content).toContain('Show a sales report');
    expect(messages[1].content).toContain('- Shows the report');
  });

  /**
   * A builder that lost a ruling must not re-roll the panel every attempt until
   * one nondeterministic vote goes its way.
   */
  it('refuses a second dispute of a check a panel already overruled', async () => {
    mocks.listByRuns.mockResolvedValue([
      {
        checkItemTitle: 'Exports a PDF',
        id: 'res1',
        metadata: { dispute: { arbitration: { outcome: 'overruled' }, kind: 'invalid_criterion' } },
        sourceCriterionId: 'crit-2',
      },
    ]);

    expect(await file()).toMatchObject({ error: 'ALREADY_RULED', success: false });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('carries an earlier upheld ruling to this round without asking again', async () => {
    const upheld = { decidedAt: 'then', outcome: 'upheld', votes: [] };
    mocks.listByRuns.mockResolvedValue([
      {
        checkItemTitle: 'Exports a PDF',
        id: 'res1',
        metadata: { dispute: { arbitration: upheld, kind: 'invalid_criterion' } },
        sourceCriterionId: 'crit-2',
      },
    ]);

    expect(await file()).toMatchObject({ success: true });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(savedDispute().arbitration).toEqual(upheld);
  });

  it('does not rule with fewer than three panel models', async () => {
    mocks.panel.mockResolvedValue(panel.slice(0, 2));

    expect(await file()).toMatchObject({ error: 'PANEL_UNAVAILABLE', success: false });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(savedDispute().arbitration).toBeUndefined();
  });

  it('never waives the whole-delivery check', async () => {
    mocks.run.mockResolvedValue({
      acceptanceId: 'a1',
      id: 'r2',
      plan: [{ ...item, title: HOLISTIC_CHECK_TITLE }],
    });

    expect(await file()).toMatchObject({ error: 'HOLISTIC_CHECK', success: false });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('rejects a check id outside the round', async () => {
    expect(await file({ checkItemId: 'nope' })).toMatchObject({ error: 'UNKNOWN_CRITERION' });
  });
});

describe('fileCheckDispute — guards', () => {
  /**
   * Regression: a dispute upheld after the round settled only rewrote metadata;
   * the run, the Acceptance and the already-driven Task stayed failed.
   */
  it.each(['passed', 'failed', 'errored', 'repairing', 'delivered'])(
    'refuses a dispute once the round is %s',
    async (status) => {
      mocks.run.mockResolvedValue({ acceptanceId: 'a1', id: 'r2', plan: [item], status });

      expect(await file()).toMatchObject({ error: 'ROUND_SETTLED', success: false });
      expect(mocks.write).not.toHaveBeenCalled();
      expect(mocks.generate).not.toHaveBeenCalled();
    },
  );

  it('refuses a dispute on a round a person already decided', async () => {
    mocks.run.mockResolvedValue({
      acceptanceId: 'a1',
      id: 'r2',
      plan: [item],
      status: 'verifying',
      userDecision: 'accept',
    });

    expect(await file()).toMatchObject({ error: 'ROUND_SETTLED', success: false });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  /**
   * Regression: the round settled while the panel was ruling, and the upheld
   * ruling still landed on a failed, already-driven round.
   */
  it('reports a round that settled while the panel was ruling', async () => {
    rule({ a: true, b: true, c: true });
    // The claim lands; the ruling is refused because the round settled meanwhile.
    mocks.write.mockResolvedValueOnce({ id: 'res2' }).mockResolvedValueOnce(undefined);
    mocks.runById.mockResolvedValue({ id: 'r2', status: 'failed' });

    expect(await file()).toMatchObject({ error: 'ROUND_SETTLED', success: false });
    expect(mocks.generate).toHaveBeenCalledTimes(3);
  });

  it('accepts a dispute while the round is still being worked on or judged', async () => {
    mocks.run.mockResolvedValue({
      acceptanceId: 'a1',
      id: 'r2',
      plan: [item],
      status: 'verifying',
    });
    rule({ a: false, b: false, c: false });

    expect(await file()).toMatchObject({ success: true });
  });

  /**
   * Regression: two concurrent filings both read an open dispute, each ran its
   * own panel, and the last write could reverse the first ruling.
   */
  it('does not roll a second panel while another filing holds the check', async () => {
    mocks.write.mockResolvedValueOnce(undefined);
    mocks.findResult.mockResolvedValue({
      id: 'res2',
      metadata: {
        dispute: {
          arbitratingSince: 'now',
          filedAt: 'now',
          kind: 'invalid_criterion',
          reason: 'x',
        },
      },
    });

    expect(await file()).toMatchObject({ error: 'ARBITRATION_IN_PROGRESS', success: false });
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  /**
   * Regression: flow nodes reusing one criterion asset shared its
   * sourceCriterionId, so one branch's ruling waived or blocked another branch.
   */
  it('keeps rulings of other flow occurrences of the same criterion apart', async () => {
    const node = (id: string, nodeId: string) => ({
      ...item,
      id,
      sourceFlowNode: { flowId: 'f1', nodeId },
    });
    mocks.run.mockResolvedValue({ acceptanceId: 'a1', id: 'r2', plan: [node('c2', 'b')] });
    mocks.listByAcceptance.mockResolvedValue([
      { id: 'r1', plan: [node('c1', 'a')] },
      { id: 'r2', plan: [node('c2', 'b')] },
    ]);
    mocks.listByRuns.mockResolvedValue([
      {
        checkItemId: 'c1',
        checkItemTitle: 'Exports a PDF',
        id: 'res1',
        metadata: { dispute: { arbitration: { outcome: 'overruled' }, kind: 'invalid_criterion' } },
        sourceCriterionId: 'crit-2',
        verifyRunId: 'r1',
      },
    ]);
    rule({ a: true, b: true, c: true });

    // Branch a's overruled ruling does not bind branch b: b gets its own panel.
    expect(await file()).toMatchObject({ success: true });
    expect(savedDispute().arbitration.outcome).toBe('upheld');
  });

  it('still carries a ruling to the same flow occurrence in a later round', async () => {
    const node = { ...item, id: 'c2', sourceFlowNode: { flowId: 'f1', nodeId: 'b' } };
    mocks.run.mockResolvedValue({ acceptanceId: 'a1', id: 'r2', plan: [node] });
    mocks.listByAcceptance.mockResolvedValue([
      { id: 'r1', plan: [node] },
      { id: 'r2', plan: [node] },
    ]);
    mocks.listByRuns.mockResolvedValue([
      {
        checkItemId: 'c2',
        id: 'res1',
        metadata: { dispute: { arbitration: { outcome: 'overruled' }, kind: 'invalid_criterion' } },
        verifyRunId: 'r1',
      },
    ]);

    expect(await file()).toMatchObject({ error: 'ALREADY_RULED' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});

describe('fileCheckDispute — the contract the panel rules on', () => {
  const panelPrompt = () => mocks.generate.mock.calls[0][0].messages[1].content as string;

  /**
   * Regression: arbitration read only the live document, so a structured
   * criterion without one reached the panel with no rules at all.
   */
  it("hands the panel a documentless structured check's frozen definition", async () => {
    mocks.run.mockResolvedValue({
      acceptanceId: 'a1',
      id: 'r2',
      plan: [{ ...item, definition: { expected: 'A PDF opens in the viewer' } }],
    });
    rule({ a: false, b: false, c: false });

    await file();

    expect(panelPrompt()).toContain('A PDF opens in the viewer');
  });

  /**
   * Regression: an edited document made the panel arbitrate different text
   * from the frozen payload the verifier enforced.
   */
  it('rules on the frozen definition, not a document edited after freezing', async () => {
    mocks.run.mockResolvedValue({
      acceptanceId: 'a1',
      id: 'r2',
      plan: [{ ...item, definition: { expected: 'frozen rule' }, documentId: 'doc-1' }],
    });
    mocks.document.mockResolvedValue({ content: 'edited rule' });
    rule({ a: false, b: false, c: false });

    await file();

    expect(panelPrompt()).toContain('frozen rule');
    expect(panelPrompt()).not.toContain('edited rule');
    expect(mocks.document).not.toHaveBeenCalled();
  });

  it('still reads the linked document for a check without a frozen definition', async () => {
    mocks.run.mockResolvedValue({
      acceptanceId: 'a1',
      id: 'r2',
      plan: [{ ...item, documentId: 'doc-1' }],
    });
    mocks.document.mockResolvedValue({ content: 'document rule' });
    rule({ a: false, b: false, c: false });

    await file();

    expect(panelPrompt()).toContain('document rule');
  });

  /**
   * Regression: two checks without provenance that shared a title shared a
   * ruling, so one sibling's ruling waived or blocked the other.
   */
  it('keeps same-titled checks without provenance apart', async () => {
    const bare = { ...item, sourceCriterionId: undefined };
    mocks.run.mockResolvedValue({
      acceptanceId: 'a1',
      id: 'r2',
      plan: [{ ...bare, id: 'c1' }, bare],
    });
    mocks.listByAcceptance.mockResolvedValue([{ id: 'r2', plan: [{ ...bare, id: 'c1' }, bare] }]);
    mocks.listByRuns.mockResolvedValue([
      {
        checkItemId: 'c1',
        checkItemTitle: 'Exports a PDF',
        id: 'res1',
        metadata: { dispute: { arbitration: { outcome: 'overruled' }, kind: 'invalid_criterion' } },
        verifyRunId: 'r2',
      },
    ]);
    rule({ a: true, b: true, c: true });

    expect(await file()).toMatchObject({ success: true });
    expect(savedDispute().arbitration.outcome).toBe('upheld');
  });
});

describe('fileCheckDispute — missed evidence', () => {
  it('records the note for the next review without arbitrating', async () => {
    const result = await file({
      evidenceIds: ['e1'],
      kind: 'missed_evidence',
      reason: 'Screenshot e1 shows the export button.',
    });

    expect(result).toMatchObject({ success: true });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(savedDispute()).toMatchObject({
      evidenceIds: ['e1'],
      kind: 'missed_evidence',
      reason: 'Screenshot e1 shows the export button.',
    });
    expect(savedDispute().arbitration).toBeUndefined();
  });

  /**
   * Regression: a note overwrote the round's ruling, which dropped an upheld
   * waiver and let an overruled check be sent to the panel again.
   */
  it('keeps a ruling already made in this round instead of overwriting it', async () => {
    const ruled = {
      dispute: {
        arbitration: { decidedAt: 'then', outcome: 'overruled', votes: [] },
        filedAt: 'then',
        kind: 'invalid_criterion',
        reason: 'Out of scope',
      },
    };
    mocks.upsert.mockResolvedValue({ id: 'res2', metadata: ruled });
    // The guarded write refuses to replace a decided ruling.
    mocks.write.mockResolvedValue(undefined);
    mocks.findResult.mockResolvedValue({ id: 'res2', metadata: ruled });

    expect(await file({ kind: 'missed_evidence', reason: 'It is there' })).toMatchObject({
      error: 'ALREADY_RULED',
      success: false,
    });

    // Filing the same dispute again answers the ruling rather than re-asking the panel.
    expect(await file()).toMatchObject({ success: true });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('rejects evidence that is not on this check', async () => {
    expect(
      await file({ evidenceIds: ['other'], kind: 'missed_evidence', reason: 'See it' }),
    ).toMatchObject({ error: 'UNKNOWN_EVIDENCE', success: false });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('rejects an empty argument', async () => {
    expect(await file({ kind: 'missed_evidence', reason: '   ' })).toMatchObject({
      error: 'EMPTY_REASON',
    });
  });
});
