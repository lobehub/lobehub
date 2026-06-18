/**
 * Workspace invitation email template
 * Sent when a workspace owner invites someone (by email) to join their workspace.
 */
export const getWorkspaceInviteEmailTemplate = (params: {
  expiresInDays: number;
  inviterEmail?: string | null;
  inviterName?: string | null;
  role: string;
  url: string;
  workspaceName: string;
}) => {
  const { url, workspaceName, inviterName, inviterEmail, role, expiresInDays } = params;

  const inviterLabel = inviterName || inviterEmail || 'A teammate';
  const inviterByline =
    inviterEmail && inviterName ? `${inviterName} (${inviterEmail})` : inviterLabel;
  const subject = `${inviterLabel} invited you to join ${workspaceName} on LobeHub`;
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  return {
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5; color: #1a1a1a;">
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
          Join <strong>${workspaceName}</strong> on LobeHub
        </h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0;">
          You've been invited as a <strong>${roleLabel}</strong>.
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.6;">
        <p style="margin: 0 0 24px 0;">
          <strong>${inviterByline}</strong> has invited you to collaborate inside the
          <strong>${workspaceName}</strong> workspace on LobeHub.
        </p>

        <!-- Button -->
        <div style="text-align: center; margin: 36px 0;">
          <a href="${url}" target="_blank"
             style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            Join the team
          </a>
        </div>

        <!-- Expiration Note -->
        <div style="background-color: #fffbeb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #fde68a;">
          <p style="color: #92400e; font-size: 14px; margin: 0; text-align: center;">
            ⏰ This invitation will expire in <strong>${expiresInDays} day${expiresInDays > 1 ? 's' : ''}</strong>.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 15px; margin: 0;">
          If you don't have a LobeHub account yet, you'll be guided through a quick signup before joining the workspace.
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
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>
    `,
    subject,
    text: `${inviterByline} has invited you to join the "${workspaceName}" workspace on LobeHub as ${roleLabel}.\n\nAccept the invitation: ${url}\n\nThis invitation will expire in ${expiresInDays} day${expiresInDays > 1 ? 's' : ''}.\n\nIf you weren't expecting this invitation, you can safely ignore this email.`,
  };
};
