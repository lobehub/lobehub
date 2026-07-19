import { getEmailSupportHtml, getEmailSupportText } from '@/libs/email/support';

/**
 * Password reset email template
 * Sent to users when they request a password reset
 */
export const getResetPasswordEmailTemplate = (params: { url: string }) => {
  const { url } = params;

  return {
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5; color: #1a1a1a;">
  <!-- Container -->
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    
    <!-- Logo -->
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-flex; align-items: center; justify-content: center; background-color: #ffffff; border-radius: 12px; padding: 8px 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
        <span style="font-size: 24px; line-height: 1; margin-right: 10px;">🤯</span>
        <span style="font-size: 18px; font-weight: 700; color: #000000; letter-spacing: -0.5px;">LobeHub</span>
      </div>
    </div>

    <!-- Card -->
    <div style="background: #ffffff; border-radius: 20px; padding: 40px; box-shadow: 0 8px 30px rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.02);">
      
      <!-- Header -->
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #111827; font-size: 24px; font-weight: 700; margin: 0 0 12px 0; letter-spacing: -0.5px;">
          Reset Your Password
        </h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0; line-height: 1.5;">
          No worries, we'll help you get back on track.
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.6;">
        <p style="margin: 0 0 24px 0; text-align: center;">
          You recently requested to reset your password for your LobeHub account. Click the button below to proceed.
        </p>

        <!-- Button -->
        <div style="text-align: center; margin: 32px 0;">
          <a href="${url}" target="_blank"
             style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-weight: 600; font-size: 16px; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            Reset Password
          </a>
        </div>

        <!-- Security Note -->
        <div style="background-color: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #f3f4f6;">
          <p style="color: #6b7280; font-size: 13px; margin: 0; text-align: center; line-height: 1.5;">
            🔒 If you did not request a password reset, please ignore this email or contact support if you have concerns.
          </p>
        </div>
      </div>

      <!-- Divider -->
      <div style="border-top: 1px solid #e5e7eb; margin: 32px 0;"></div>

      <!-- Fallback Link -->
      <div style="text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0 0 8px 0;">
          Trouble clicking the button? Copy and paste the URL below:
        </p>
        <a href="${url}" style="color: #2563eb; font-size: 13px; text-decoration: none; word-break: break-all; display: block; line-height: 1.4;">
          ${url}
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px;">
      <p style="font-size: 13px; margin: 0 0 8px 0;">
        ${getEmailSupportHtml()}
      </p>
      <p style="color: #a1a1aa; font-size: 13px; margin: 0;">
        © ${new Date().getFullYear()} LobeHub. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
    `,
    subject: 'Reset Your Password - LobeHub',
    text: `Reset your password by clicking this link: ${url}\n\n${getEmailSupportText()}`,
  };
};
