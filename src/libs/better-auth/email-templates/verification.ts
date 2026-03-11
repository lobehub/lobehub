/**
 * Email verification template
 * Sent to users when they sign up to verify their email address
 */
export const getVerificationEmailTemplate = (params: {
  expiresInSeconds: number;
  url: string;
  userName?: string | null;
}) => {
  const { url, userName, expiresInSeconds } = params;

  // Format expiration time in a human-readable way
  const expiresInHours = expiresInSeconds / 3600;
  const expirationText =
    expiresInHours >= 1
      ? `${expiresInHours} hour${expiresInHours > 1 ? 's' : ''}`
      : `${expiresInSeconds / 60} minutes`;

  return {
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email</title>
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
          Verify your email address
        </h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0;">
          Let's get you signed in.
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.6;">
        ${userName ? `<p style="margin: 0 0 16px 0;">Hi <strong>${userName}</strong>,</p>` : ''}
        
        <p style="margin: 0 0 24px 0;">
          Thanks for creating an account with LobeHub. To access your account, please verify your email address by clicking the button below.
        </p>

        <!-- Button -->
        <div style="text-align: center; margin: 36px 0;">
          <a href="${url}" target="_blank"
             style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-weight: 600; font-size: 16px; transition: transform 0.1s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            Verify Email Address
          </a>
        </div>

        <!-- Expiration Note -->
        <div style="background-color: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #f3f4f6;">
          <p style="color: #6b7280; font-size: 14px; margin: 0; text-align: center;">
            ⏰ This link will expire in <strong>${expirationText}</strong>.
          </p>
        </div>
        
        <p style="color: #6b7280; font-size: 15px; margin: 0 0 8px 0;">
          If you didn't create an account, you can safely ignore this email.
        </p>
      </div>

      <!-- Divider -->
      <div style="border-top: 1px solid #e5e7eb; margin: 32px 0;"></div>

      <!-- Fallback Link -->
      <div style="text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0 0 8px 0;">
          Button not working? Copy and paste this link into your browser:
        </p>
        <a href="${url}" style="color: #2563eb; font-size: 13px; text-decoration: none; word-break: break-all; display: block; line-height: 1.4;">
          ${url}
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px;">
      <p style="color: #a1a1aa; font-size: 13px; margin: 0;">
        © 2026 LobeHub. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
    `,
    subject: 'Verify Your Email - LobeHub',
    text: `Please verify your email by clicking this link: ${url}\n\nThis link will expire in ${expirationText}.`,
  };
};
