import type { Context } from 'hono';

/**
 * Composio OAuth callback.
 *
 * Composio uses managed auth — the provider token exchange happens on Composio's
 * side, so this route does not exchange any code itself. It only lands the user
 * back from the provider and closes the popup. The opener window detects the
 * close and polls `composio.getConnection` to pick up the now-active connection
 * and sync its tools.
 */
export const composioOAuthCallback = async (c: Context) => {
  const status = c.req.query('status');
  const oauthError = c.req.query('error');

  // Composio appends `status=success` / `status=failed` to the callback URL.
  const success = !oauthError && status !== 'failed';

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Composio authorization</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; text-align: center;">
    <p>${success ? 'Authorization complete. You can close this window.' : 'Authorization failed.'}</p>
    <script>
      (function () {
        setTimeout(function () { window.close(); }, 300);
      })();
    </script>
  </body>
</html>`;

  return c.html(html);
};
