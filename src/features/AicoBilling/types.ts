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
  /**
   * Personal-path trial is currently usable for chat (env + config + active row).
   * Org budgets never inherit trial.
   */
  trialActive: boolean;
  /** Trial can be activated from the wallet UI (enabled and not already used). */
  trialAvailable: boolean;
};

/** Why managed chat is blocked for the selected billing source (Aico error codes). */
export type AicoBillingChatBlockReason =
  | 'MANAGED_KEY_UNAVAILABLE'
  | 'MEMBER_BUDGET_RENEWAL_BLOCKED'
  | 'MEMBER_BUDGET_UNFUNDED'
  | 'PERSONAL_FUNDS_UNAVAILABLE'
  | 'PERSONAL_WALLET_INACTIVE'
  | 'MEMBER_BUDGET_INACTIVE';

/**
 * Selected source with $0 (or no key) cannot chat, unless personal + active trial.
 * Mirrors server `AicoManagedPolicy.authorize` personal/org funds checks.
 */
export const getBillingChatBlockReason = (
  source: AicoBillingSource | undefined,
  options: { trialActive: boolean },
): AicoBillingChatBlockReason | null => {
  if (!source) return 'PERSONAL_FUNDS_UNAVAILABLE';

  if (!source.isActive) {
    return source.source === 'personal' ? 'PERSONAL_WALLET_INACTIVE' : 'MEMBER_BUDGET_INACTIVE';
  }

  if (source.source === 'organization' && source.renewalBlocked) {
    return 'MEMBER_BUDGET_RENEWAL_BLOCKED';
  }

  if (!source.hasManagedKey) {
    return 'MANAGED_KEY_UNAVAILABLE';
  }

  const remaining = Number(source.remainingMicroUsd ?? 0);
  if (Number.isFinite(remaining) && remaining > 0) return null;

  if (source.source === 'personal' && options.trialActive) return null;

  return source.source === 'personal' ? 'PERSONAL_FUNDS_UNAVAILABLE' : 'MEMBER_BUDGET_UNFUNDED';
};

export const canChatWithBillingSource = (
  source: AicoBillingSource | undefined,
  options: { trialActive: boolean },
): boolean => getBillingChatBlockReason(source, options) === null;

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
