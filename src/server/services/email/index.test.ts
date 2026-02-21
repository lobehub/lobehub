import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmailServiceImpl,EmailImplType } from './impls';
import { EmailService } from './index';

// Mock dependencies
vi.mock('./impls');

describe('EmailService', () => {
  let emailService: EmailService;
  let mockEmailImpl: ReturnType<typeof createMockEmailImpl>;

  function createMockEmailImpl() {
    return {
      sendMail: vi.fn(),
      verify: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailImpl = createMockEmailImpl();
    vi.mocked(createEmailServiceImpl).mockReturnValue(mockEmailImpl as any);
    emailService = new EmailService();
  });

  describe('constructor', () => {
    it('should create instance with default email implementation', () => {
      expect(createEmailServiceImpl).toHaveBeenCalledWith(EmailImplType.Nodemailer);
    });

    it('should create instance with specified implementation type', () => {
      emailService = new EmailService(EmailImplType.Nodemailer);
      expect(createEmailServiceImpl).toHaveBeenCalledWith(EmailImplType.Nodemailer);
    });
  });

  describe('sendMail', () => {
    it('should call emailImpl.sendMail with correct payload', async () => {
      const mockResponse = {
        messageId: 'test-message-id',
        previewUrl: 'https://ethereal.email/message/xxx',
      };
      mockEmailImpl.sendMail.mockResolvedValue(mockResponse);

      const payload = {
        from: 'sender@example.com',
        html: '<p>Hello world</p>',
        subject: 'Test Email',
        text: 'Hello world',
        to: 'recipient@example.com',
      };

      const result = await emailService.sendMail(payload);

      expect(mockEmailImpl.sendMail).toHaveBeenCalledWith(payload);
      expect(result).toBe(mockResponse);
    });

    it('should support multiple recipients', async () => {
      const mockResponse = {
        messageId: 'test-message-id',
      };
      mockEmailImpl.sendMail.mockResolvedValue(mockResponse);

      const payload = {
        from: 'sender@example.com',
        subject: 'Test Email',
        text: 'Hello world',
        to: ['recipient1@example.com', 'recipient2@example.com'],
      };

      await emailService.sendMail(payload);

      expect(mockEmailImpl.sendMail).toHaveBeenCalledWith(payload);
    });

    it('should support attachments', async () => {
      const mockResponse = {
        messageId: 'test-message-id',
      };
      mockEmailImpl.sendMail.mockResolvedValue(mockResponse);

      const payload = {
        attachments: [
          {
            content: Buffer.from('test content'),
            filename: 'test.txt',
          },
        ],
        from: 'sender@example.com',
        subject: 'Test Email',
        text: 'Hello world',
        to: 'recipient@example.com',
      };

      await emailService.sendMail(payload);

      expect(mockEmailImpl.sendMail).toHaveBeenCalledWith(payload);
    });

    it('should support reply-to address', async () => {
      const mockResponse = {
        messageId: 'test-message-id',
      };
      mockEmailImpl.sendMail.mockResolvedValue(mockResponse);

      const payload = {
        from: 'noreply@example.com',
        replyTo: 'support@example.com',
        subject: 'Test Email',
        text: 'Hello world',
        to: 'recipient@example.com',
      };

      await emailService.sendMail(payload);

      expect(mockEmailImpl.sendMail).toHaveBeenCalledWith(payload);
    });
  });

  describe('verify', () => {
    it('should call emailImpl.verify if available', async () => {
      mockEmailImpl.verify.mockResolvedValue(true);

      const result = await emailService.verify();

      expect(mockEmailImpl.verify).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return true if verify method is not available', async () => {
      const mockImplWithoutVerify = {
        sendMail: vi.fn(),
      };
      vi.mocked(createEmailServiceImpl).mockReturnValue(mockImplWithoutVerify as any);
      emailService = new EmailService();

      const result = await emailService.verify();

      expect(result).toBe(true);
    });
  });
});
