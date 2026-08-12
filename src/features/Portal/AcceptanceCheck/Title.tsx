import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceBundle } from '@/features/Verify';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

/**
 * The panel already says it is a check; repeating "check detail" in the title
 * spends the one line that could say WHICH check — the only thing a reader
 * with several panels open needs to tell them apart.
 */
const Title = memo(() => {
  const { t } = useTranslation('chat');
  const portal = useChatStore(chatPortalSelectors.acceptanceCheckPortal);
  const { data } = useAcceptanceBundle(portal?.acceptanceId ?? null);
  const check = data?.checks.find((item) => item.id === portal?.checkId);

  if (!check) return t('taskDetail.acceptance.detailTitle');

  return check.seq ? `C${check.seq} · ${check.title}` : check.title;
});

Title.displayName = 'AcceptanceCheckPortalTitle';

export default Title;
