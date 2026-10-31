import {
  assertOverrideReason,
  assertSha,
  deliveredBaseline,
  normalizeVersion,
  sourcesHash,
} from './desktopReleaseSources.mjs';

const marker = /<!-- desktop-release-request ([\s\S]*?)-->/g;

function validateIntent(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !['initialize', 'hotfix', 'recovery'].includes(value.mode)
  )
    throw new Error('Invalid desktop release intent metadata');
  const intent = { schemaVersion: 1, mode: value.mode };
  if (value.mode === 'hotfix') {
    intent.baseVersion = normalizeVersion(value.baseVersion);
    intent.cloudSha = assertSha(value.cloudSha, 'Hotfix Cloud');
    if (!/^[a-f0-9]{64}$/.test(value.baseSourcesHash || ''))
      throw new Error('Hotfix metadata requires the baseline source hash');
    intent.baseSourcesHash = value.baseSourcesHash;
    if (value.overrideReason !== undefined)
      intent.overrideReason = assertOverrideReason(value.overrideReason);
  } else if (value.mode === 'recovery') {
    if (value.baseVersion || value.baseSourcesHash)
      throw new Error('Recovery metadata cannot claim a delivered baseline');
    intent.cloudSha = assertSha(value.cloudSha, 'Recovery Cloud');
    intent.recoveryBaseSha = assertSha(value.recoveryBaseSha, 'Recovery OSS base');
    intent.overrideReason = assertOverrideReason(value.overrideReason);
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
    if (value.mode === 'hotfix' || value.mode === 'recovery')
      intent.prBaseSha = assertSha(value.prBaseSha, 'Release PR base');
    if (value.mode === 'recovery' && intent.recoveryBaseSha !== intent.prBaseSha)
      throw new Error('Recovery OSS base differs from the bound PR base');
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
  if (!intent || !['hotfix', 'recovery'].includes(intent.mode))
    throw new Error(
      'Targeted main patches need hotfix intent metadata with a delivered base or explicit recovery metadata',
    );
  return intent;
}

export async function validatePrIntent(pr, store) {
  const intent = requestFromPr(pr);
  if (!intent || intent.mode === 'initialize') return intent;
  if (intent.mode === 'recovery') {
    if (pr.base?.ref !== 'main' || pr.base.sha !== intent.recoveryBaseSha)
      throw new Error(
        'Recovery requires its explicitly selected main base SHA; reselect sources if main changed',
      );
    return intent;
  }
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
