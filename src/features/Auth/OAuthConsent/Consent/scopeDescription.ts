/**
 * The i18n key describing an OAuth scope on the consent page. Every `:` of the
 * scope becomes `-` — i18next reads `:` as a namespace separator, and API
 * scopes such as `agent:credential:write` carry more than one.
 */
export const scopeDescriptionKey = (scope: string, reviewKind?: 'acceptance' | 'site') => {
  if (scope === 'acceptance:review' && reviewKind === 'site')
    return 'consent.scope.acceptance-review-site';

  return `consent.scope.${scope.replaceAll(':', '-')}`;
};
