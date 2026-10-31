import {
  assertSha,
  deliveredBaseline,
  normalizeVersion,
  sourcesHash,
} from './desktopReleaseSources.mjs';

const marker = /<!-- desktop-release-request ([\s\S]*?)-->/g;

function validateIntent(value) {
  if (!value || value.schemaVersion !== 1 || !['initialize', 'hotfix'].includes(value.mode))
    throw new Error('Invalid desktop release intent metadata');
  const intent = { schemaVersion: 1, mode: value.mode };
  if (value.mode === 'hotfix') {
    intent.baseVersion = normalizeVersion(value.baseVersion);
    intent.cloudSha = assertSha(value.cloudSha, 'Hotfix Cloud');
    if (!/^[a-f0-9]{64}$/.test(value.baseSourcesHash || ''))
      throw new Error('Hotfix metadata requires the baseline source hash');
    intent.baseSourcesHash = value.baseSourcesHash;
    if (value.overrideReason !== undefined) {
      if (
        typeof value.overrideReason !== 'string' ||
        !value.overrideReason.trim() ||
        value.overrideReason.length > 500
      )
        throw new Error('Invalid Cloud repair reason');
      intent.overrideReason = value.overrideReason.trim();
    }
  } else if (value.baseVersion || value.cloudSha) {
    throw new Error('Ordinary initialization cannot carry a hotfix baseline');
  }
  if (
    value.mergeSha !== undefined ||
    value.prNumber !== undefined ||
    value.prBaseSha !== undefined
  ) {
    intent.mergeSha = assertSha(value.mergeSha, 'Release merge');
    if (!Number.isSafeInteger(value.prNumber) || value.prNumber < 1)
      throw new Error('Release intent requires its PR number');
    intent.prNumber = value.prNumber;
    if (value.mode === 'hotfix') intent.prBaseSha = assertSha(value.prBaseSha, 'Release PR base');
  }
  return intent;
}

export function parseIntent(body = '') {
  const matches = [...body.matchAll(marker)];
  if (!matches.length) {
    if (body.includes('desktop-release-request'))
      throw new Error('Malformed desktop release metadata');
    return null;
  }
  if (matches.length !== 1)
    throw new Error('Only one desktop release intent is allowed; duplicate metadata');
  return validateIntent(JSON.parse(matches[0][1]));
}

export function formatIntent(value) {
  const json = JSON.stringify(validateIntent(value))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
  return `<!-- desktop-release-request ${json} -->`;
}

export function stripIntent(body = '') {
  return body.replaceAll(marker, '').trim();
}

export function requestFromPr(pr) {
  const head = pr.head?.ref || '';
  const title = pr.title || '';
  const ordinary =
    head.startsWith('release/weekly-') || /^🚀\s+release:\s*v\d+\.\d+\.\d+$/.test(title);
  const candidate =
    ordinary ||
    /^(?:hotfix|release)\//.test(head) ||
    /^(?:(?:💄|✨|🐛|♻️|🩹|👷)\s*)?(?:style|feat|fix|refactor|hotfix|build)(?:\([^)]*\))?:/i.test(
      title,
    );
  if (!candidate) return null;
  const intent = parseIntent(pr.body || '');
  if (intent?.mergeSha)
    throw new Error('PR metadata must not preassign the release merge identity');
  if (ordinary) return intent || { schemaVersion: 1, mode: 'initialize' };
  if (!intent || intent.mode !== 'hotfix')
    throw new Error(
      'Targeted main patches need hotfix intent metadata with an explicitly delivered base; use hotfix:branch --base',
    );
  return intent;
}

export async function validatePrIntent(pr, store) {
  const intent = requestFromPr(pr);
  if (!intent || intent.mode === 'initialize') return intent;
  const baseline = await deliveredBaseline(store, intent.baseVersion, intent.baseSourcesHash);
  if (intent.cloudSha !== baseline.cloudSha && !intent.overrideReason)
    throw new Error('A different Cloud SHA needs a repair reason');
  await store.assertHotfixBase(baseline, pr.base.sha);
  return { ...intent, baseSourcesHash: sourcesHash(baseline) };
}

export function validateReleaseIntent(body, ossSha) {
  const intent = parseIntent(body);
  if (!intent) return null;
  if (intent.mergeSha !== ossSha) throw new Error('Release intent merge SHA mismatch');
  return intent;
}
