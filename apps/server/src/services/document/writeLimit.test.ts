import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkDocumentCharLimit } from '@/business/server/document/writeLimit';

import { assertDocumentWriteWithinLimit, formatDocumentCharLimitMessage } from './writeLimit';

vi.mock('@/business/server/document/writeLimit', () => ({
  checkDocumentCharLimit: vi.fn(),
}));

const check = vi.mocked(checkDocumentCharLimit);

describe('assertDocumentWriteWithinLimit', () => {
  beforeEach(() => {
    check.mockReset();
    check.mockResolvedValue({ allowed: false, limit: 100, plan: 'free' });
  });

  it('refuses a write past the limit with structured error data', async () => {
    const error = await assertDocumentWriteWithinLimit({ charCount: 150, userId: 'u1' }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.cause).toMatchObject({
      data: { actual: 150, code: 'DocumentCharLimitExceeded', limit: 100, plan: 'free' },
    });
    expect(error.message).toContain('150 characters');
    expect(error.message).toContain('100-character limit');
    expect(check).toHaveBeenCalledWith({
      charCount: 150,
      source: 'user',
      userId: 'u1',
      workspaceId: undefined,
    });
  });

  it('passes when the slot allows the write', async () => {
    check.mockResolvedValue({ allowed: true });
    await expect(
      assertDocumentWriteWithinLimit({ charCount: 150, userId: 'u1' }),
    ).resolves.toBeUndefined();
  });

  it('skips system writes without asking the slot', async () => {
    await assertDocumentWriteWithinLimit({ charCount: 150, source: 'system', userId: 'u1' });
    expect(check).not.toHaveBeenCalled();
  });

  it('lets a write that does not make the document longer through', async () => {
    await assertDocumentWriteWithinLimit({ charCount: 150, previousCharCount: 200, userId: 'u1' });
    await assertDocumentWriteWithinLimit({ charCount: 200, previousCharCount: 200, userId: 'u1' });
    expect(check).not.toHaveBeenCalled();
  });

  it('checks a write that grows a document already over the limit', async () => {
    await expect(
      assertDocumentWriteWithinLimit({ charCount: 201, previousCharCount: 200, userId: 'u1' }),
    ).rejects.toThrow(TRPCError);
  });
});

describe('formatDocumentCharLimitMessage', () => {
  it('omits the plan when there is none and never groups digits', () => {
    const message = formatDocumentCharLimitMessage({ actual: 1_234_567, limit: 500_000 });
    expect(message).toBe(
      'Document is too long: 1234567 characters, over the 500000-character limit per document. ' +
        'Split the content into several documents or shorten it.',
    );
  });
});
