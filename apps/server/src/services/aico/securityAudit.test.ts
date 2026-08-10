import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('@/database/models/aicoSecurityAuditLog', () => ({
  AicoSecurityAuditLogModel: class {
    create = createMock;
  },
}));

describe('recordAicoSecurityEvent', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ id: 'evt_1' });
  });

  it('writes audit events via the model', async () => {
    const { recordAicoSecurityEvent } = await import('./securityAudit');
    await recordAicoSecurityEvent({} as never, {
      action: 'platform.credit.org_add',
      actorUserId: 'user_1',
      organizationId: 'org_1',
      result: 'success',
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.credit.org_add',
        actorUserId: 'user_1',
        organizationId: 'org_1',
      }),
    );
  });

  it('swallows model errors', async () => {
    createMock.mockRejectedValue(new Error('db down'));
    const { recordAicoSecurityEvent } = await import('./securityAudit');
    await expect(
      recordAicoSecurityEvent({} as never, { action: 'platform.org.suspend' }),
    ).resolves.toBeUndefined();
  });
});
