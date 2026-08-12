export interface Classification {
  /**
   * True when the issue is a marketplace listing request we auto-handle:
   * new-server submission, rescan/refresh of an existing listing, etc.
   * Product bugs and CLI feedback stay false for normal triage.
   */
  isSubmission: boolean;
  reason: string;
  repoUrl: string | null;
}

/**
 * Pull the first plausible "server repo" GitHub URL out of the issue body.
 * Skips links to LobeHub's own org and the MCP registry org so we land on the
 * submitter's repository.
 *
 * A missing URL is fine: private repos can still be submitted via the CLI after
 * `github connect`, so the handler redirects even when no public URL is pasted.
 */
export function extractRepoUrl(body: string): string | null {
  // github.com first-path segments that are not repositories: attachments,
  // pasted screenshots, org pages, etc. `user-attachments` is the big one:
  // pasted images land at github.com/user-attachments/assets/... and must never
  // be mistaken for a server repo.
  const reserved = new Set([
    'about',
    'apps',
    'collections',
    'explore',
    'features',
    'join',
    'login',
    'marketplace',
    'notifications',
    'orgs',
    'pricing',
    'readme',
    'search',
    'settings',
    'sponsors',
    'topics',
    'user-attachments',
  ]);
  const ignoredOwners = new Set(['lobehub', 'lobechat', 'modelcontextprotocol']);
  const regex = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/gi;

  for (const match of body.matchAll(regex)) {
    const owner = match[1];
    let repo = match[2];
    repo = repo.replace(/\.git$/i, '').replace(/[).,]+$/, '');
    if (!owner || !repo) continue;
    const ownerLc = owner.toLowerCase();
    if (reserved.has(ownerLc)) continue;
    if (ignoredOwners.has(ownerLc)) continue;
    return `https://github.com/${owner}/${repo}`;
  }

  return null;
}

/**
 * Decide whether an issue is an MCP marketplace listing request (new listing
 * or refresh/rescan of an existing one).
 *
 * High precision on the *intent* (listing/ops vs product bug / CLI failure):
 * the handler auto-closes matches and redirects to the self-service CLI.
 * A public repo URL is optional — private repos are submitted through the CLI
 * after GitHub ownership verification.
 */
export function classify(title: string, body: string): Classification {
  const text = `${title}\n${body}`.toLowerCase();
  const repoUrl = extractRepoUrl(body);

  const hasMcp = /\bmcp\b/.test(text);

  // URL-less requests need an unambiguous action signal because "listing" is
  // also a common noun in marketplace product bug reports.
  const hasExplicitSubmissionIntent =
    /\b(?:add|submit|submission|submitting|publish|index|register|include)\b/.test(text) ||
    /\b(?:please|kindly|request(?:ing)?(?:\s+to)?)\s+list\b|\blisting\s+request\b/.test(text) ||
    /上架|收录|添加|提交|登记/.test(text) ||
    /^\s*\[mcp\s*(?:submission|plugin)\]/i.test(title) ||
    /^\s*\[request\].*\blist\b/i.test(title);
  const hasSubmissionIntent = hasExplicitSubmissionIntent || /\blist(?:ing)?\b/.test(text);

  // Marketplace framing keeps us on listing requests and off random MCP bug
  // reports that merely mention "mcp" and a verb in passing.
  const hasMarketContext =
    /marketplace|市场|上架|收录|登记/.test(text) || /^\s*\[mcp\b/i.test(title);

  // Ops request against an EXISTING listing (rescan / refresh / re-index /
  // stuck scoring). High-precision so product bugs that mention "refresh"
  // never match.
  const isListingOps =
    hasMcp &&
    (/\bre-?scan(?:ned|ning)?\b|\bre-?index(?:ed|ing)?\b|refresh (?:the )?(?:existing )?(?:mcp )?(?:server )?(?:listing|metadata)|listing (?:is )?stale|stale (?:listing|scan|canonical)|scoring stuck|stuck scoring|canonical cache|重新扫描|重新索引|刷新.{0,6}(?:列表|收录|索引)/.test(
      text,
    ) ||
      (/\b(?:listing|marketplace)\b|市场/.test(text) &&
        /\bstale\b|\bstuck (?:at|on) v?\d/.test(text)));

  const isPublishingFlowFeedback =
    /publish-mcp|publishing skill/.test(text) &&
    /\b(?:feedback|wrong|confusing?|docs?|instructions?|guide|command sequence|not work|fail|error|bug|issue|problem|can'?t|cannot|unable)\b/.test(
      text,
    );

  // CLI / publish tooling failures must stay open for triage — including when
  // the user also says "rescan" (otherwise isListingOps would auto-close them
  // and re-point them at the same broken CLI path).
  const isCliFeedback =
    isPublishingFlowFeedback ||
    /\b(?:market-)?cli\b.+(?:fail|error|issue|problem|bug|not work|can'?t|cannot|unable|reject)/s.test(
      text,
    ) ||
    /(?:fail|error|unable|can'?t|cannot|reject).*(?:add|list|submit|publish|login|connect|claim|verify ownership)/s.test(
      text,
    ) ||
    /(?:add|list|submit|publish|login|connect|claim|verify ownership).*(?:fail|error|unable|can'?t|cannot|reject)/s.test(
      text,
    );

  // CLI limitations (claim rejects org, etc.). Checked BEFORE isListingOps so
  // "please rescan — market-cli cannot claim" is not auto-closed back into CLI.
  const isCliLimitation =
    /market.?cli cannot|cannot claim|can'?t claim|rejects? org|push\/admin access cannot claim/.test(
      text,
    );

  // Marketplace product bugs that are NOT a self-service list/rescan request.
  // Applied only on the new-submission path so phrases like "listing stale …
  // not syncing" still match isListingOps.
  const isProductMarketplaceBug =
    /disappeared|removed from|missing from|not show(?:ing)?|not syncing|sync(?:ing)? (?:from|issue)|install button/.test(
      text,
    );

  if (isCliFeedback) {
    return {
      isSubmission: false,
      reason: 'looks like CLI/publishing feedback',
      repoUrl,
    };
  }

  if (isCliLimitation) {
    return {
      isSubmission: false,
      reason: 'looks like a marketplace/listing bug or CLI limitation',
      repoUrl,
    };
  }

  // Rescan / refresh of an existing listing → same self-service path as new listings.
  if (isListingOps) {
    return {
      isSubmission: true,
      reason: 'existing marketplace listing rescan/refresh request',
      repoUrl,
    };
  }

  if (!hasMcp) {
    return { isSubmission: false, reason: 'no "mcp" keyword', repoUrl };
  }
  if (!hasSubmissionIntent) {
    return { isSubmission: false, reason: 'no add/submit intent', repoUrl };
  }
  if (!hasMarketContext) {
    return { isSubmission: false, reason: 'no marketplace context', repoUrl };
  }
  if (isProductMarketplaceBug) {
    return {
      isSubmission: false,
      reason: 'looks like a marketplace/listing bug or CLI limitation',
      repoUrl,
    };
  }
  if (!repoUrl && !hasExplicitSubmissionIntent) {
    return {
      isSubmission: false,
      reason: 'no explicit add/submit intent for a URL-less request',
      repoUrl,
    };
  }

  // No public repo URL is OK: private repos are listed via the CLI after
  // `github connect` verifies ownership.
  return {
    isSubmission: true,
    reason: 'new MCP server listing request',
    repoUrl,
  };
}
