import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceBundle } from '@/features/Verify/hooks';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const { t } = useTranslation('verify');
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);
  const { data } = useAcceptanceBundle(acceptanceId ?? null);

  return data?.subject.title || t('acceptance.titleFallback');
});

export default Title;
