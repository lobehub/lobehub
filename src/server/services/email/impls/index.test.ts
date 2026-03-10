import { describe, expect, it, vi } from 'vitest';

import { createEmailServiceImpl,EmailImplType } from './index';

vi.mock('./nodemailer', () => ({
  NodemailerImpl: vi.fn().mockImplementation(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
    verify: vi.fn().mockResolvedValue(true),
  })),
}));

describe('createEmailServiceImpl', () => {
  it('should create NodemailerImpl by default', () => {
    const impl = createEmailServiceImpl();

    expect(impl).toBeDefined();
    expect(impl.sendMail).toBeDefined();
  });

  it('should create NodemailerImpl when explicitly specified', () => {
    const impl = createEmailServiceImpl(EmailImplType.Nodemailer);

    expect(impl).toBeDefined();
    expect(impl.sendMail).toBeDefined();
  });

  it('should fall back to NodemailerImpl for unknown type', () => {
    const impl = createEmailServiceImpl('unknown' as EmailImplType);

    expect(impl).toBeDefined();
    expect(impl.sendMail).toBeDefined();
  });
});

describe('EmailImplType enum', () => {
  it('should have Nodemailer as a valid type', () => {
    expect(EmailImplType.Nodemailer).toBe('nodemailer');
  });
});
