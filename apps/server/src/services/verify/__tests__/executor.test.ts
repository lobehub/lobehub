// @vitest-environment node
import { terminalRecord } from '@lobechat/utils/verify/terminalEvidence.fixture';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyExecutorService } from '../executor';

const mocks = vi.hoisted(() => ({
  aiGenerateObject: vi.fn(),
  aiModelFind: vi.fn(),
  documentFindByIds: vi.fn(),
  evidenceListByRun: vi.fn(),
  fileAccessUrl: vi.fn(),
  fileFindById: vi.fn(),
  resultCreateMany: vi.fn(),
  resultListByRun: vi.fn(),
  resultUpdateByCheckItem: vi.fn(),
  runEnsureForOperation: vi.fn(),
  statusMarkVerifying: vi.fn(),
  statusRecompute: vi.fn(),
}));

vi.mock('@lobechat/model-runtime', () => ({
  getModelPropertyWithFallback: vi.fn(async () => ({ vision: false })),
}));
vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: vi.fn(function () {
    return { findByIdAndProvider: mocks.aiModelFind };
  }),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findById: vi.fn(), findByIds: mocks.documentFindByIds };
  }),
}));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return { findById: mocks.fileFindById };
  }),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { listByRun: mocks.evidenceListByRun };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return {
      createMany: mocks.resultCreateMany,
      listByRun: mocks.resultListByRun,
      updateByCheckItem: mocks.resultUpdateByCheckItem,
    };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return { ensureForOperation: mocks.runEnsureForOperation };
  }),
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(function () {
    return { generateObject: mocks.aiGenerateObject };
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { getFileAccessUrl: mocks.fileAccessUrl };
  }),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return {
      markVerifying: mocks.statusMarkVerifying,
      recompute: mocks.statusRecompute,
    };
  }),
}));

