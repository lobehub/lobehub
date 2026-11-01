# Email Service

A flexible email service implementation supporting multiple email providers.

## Architecture

Based on the search service pattern, this service provides a unified interface for sending emails across different providers.

```plaintext
EmailService
  └── EmailServiceImpl (interface)
      └── NodemailerImpl (SMTP provider)
```

## Usage

### Basic Example

```typescript
import { EmailService } from '@/server/services/email';

const emailService = new EmailService();

// Send a simple text email
await emailService.sendMail({
  from: 'noreply@example.com',
  to: 'user@example.com',
  subject: 'Welcome to LobeChat',
  text: 'Thanks for signing up!',
  html: '<p>Thanks for signing up!</p>',
});
```

### With Multiple Recipients

```typescript
await emailService.sendMail({
  from: 'team@example.com',
  to: ['user1@example.com', 'user2@example.com'],
  subject: 'Team Update',
  text: 'Check out our latest updates',
});
```

### With Attachments

```typescript
await emailService.sendMail({
  from: 'support@example.com',
  to: 'user@example.com',
  subject: 'Your Invoice',
  text: 'Please find your invoice attached.',
  attachments: [
    {
      filename: 'invoice.pdf',
      path: '/path/to/invoice.pdf',
    },
  ],
});
```

### With Reply-To Address

```typescript
await emailService.sendMail({
  from: 'noreply@example.com',
  replyTo: 'support@example.com',
  to: 'user@example.com',
  subject: 'Contact Us',
  text: 'Reply to this email for support.',
});
```

## Configuration

### Environment Variables

Configure SMTP settings using environment variables:

```bash
# SMTP Server Configuration
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false # true for port 465, false for other ports
SMTP_USER=your-username
SMTP_PASS=your-password
```

### Resend

If you prefer Resend, configure the following and initialize the service with `EmailImplType.Resend`:

```bash
RESEND_API_KEY=your-resend-api-key
RESEND_FROM=noreply@example.com
```

`RESEND_FROM` is used when `from` is not provided in the payload.

### Choose Provider by Environment

Set `EMAIL_SERVICE_PROVIDER` to `nodemailer` or `resend` to pick the default implementation without changing code:

```bash
EMAIL_SERVICE_PROVIDER=resend
```

### Using Well-Known Services

You can also use well-known email services (Gmail, SendGrid, etc.):

```typescript
import { EmailImplType, EmailService } from '@/server/services/email';
import { NodemailerImpl } from '@/server/services/email/impls/nodemailer';

const emailService = new EmailService(EmailImplType.Nodemailer);
// Configure in constructor with service name
```

### Testing with Ethereal

For development and testing, use [Ethereal Email](https://ethereal.email/):

```typescript
// The preview URL will be logged automatically in development
const result = await emailService.sendMail({...});
console.log('Preview URL:', result.previewUrl);
```

## Verify Connection

Before sending emails, verify your SMTP configuration:

```typescript
import { EmailService } from '@/server/services/email';

const emailService = new EmailService();

try {
  await emailService.verify();
  console.log('SMTP connection verified ✓');
} catch (error) {
  console.error('SMTP verification failed:', error);
}
```

## Integration with Better-Auth

Example integration for email verification:

```typescript
import { betterAuth } from 'better-auth';

import { EmailService } from '@/server/services/email';

export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    sendResetPasswordEmail: async ({ user, url }) => {
      const emailService = new EmailService();

      await emailService.sendMail({
        from: 'noreply@lobechat.com',
        to: user.email,
        subject: 'Reset Your Password',
        text: `Click here to reset your password: ${url}`,
        html: `
          <h1>Reset Your Password</h1>
          <p>Click the link below to reset your password:</p>
          <a href="${url}">Reset Password</a>
        `,
      });
    },
  },
  emailVerification: {
    enabled: true,
    sendVerificationEmail: async ({ user, url }) => {
      const emailService = new EmailService();

      await emailService.sendMail({
        from: 'noreply@lobechat.com',
        to: user.email,
        subject: 'Verify Your Email',
        text: `Click here to verify your email: ${url}`,
        html: `
          <h1>Verify Your Email</h1>
          <p>Click the link below to verify your email address:</p>
          <a href="${url}">Verify Email</a>
        `,
      });
    },
  },
});
```

## Adding New Providers

To add a new email provider (e.g., Resend, SendGrid):

1. Create provider implementation in `impls/[provider-name]/index.ts`:

```typescript
import { EmailPayload, EmailResponse, EmailServiceImpl } from '../type';

export class ResendImpl implements EmailServiceImpl {
  async sendMail(payload: EmailPayload): Promise<EmailResponse> {
    // Implement using Resend API
  }
}
```

2. Add to the enum in `impls/index.ts`:

```typescript
export enum EmailImplType {
  Nodemailer = 'nodemailer',
  Resend = 'resend', // Add new provider
}
```

3. Update factory function in `impls/index.ts`:

```typescript
export const createEmailServiceImpl = (type: EmailImplType) => {
  switch (type) {
    case EmailImplType.Nodemailer:
      return new NodemailerImpl();
    case EmailImplType.Resend:
      return new ResendImpl();
    default:
      return new NodemailerImpl();
  }
};
```

## Error Handling

The service throws `TRPCError` for various failure scenarios:

```typescript
try {
  await emailService.sendMail({...});
} catch (error) {
  if (error.code === 'SERVICE_UNAVAILABLE') {
    // Handle SMTP connection issues
  } else if (error.code === 'PRECONDITION_FAILED') {
    // Handle configuration errors
  }
}
```

## Debugging

Enable debug logging:

```bash
DEBUG=lobe-email:* node your-app.js
```

This will log detailed information about email sending operations.
