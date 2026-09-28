import { type UserCredSummary } from '@lobechat/types';

/**
 * Ownership routing for a row from an org-scoped credential list
 * (`workspaceCreds.list`). Extracted from {@link CredsList} as plain,
 * dependency-free functions so the routing decision has direct unit
 * coverage independent of React/tRPC test scaffolding — see
 * `credAccess.test.ts`.
 *
 * A row can be:
 * - the org's own credential (`ownerType: 'organization'`);
 * - the SIGNED-IN member's own credential, published/draft-linked into the
 *   org (`ownerType: 'user'` AND `ownerAccountId === myAccountId`);
 * - ANOTHER member's published credential (`ownerType: 'user'` AND
 *   `ownerAccountId !== myAccountId`) — `ownerType` alone conflates this
 *   with the previous case.
 *
 * Market's org-scoped write endpoints (`/organizations/:orgId/creds/:id`
 * PATCH/DELETE/GET?decrypt) resolve ownership by the *org's* account id
 * only — they 404 (or refuse to decrypt) on ANY member-owned row, mine or
 * someone else's. So:
 * - org-owned → the workspace API (context-bound) is correct;
 * - my own row → must go through my personal `market.creds` endpoint
 *   instead, which is scoped to my own account;
 * - another member's row → no endpoint this UI can reach at all; actions
 *   for it must be hidden rather than misrouted (routing to my personal API
 *   would 404 too, since that row isn't mine).
 */
type CredRowOwnership = Pick<UserCredSummary, 'ownerAccountId' | 'ownerType'>;

export const isOwnCredRow = (cred: CredRowOwnership, myAccountId: number | undefined): boolean =>
  cred.ownerType === 'user' && cred.ownerAccountId === myAccountId;

export const isActionableCredRow = (
  cred: CredRowOwnership,
  myAccountId: number | undefined,
): boolean => cred.ownerType !== 'user' || isOwnCredRow(cred, myAccountId);

/**
 * Which API binding (`personalApi` vs `contextApi`) a row's mutations should
 * go through. Only meaningful for an {@link isActionableCredRow} row — the
 * caller must gate on that first, since another member's row has no correct
 * binding to return here.
 */
export const credsApiForRow = <T>(
  cred: CredRowOwnership,
  myAccountId: number | undefined,
  contextApi: T,
  personalApi: T,
): T => (isOwnCredRow(cred, myAccountId) ? personalApi : contextApi);
