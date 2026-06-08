export const getWorkspaceMemberRemovedEmailTemplate = (params: {
  reason: 'downgrade' | 'removed_by_owner';
  workspaceName: string;
}) => {
  const { workspaceName, reason } = params;

  const isDowngrade = reason === 'downgrade';

  const subject = isDowngrade
    ? `You have been removed from ${workspaceName} on LobeHub`
    : `You have been removed from ${workspaceName} on LobeHub`;

  const heading = isDowngrade
    ? `Removed from <strong>${workspaceName}</strong>`
    : `Removed from <strong>${workspaceName}</strong>`;

  const body = isDowngrade
    ? `The workspace <strong>${workspaceName}</strong> has been downgraded, and all team members have been removed as a result. Your personal data and workspaces are not affected.`
    : `The owner of <strong>${workspaceName}</strong> has removed you from the workspace. Your personal data and workspaces are not affected.`;

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
          ${heading}
        </h1>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.6;">
        <p style="margin: 0 0 24px 0;">
          ${body}
        </p>

        <!-- Info Note -->
        <div style="background-color: #f0f9ff; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #bae6fd;">
          <p style="color: #0c4a6e; font-size: 14px; margin: 0; text-align: center;">
            If you believe this was a mistake, please contact the workspace owner.
          </p>
        </div>
      </div>

      <!-- Divider -->
      <div style="border-top: 1px solid #e5e7eb; margin: 32px 0;"></div>

      <!-- Footer note -->
      <div style="text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">
          You can continue using LobeHub with your personal workspace.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px;">
      <p style="color: #a1a1aa; font-size: 13px; margin: 0;">
        This is an automated message from LobeHub.
      </p>
    </div>
  </div>
</body>
</html>
    `,
    subject,
    text: isDowngrade
      ? `The workspace "${workspaceName}" has been downgraded, and all team members have been removed as a result. Your personal data and workspaces are not affected. If you believe this was a mistake, please contact the workspace owner.`
      : `The owner of "${workspaceName}" has removed you from the workspace. Your personal data and workspaces are not affected. If you believe this was a mistake, please contact the workspace owner.`,
  };
};
