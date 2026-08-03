/**
 * Explicit Aico billing context — required on every managed model request.
 * Never infer from first-match, personal-first, or organization-first fallbacks.
 */
export type AicoBillingContext =
  | { source: 'personal' }
  | { source: 'organization'; organizationId: string };

export const parseAicoBillingContext = (raw: unknown): AicoBillingContext => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('BILLING_CONTEXT_REQUIRED');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.source === 'personal') {
    return { source: 'personal' };
  }
  if (obj.source === 'organization') {
    const organizationId = obj.organizationId;
    if (typeof organizationId !== 'string' || !organizationId.trim()) {
      throw new Error('BILLING_CONTEXT_ORG_ID_REQUIRED');
    }
    return { source: 'organization', organizationId: organizationId.trim() };
  }
  throw new Error('BILLING_CONTEXT_INVALID');
};

/** Header used by HTTP chat / alternate runtimes. */
export const AICO_BILLING_CONTEXT_HEADER = 'x-aico-billing-context';

export const encodeBillingContextHeader = (ctx: AicoBillingContext): string =>
  Buffer.from(JSON.stringify(ctx), 'utf8').toString('base64url');

export const decodeBillingContextHeader = (value: string | null | undefined): AicoBillingContext => {
  if (!value?.trim()) throw new Error('BILLING_CONTEXT_REQUIRED');
  try {
    const json = Buffer.from(value.trim(), 'base64url').toString('utf8');
    return parseAicoBillingContext(JSON.parse(json));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BILLING_CONTEXT_')) throw error;
    throw new Error('BILLING_CONTEXT_INVALID');
  }
};
