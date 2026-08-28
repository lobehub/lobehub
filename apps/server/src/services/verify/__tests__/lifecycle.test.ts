import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveVerificationDeliverable } from '../lifecycle';

const { findByIdMock, getPinnedDocumentsMock } = vi.hoisted(() => ({
  findByIdMock: vi.fn(),
  getPinnedDocumentsMock: vi.fn(),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn().mockImplementation(() => ({ findById: findByIdMock })),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(() => ({
    getPinnedDocuments: getPinnedDocumentsMock,
  })),
}));

describe('resolveVerificationDeliverable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the original deliverable for runs without a task', async () => {
    const deliverable = await resolveVerificationDeliverable({} as any, 'user-1', 'done');

    expect(deliverable).toBe('done');
    expect(getPinnedDocumentsMock).not.toHaveBeenCalled();
  });

  it('includes the actual contents of documents associated with the task', async () => {
    getPinnedDocumentsMock.mockResolvedValue([
      { documentId: 'docs-report' },
      { documentId: 'docs-board' },
    ]);
    findByIdMock
      .mockResolvedValueOnce({
        content: '# Report\nSemantic evidence is readable.',
        id: 'docs-report',
        title: 'Report',
      })
      .mockResolvedValueOnce({
        content: '<svg><text>PASS</text></svg>',
        id: 'docs-board',
        title: 'Status board',
      });

    const deliverable = await resolveVerificationDeliverable(
      {} as any,
      'user-1',
      'Created the requested documents.',
      'task-1',
    );

    expect(getPinnedDocumentsMock).toHaveBeenCalledWith('task-1');
    expect(deliverable).toContain('Created the requested documents.');
    expect(deliverable).toContain('## Task document: Report');
    expect(deliverable).toContain('Semantic evidence is readable.');
    expect(deliverable).toContain('## Task document: Status board');
    expect(deliverable).toContain('<svg><text>PASS</text></svg>');
  });

  it('ignores missing or empty associated documents', async () => {
    getPinnedDocumentsMock.mockResolvedValue([
      { documentId: 'docs-missing' },
      { documentId: 'docs-empty' },
    ]);
    findByIdMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      content: '',
      id: 'docs-empty',
      title: 'Empty',
    });

    const deliverable = await resolveVerificationDeliverable(
      {} as any,
      'user-1',
      'original',
      'task-1',
    );

    expect(deliverable).toBe('original');
  });
});
