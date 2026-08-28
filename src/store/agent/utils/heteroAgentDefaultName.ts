import { t } from 'i18next';

import { getUserStoreState } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

/**
 * Default display name for a heterogeneous (external CLI / platform) agent:
 * "{owner}'s {product}" (e.g. "Max 的 Claude Code"). Such an agent is the
 * user's external tool rather than one of our own agents, so its default label
 * says whose tool it is instead of drawing a personal name.
 *
 * Returns undefined when the owner has no usable name (anonymous session), so
 * the product title stays the primary label.
 */
export const heteroAgentDefaultName = (productTitle?: string | null): string | undefined => {
  const userStore = getUserStoreState();
  const owner = authSelectors.isLogin(userStore)
    ? userProfileSelectors.nickName(userStore)?.trim()
    : undefined;
  const product = productTitle?.trim();

  if (!owner || !product) return undefined;

  return t('heteroAgent.defaultName', { ns: 'chat', owner, product });
};
