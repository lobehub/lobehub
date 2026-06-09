import { type NextRequest, NextResponse } from 'next/server';

import { appEnv } from '@/envs/app';

/** Origin allowed to receive the postMessage result (the app itself). */
const targetOrigin = (): string => {
  try {
    return appEnv.APP_URL ? new URL(appEnv.APP_URL).origin : '*';
  } catch {
    return '*';
  }
};

/**
 * Serialize a value for safe embedding inside an inline `<script>`. Plain
 * JSON.stringify does NOT escape `</script>` or the U+2028/U+2029 line
 * separators, so an attacker-controlled OAuth error string could break out of
 * the script context. Escaping `<`, `>`, `&` and the JS line separators to
 * their `\uXXXX` form closes that hole.
 */
const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replaceAll(
    /[<>&  ]/g,
    (c) => '\\u' + c.codePointAt(0)!.toString(16).padStart(4, '0'),
  );

/**
 * Composio OAuth callback.
 *
 * Composio uses managed auth — the provider token exchange happens on Composio's
 * side, so this route does not exchange any code itself. It only lands the user
 * back from the provider and closes the popup. The opener window detects the
 * close (or the postMessage below) and polls `composio.getConnection` to pick up
 * the now-active connection and sync its tools.
 */
export const GET = async (req: NextRequest) => {
  const searchParams = req.nextUrl.searchParams;
  const status = searchParams.get('status') ?? undefined;
  const connectedAccountId =
    searchParams.get('connectedAccountId') ?? searchParams.get('connected_account_id') ?? undefined;
  const oauthError = searchParams.get('error') ?? undefined;

  // Composio appends `status=success` / `status=failed` to the callback URL.
  const success = !oauthError && status !== 'failed';
  const payload = jsonForScript({
    connectedAccountId,
    error: oauthError,
    status,
    success,
    type: 'lobe-composio-oauth',
  });

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Composio authorization</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; text-align: center;">
    <p>${success ? 'Authorization complete. You can close this window.' : 'Authorization failed.'}</p>
    <script>
      (function () {
        try {
          if (window.opener) {
            window.opener.postMessage(${payload}, ${jsonForScript(targetOrigin())});
          }
        } catch (e) {}
        setTimeout(function () { window.close(); }, 300);
      })();
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};
