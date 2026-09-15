import { getUserStoreState } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

interface HeteroAgentDefaultNameOptions {
  productTitle?: string | null;
  visibility?: 'private' | 'public';
  workspaceId?: string | null;
}

/**
 * Default display name for a heterogeneous agent. Personal and
 * workspace-private agents use their product title. Shared agents include the
 * creator to distinguish otherwise identical tools in a multilingual workspace.
 *
 * The possessive is deliberately stable English rather than creation-locale
 * copy because the persisted name is shown to every workspace member.
 */
export const heteroAgentDefaultName = ({
  productTitle,
  visibility,
  workspaceId,
}: HeteroAgentDefaultNameOptions): string | undefined => {
  const product = productTitle?.trim();
  if (!product) return undefined;

  if (!workspaceId || visibility === 'private') return product;

  const userStore = getUserStoreState();
  const owner = authSelectors.isLogin(userStore)
    ? userProfileSelectors.nickName(userStore)?.trim()
    : undefined;

  return owner ? `${owner}’s ${product}` : product;
};
