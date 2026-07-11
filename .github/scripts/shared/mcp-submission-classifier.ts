export interface Classification {
  // How the server is delivered: only local installable servers can be
  // self-published via the CLI; remote URL-only and unknown delivery go to humans.
  delivery: 'local' | 'remote' | 'unknown';
  isSubmission: boolean;
  // Sub-category the triage bot routes on: a NEW listing submission, an ops
  // request against an EXISTING listing (rescan / refresh / re-index / stuck
  // scoring), or neither.
  kind: 'listing-ops' | 'none' | 'submission';
  reason: string;
  repoUrl: string | null;
}

/**
 * Pull the first plausible "server repo" GitHub URL out of the issue body.
 * Skips links to LobeHub's own org and the MCP registry org so we land on the
 * submitter's repository.
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
 * Decide whether an issue is a new MCP server listing request.
 *
 * High precision on purpose: the MCP submission handler uses this to drive an
 * auto-close path. We require add/submit intent + the word "mcp" + a server
 * reference, and explicitly bail out on marketplace bugs and CLI feedback.
 */
export function classify(title: string, body: string): Classification {
  const text = `${title}\n${body}`.toLowerCase();
  const repoUrl = extractRepoUrl(body);

  const hasMcp = /\bmcp\b/.test(text);

  // Explicit add / submit intent. The `[MCP Submission]` and `[MCP Plugin]`
  // title prefixes are themselves a declaration of intent.
  const hasAddVerb =
    /\b(?:add|submit|submission|submitting|list(?:ing)?|publish|index|register|include)\b/.test(
      text,
    ) ||
    /上架|收录|添加|提交|登记/.test(text) ||
    /^\s*\[mcp\s*(?:submission|plugin)\]/i.test(title);

  // Marketplace framing keeps us on listing requests and off random MCP bug
  // reports that merely mention "mcp" and a verb in passing.
  const hasMarketContext =
    /marketplace|市场|上架|收录|登记/.test(text) || /^\s*\[mcp\b/i.test(title);

  const isMarketplaceBug =
    /scoring|re-?scan|re-?index|stuck|outdated|out of date|stale|not updating|won'?t update|wrong version|shows? (?:old|outdated|wrong)|disappeared|removed from|missing from|not show(?:ing)?|not syncing|sync(?:ing)? (?:from|issue)|canonical cache/.test(
      text,
    );

  // Ops request against an EXISTING listing (rescan / refresh / re-index /
  // stuck scoring). Kept high-precision like the submission path: an explicit
  // rescan-style verb or "listing is stale" framing — not just any marketplace
  // complaint — so product bugs that mention refreshing never match.
  const isListingOps =
    hasMcp &&
    (/\bre-?scan(?:ned|ning)?\b|\bre-?index(?:ed|ing)?\b|refresh (?:the )?(?:existing )?(?:mcp )?(?:server )?(?:listing|metadata)|listing (?:is )?stale|stale (?:listing|scan|canonical)|scoring stuck|stuck scoring|canonical cache|重新扫描|重新索引|刷新.{0,6}(?:列表|收录|索引)/.test(
      text,
    ) ||
      (/\b(?:listing|marketplace)\b|市场/.test(text) &&
        /\bstale\b|\bscoring\b|\bstuck (?:at|on) v?\d/.test(text)));

  const kind: Classification['kind'] = isListingOps ? 'listing-ops' : 'none';

  const isPublishingFlowFeedback =
    /publish-mcp|publishing skill/.test(text) &&
    /\b(?:feedback|wrong|confusing?|docs?|instructions?|guide|command sequence|not work|fail|error|bug|issue|problem|can'?t|cannot|unable)\b/.test(
      text,
    );

  const isCliFeedback =
    isPublishingFlowFeedback ||
    /\bcli\b.+(?:fail|error|issue|problem|bug|not work|can'?t|unable)/.test(text) ||
    /(?:fail|error|unable|can'?t|cannot).*(?:submit|publish|login|connect|verify ownership)/.test(
      text,
    );

  // Strong install signals prove the CLI can publish the server.
  const hasStrongInstall =
    /\bnpx\b|\buvx\b|\bpipx\b|\bpip install\b|\bdocker run\b/.test(text) ||
    /"command"\s*:/.test(text) ||
    /npmjs\.com\/package\//.test(text);
  const hasStdioMention = /\bstdio\b/.test(text);
  const hasRemoteSignal =
    /"url"\s*:/.test(text) ||
    /\bstreamable[- ]?http\b|\bsse\b/.test(text) ||
    /transport[^a-z]{0,8}(?:sse|http|streamable)/.test(text) ||
    /\bremote(?:ly)? (?:hosted|mcp|server)\b|\bhosted mcp\b/.test(text) ||
    /\b(?:endpoint|url)\b[^\n]{1,15}https?:\/\/(?!github\.com)/.test(text);
  const isRemoteOnly =
    /\bno install\b|\bno npm\b|\bremote[- ]only\b|no local install|installation[- ]free/.test(text);

  const delivery: Classification['delivery'] = isRemoteOnly
    ? 'remote'
    : hasStrongInstall
      ? 'local'
      : hasRemoteSignal
        ? 'remote'
        : hasStdioMention
          ? 'local'
          : 'unknown';

  if (!hasMcp) return { delivery, isSubmission: false, kind, reason: 'no "mcp" keyword', repoUrl };
  // Listing-ops takes precedence over submission: "add X (rescan existing
  // listing to v2)" is a rescan of an existing entry, not a new submission.
  if (isListingOps)
    return {
      delivery,
      isSubmission: false,
      kind,
      reason: 'rescan/refresh request for an existing marketplace listing',
      repoUrl,
    };
  if (!hasAddVerb)
    return { delivery, isSubmission: false, kind, reason: 'no add/submit intent', repoUrl };
  if (!hasMarketContext)
    return { delivery, isSubmission: false, kind, reason: 'no marketplace context', repoUrl };
  if (!repoUrl && delivery !== 'remote')
    return {
      delivery,
      isSubmission: false,
      kind,
      reason: 'no server reference (repo URL or endpoint)',
      repoUrl,
    };
  if (isMarketplaceBug)
    return {
      delivery,
      isSubmission: false,
      kind,
      reason: 'looks like a marketplace/listing bug',
      repoUrl,
    };
  if (isCliFeedback)
    return {
      delivery,
      isSubmission: false,
      kind,
      reason: 'looks like CLI/publishing feedback',
      repoUrl,
    };

  return {
    delivery,
    isSubmission: true,
    kind: 'submission',
    reason: `new MCP server listing request (${delivery})`,
    repoUrl,
  };
}
