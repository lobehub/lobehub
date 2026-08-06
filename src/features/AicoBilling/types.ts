export type AicoBillingContext =
  { source: 'personal' } | { source: 'organization'; organizationId: string };

export type AicoPersonalBillingSource = {
  hasManagedKey: boolean;
  isActive: boolean;
  remainingMicroUsd: string;
  remainingUsd: string;
  source: 'personal';
};

export type AicoOrganizationBillingSource = {
  hasManagedKey: boolean;
  isActive: boolean;
  organizationId: string;
  organizationName: string;
  remainingMicroUsd: string;
  remainingUsd: string;
  renewalBlocked: boolean;
  source: 'organization';
};

export type AicoBillingSource = AicoPersonalBillingSource | AicoOrganizationBillingSource;

export type AicoBillingSourcesResponse = {
  preferredBillingSource: 'personal' | 'organization';
  preferredOrganizationId: string | null;
  sources: AicoBillingSource[];
};

export const billingContextKey = (ctx: AicoBillingContext): string =>
  ctx.source === 'personal' ? 'personal' : `organization:${ctx.organizationId}`;

export const isSameBillingContext = (a: AicoBillingContext, b: AicoBillingContext): boolean =>
  billingContextKey(a) === billingContextKey(b);

export const preferenceToBillingContext = (params: {
  preferredBillingSource: 'personal' | 'organization';
  preferredOrganizationId: string | null | undefined;
  sources: AicoBillingSource[];
}): AicoBillingContext => {
  if (params.preferredBillingSource === 'organization' && params.preferredOrganizationId) {
    const match = params.sources.find(
      (s) => s.source === 'organization' && s.organizationId === params.preferredOrganizationId,
    );
    if (match?.source === 'organization') {
      return { organizationId: match.organizationId, source: 'organization' };
    }
  }

  const firstOrg = params.sources.find((s) => s.source === 'organization');
  if (params.preferredBillingSource === 'organization' && firstOrg?.source === 'organization') {
    return { organizationId: firstOrg.organizationId, source: 'organization' };
  }

  return { source: 'personal' };
};

export const findBillingSource = (
  sources: AicoBillingSource[],
  ctx: AicoBillingContext,
): AicoBillingSource | undefined => {
  if (ctx.source === 'personal') {
    return sources.find((s) => s.source === 'personal');
  }
  return sources.find(
    (s) => s.source === 'organization' && s.organizationId === ctx.organizationId,
  );
};

export const formatRemainingUsd = (remainingUsd: string | undefined): string => {
  const n = Number(remainingUsd ?? 0);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
};