describe('VerifyExecutorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evidenceListByRun.mockResolvedValue([]);
    mocks.documentFindByIds.mockResolvedValue([]);
    mocks.aiModelFind.mockResolvedValue({ abilities: { vision: false } });
    mocks.fileAccessUrl.mockResolvedValue('https://files.example/image.png');
    mocks.fileFindById.mockResolvedValue({
      fileType: 'image/png',
      id: 'file-1',
      url: 'evidence/image.png',
    });
    mocks.resultCreateMany.mockResolvedValue(undefined);
    mocks.resultListByRun
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ checkItemId: 'word-count', status: 'pending' }]);
    mocks.resultUpdateByCheckItem.mockResolvedValue(undefined);
    mocks.statusMarkVerifying.mockResolvedValue(undefined);
    mocks.statusRecompute.mockResolvedValue('verifying');
  });

  it('leaves a check carried into a repair round alone and judges the repaired one', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-2',
      plan: [
        { id: 'carried', index: 0, required: true, title: 'List', verifierType: 'agent' },
        { id: 'repaired', index: 1, required: true, title: 'Reader', verifierType: 'agent' },
      ],
      planConfirmedAt: new Date(),
    });
    mocks.resultListByRun.mockReset().mockResolvedValue([
      {
        checkItemId: 'carried',
        metadata: { carriedFrom: { checkResultId: 'r1', roundIndex: 1, verifyRunId: 'run-1' } },
        status: 'passed',
      },
    ]);
    mocks.evidenceListByRun.mockResolvedValue([
      {
        checkItemId: 'carried',
        content: 'diff',
        metadata: { carriedFromEvidenceId: 'e1' },
        type: 'text',
      },
      { checkItemId: 'repaired', content: 'fix', metadata: null, type: 'text' },
    ]);
    const runVerifierAgent = vi.fn().mockResolvedValue({ verifierOperationId: 'verifier-op' });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'Fixed the reader; no other change this round.',
      goal: 'ship it',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'repair-op',
      runVerifierAgent,
    });

    expect(runVerifierAgent).toHaveBeenCalledTimes(1);
    expect(runVerifierAgent).toHaveBeenCalledWith(
      expect.objectContaining({ checkItem: expect.objectContaining({ id: 'repaired' }) }),
    );
    expect(mocks.resultUpdateByCheckItem).not.toHaveBeenCalledWith(
      'run-2',
      'carried',
      expect.anything(),
    );
  });

  it('judges a carried check again once the builder evidences it in the repair round', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-2',
      plan: [{ id: 'carried', index: 0, required: true, title: 'List', verifierType: 'agent' }],
      planConfirmedAt: new Date(),
    });
    mocks.resultListByRun.mockReset().mockResolvedValue([
      {
        checkItemId: 'carried',
        metadata: { carriedFrom: { checkResultId: 'r1', roundIndex: 1, verifyRunId: 'run-1' } },
        status: 'passed',
      },
    ]);
    mocks.evidenceListByRun.mockResolvedValue([
      { checkItemId: 'carried', metadata: { carriedFromEvidenceId: 'e1' }, type: 'text' },
      { checkItemId: 'carried', content: 'new run log', metadata: null, type: 'text' },
    ]);
    const runVerifierAgent = vi.fn().mockResolvedValue({ verifierOperationId: 'verifier-op' });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'done',
      goal: 'ship it',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'repair-op',
      runVerifierAgent,
    });

    expect(mocks.resultUpdateByCheckItem).toHaveBeenCalledWith(
      'run-2',
      'carried',
      expect.objectContaining({
        metadata: { reopenedFrom: { checkResultId: 'r1', roundIndex: 1, verifyRunId: 'run-1' } },
        status: 'pending',
        verdict: null,
      }),
    );
    expect(runVerifierAgent).toHaveBeenCalledWith(
      expect.objectContaining({ checkItem: expect.objectContaining({ id: 'carried' }) }),
    );
  });

  it('runs a program criterion through the verifier-agent fallback', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        {
          id: 'word-count',
          index: 0,
          required: true,
          title: '字数达标',
          verifierType: 'program',
        },
      ],
      planConfirmedAt: new Date(),
    });
    const runVerifierAgent = vi.fn().mockResolvedValue({ verifierOperationId: 'verifier-op-1' });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'story',
      goal: 'write a story',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'builder-op-1',
      runVerifierAgent,
    });

    expect(runVerifierAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        checkItem: expect.objectContaining({ id: 'word-count', verifierType: 'program' }),
        operationId: 'builder-op-1',
      }),
    );
    expect(mocks.resultUpdateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'word-count',
      expect.objectContaining({ status: 'running', verifierOperationId: 'verifier-op-1' }),
    );
  });

  it('lets the verifier agent resolve deliverable-scoped documents without uploaded run evidence', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        {
          id: 'document-check',
          index: 0,
          onFail: 'auto_repair',
          required: true,
          title: 'Document',
          verifierConfig: {
            requiredEvidence: [{ modality: 'text', scope: 'deliverable', type: 'markdown' }],
          },
          verifierType: 'llm',
        },
      ],
      planConfirmedAt: new Date(),
    });
    const runVerifierAgent = vi.fn().mockResolvedValue({ verifierOperationId: 'verifier-op-doc' });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'document link',
      goal: 'verify document',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'builder-op-doc',
      runVerifierAgent,
    });

    expect(runVerifierAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        checkItem: expect.objectContaining({ id: 'document-check' }),
      }),
    );
    expect(mocks.resultUpdateByCheckItem).not.toHaveBeenCalledWith(
      'run-1',
      'document-check',
      expect.objectContaining({ verdict: 'uncertain' }),
    );
  });

  it('points a missing run-evidence item at a submit command it can run as-is', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        {
          id: 'shot-check',
          index: 0,
          onFail: 'auto_repair',
          required: true,
          title: 'Screenshot',
          verifierConfig: {
            requiredEvidence: [{ modality: 'image', scope: 'run_evidence', type: 'screenshot' }],
          },
          verifierType: 'llm',
        },
      ],
      planConfirmedAt: new Date(),
    });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'ui change',
      goal: 'verify ui',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'builder-op-shot',
      runVerifierAgent: vi.fn().mockResolvedValue({ verifierOperationId: 'verifier-op-shot' }),
    });

    expect(mocks.resultUpdateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'shot-check',
      expect.objectContaining({
        suggestion: expect.stringContaining(
          'lh acceptance run result submit --operation "$LOBEHUB_OPERATION_ID" --item shot-check --type screenshot',
        ),
        verdict: 'uncertain',
      }),
    );
  });

  it('asks for chapters when the missing run evidence is a video', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        {
          id: 'video-check',
          index: 0,
          onFail: 'auto_repair',
          required: true,
          title: 'Recording',
          verifierConfig: {
            requiredEvidence: [{ modality: 'video', scope: 'run_evidence', type: 'video' }],
          },
          verifierType: 'llm',
        },
      ],
      planConfirmedAt: new Date(),
    });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'ui change',
      goal: 'verify ui',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'builder-op-video',
      runVerifierAgent: vi.fn().mockResolvedValue({ verifierOperationId: 'verifier-op-video' }),
    });

    expect(mocks.resultUpdateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'video-check',
      expect.objectContaining({
        suggestion: expect.stringContaining(
          'lh acceptance run result submit --operation "$LOBEHUB_OPERATION_ID" --item video-check --type video --file <path> --chapters <file>',
        ),
        verdict: 'uncertain',
      }),
    );
  });

  it('routes file-backed text evidence to an agent that can inspect the stored artifact', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        {
          id: 'large-transcript',
          index: 0,
          onFail: 'auto_repair',
          required: true,
          title: 'Large transcript',
          verifierConfig: {
            requiredEvidence: [{ modality: 'text', scope: 'run_evidence', type: 'transcript' }],
          },
          verifierType: 'llm',
        },
      ],
      planConfirmedAt: new Date(),
    });
    mocks.evidenceListByRun.mockResolvedValue([
      {
        checkItemId: 'large-transcript',
        content: null,
        description: 'CLI output exceeding the inline limit',
        fileId: 'file-large-transcript',
        type: 'transcript',
      },
    ]);
    mocks.resultListByRun.mockReset().mockResolvedValue([]);
    const runVerifierAgent = vi.fn().mockResolvedValue({ verifierOperationId: 'verifier-op-text' });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'stored transcript',
      goal: 'verify the complete CLI output',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'builder-op-text',
      runVerifierAgent,
    });

    expect(runVerifierAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        checkItem: expect.objectContaining({ id: 'large-transcript' }),
        evidence: [
          expect.objectContaining({
            fileId: 'file-large-transcript',
            type: 'transcript',
          }),
        ],
      }),
    );
    expect(mocks.aiGenerateObject).not.toHaveBeenCalled();
  });

  it('hydrates document evidence content before sending it to the judge', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        {
          id: 'document-evidence',
          index: 0,
          required: true,
          title: 'Supplier list',
          verifierType: 'llm',
        },
      ],
      planConfirmedAt: new Date(),
    });
    mocks.evidenceListByRun.mockResolvedValue([
      {
        checkItemId: 'document-evidence',
        content: null,
        documentId: 'docs_123',
        type: 'markdown',
      },
    ]);
    mocks.documentFindByIds.mockResolvedValue([
      { content: '# Suppliers\n- Vendor A: $100', id: 'docs_123' },
    ]);
    mocks.resultListByRun.mockReset().mockResolvedValue([]);
    mocks.aiGenerateObject.mockResolvedValue({
      confidence: 1,
      evidence: 'supplier and quote listed',
      reasoning: 'document contains both fields',
      verdict: 'passed',
    });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'supplier report',
      goal: 'find supplier quotes',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'builder-op-doc',
    });

    expect(mocks.documentFindByIds).toHaveBeenCalledWith(['docs_123']);
    expect(mocks.aiGenerateObject.mock.calls[0][0].messages[1].content).toContain(
      '# Suppliers\n- Vendor A: $100',
    );
  });

  it('falls back to single-item judging when a batch omits a check id', async () => {
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        { id: 'a', index: 0, required: true, title: 'A', verifierType: 'llm' },
        { id: 'b', index: 1, required: true, title: 'B', verifierType: 'llm' },
      ],
      planConfirmedAt: new Date(),
    });
    mocks.resultListByRun.mockReset().mockResolvedValue([]);
    mocks.aiGenerateObject
      .mockResolvedValueOnce({
        verdicts: [
          { checkItemId: 'a', confidence: 1, evidence: 'ok', reasoning: 'ok', verdict: 'passed' },
        ],
      })
      .mockResolvedValueOnce({
        confidence: 1,
        evidence: 'ok',
        reasoning: 'ok',
        verdict: 'passed',
      });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'done',
      goal: 'ship',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'op-1',
    });

    expect(mocks.aiGenerateObject).toHaveBeenCalledTimes(2);
    expect(mocks.resultUpdateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'b',
      expect.objectContaining({ status: 'passed' }),
    );
  });

  it('loads screenshot content into a vision-model message', async () => {
    mocks.aiModelFind.mockResolvedValue({ abilities: { vision: true } });
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        {
          id: 'visual',
          index: 0,
          required: true,
          title: 'Visual',
          verifierConfig: {
            requiredEvidence: [{ modality: 'image', scope: 'run_evidence', type: 'screenshot' }],
          },
          verifierType: 'llm',
        },
      ],
      planConfirmedAt: new Date(),
    });
    mocks.evidenceListByRun.mockResolvedValue([
      {
        checkItemId: 'visual',
        description: 'screen',
        fileId: 'file-1',
        type: 'screenshot',
      },
    ]);
    mocks.resultListByRun.mockReset().mockResolvedValue([]);
    mocks.aiGenerateObject.mockResolvedValue({
      confidence: 1,
      evidence: 'visible',
      reasoning: 'visible',
      verdict: 'passed',
    });

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'done',
      goal: 'ship',
      modelConfig: { model: 'vision-model', provider: 'provider' },
      operationId: 'op-1',
    });

    const request = mocks.aiGenerateObject.mock.calls[0][0];
    expect(request.messages[1].content).toContainEqual({
      image_url: { detail: 'high', url: 'https://files.example/image.png' },
      type: 'image_url',
    });
  });

  it('gates an execution requirement on provenance and points the repair at a real capture', async () => {
    const plan = [
      {
        id: 'cli',
        index: 0,
        required: true,
        title: 'CLI lists agents',
        verifierConfig: { requiredEvidence: [{ provenance: 'execution', type: 'terminal' }] },
        verifierType: 'llm',
      },
    ];
    mocks.runEnsureForOperation.mockResolvedValue({
      id: 'run-1',
      plan,
      planConfirmedAt: new Date(),
    });
    // An authored example has the right medium but no execution behind it.
    mocks.evidenceListByRun.mockResolvedValue([
      {
        checkItemId: 'cli',
        content: '$ lh agent list',
        metadata: {
          terminal: terminalRecord({
            capture: { ...terminalRecord().capture, mode: 'import' },
            source: { kind: 'authored' },
          }),
        },
        type: 'terminal',
      },
    ]);
    mocks.resultListByRun.mockReset().mockResolvedValue([]);

    await new VerifyExecutorService({} as never, 'user-1').execute({
      deliverable: 'done',
      goal: 'ship',
      modelConfig: { model: 'model', provider: 'provider' },
      operationId: 'op-1',
    });

    expect(mocks.aiGenerateObject).not.toHaveBeenCalled();
    expect(mocks.resultUpdateByCheckItem).toHaveBeenCalledWith(
      'run-1',
      'cli',
      expect.objectContaining({
        suggestion: expect.stringContaining(
          'Run the command for real and publish it as terminal evidence (captured or imported, not authored).',
        ),
        toulmin: {
          limitation: 'Required evidence not provided: terminal from a real command execution.',
        },
        verdict: 'uncertain',
      }),
    );
  });
});
