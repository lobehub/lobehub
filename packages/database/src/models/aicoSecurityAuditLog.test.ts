import { describe, expect, it, vi } from 'vitest';

describe('AicoSecurityAuditLogModel', () => {
  it('inserts audit rows without secrets in the call site contract', async () => {
    const returning = vi.fn().mockResolvedValue([{ action: 'org.member.remove', id: 'a1' }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert };

    const { AicoSecurityAuditLogModel } = await import('./aicoSecurityAuditLog');
    const model = new AicoSecurityAuditLogModel(db as never);
    const row = await model.create({
      action: 'org.member.remove',
      actorUserId: 'u1',
      metadata: { memberId: 'm1' },
      organizationId: 'o1',
      result: 'success',
    });

    expect(row.id).toBe('a1');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'org.member.remove',
        metadata: { memberId: 'm1' },
        organizationId: 'o1',
      }),
    );
    const payload = values.mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toMatch(/otp|sk-or-|password/i);
  });
});
