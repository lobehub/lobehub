import { getUserStoreState } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

interface HeteroAgentDefaultNameOptions {
  productTitle?: string | null;
  visibility?: 'private' | 'public';
  workspaceId?: string | null;
}

/**
 * Default display name for a shared workspace heterogeneous agent. Personal
 * and workspace-private agents keep no separate name, so their product title
 * remains the primary label. Shared agents include the creator to distinguish
 * otherwise identical tools in a multilingual workspace.
 *
 * The possessive is deliberately stable English rather than creation-locale
 * copy because the persisted name is shown to every workspace member.
 */
export const heteroAgentDefaultName = ({
  productTitle,
  visibility,
  workspaceId,
}: HeteroAgentDefaultNameOptions): string | undefined => {
  if (!workspaceId || visibility === 'private') return undefined;

  const userStore = getUserStoreState();
  const owner = authSelectors.isLogin(userStore)
    ? userProfileSelectors.nickName(userStore)?.trim()
    : undefined;
  const product = productTitle?.trim();

  if (!owner || !product) return undefined;

  return `${owner}’s ${product}`;
};
