// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyExecutorService } from '../executor';

const mocks = vi.hoisted(() => ({
  aiGenerateObject: vi.fn(),
  aiModelFind: vi.fn(),
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
  AiModelModel: vi.fn(() => ({ findByIdAndProvider: mocks.aiModelFind })),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({ findById: vi.fn() })),
}));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({ findById: mocks.fileFindById })),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(() => ({ listByRun: mocks.evidenceListByRun })),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({
    createMany: mocks.resultCreateMany,
    listByRun: mocks.resultListByRun,
    updateByCheckItem: mocks.resultUpdateByCheckItem,
  })),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({ ensureForOperation: mocks.runEnsureForOperation })),
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(() => ({ generateObject: mocks.aiGenerateObject })),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({ getFileAccessUrl: mocks.fileAccessUrl })),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(() => ({
    markVerifying: mocks.statusMarkVerifying,
    recompute: mocks.statusRecompute,
  })),
}));

describe('VerifyExecutorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evidenceListByRun.mockResolvedValue([]);
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
});
