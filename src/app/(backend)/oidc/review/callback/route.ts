import { siteReviewFromResource } from '@lobechat/const';
import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { OIDCService } from '@/server/services/oidc';

const log = debug('lobe-oidc:review-callback');

const scriptJson = (value: unknown) =>
  JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');

const page = (script: string) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>LobeHub Review</title><body><script>${script};window.close();</script></body>`,
    { headers: { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' } },
  );

const REPORTED_ERRORS = ['access_denied', 'invalid_target'];

// Query values never enter the HTML: the page reads `code`, `state` and `error` from its own URL,
// so nothing the requester controls is reflected into the response.
const READ_QUERY = 'var q=new URLSearchParams(location.search)';

// A refusal carries no secret and the provider's error redirect does not say which page asked,
// so it goes to any opener; the SDK still matches it against its own state.
const deniedPage = () =>
  page(
    `${READ_QUERY};window.opener&&window.opener.postMessage({error:${scriptJson(REPORTED_ERRORS)}.indexOf(q.get("error"))<0?"error":q.get("error"),state:q.get("state"),type:"lobehub-review:denied"},"*")`,
  );

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  if (error && state) return deniedPage();
  if (!code || !state) return page('');

  try {
    const oidcService = await OIDCService.initialize();
    const site = siteReviewFromResource(await oidcService.findAuthorizationCodeResource(code));
    if (!site) return page('');
    // The target origin comes from the authorization code itself, never from
    // the query, so a copied tag on another origin cannot receive the code.
    return page(
      `${READ_QUERY};window.opener&&window.opener.postMessage({code:q.get("code"),state:q.get("state"),type:"lobehub-review:authorized"},${scriptJson(site.origin)})`,
    );
  } catch (error) {
    log('review callback failed: %O', error);
    return page('');
  }
}
