import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceBundle } from '@/features/Acceptance/hooks';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const { t } = useTranslation('verify');
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);
  const { data } = useAcceptanceBundle(acceptanceId ?? null);

  // One line in the panel header: a long title ends in an ellipsis instead of
  // pushing the header to two lines, and shows in full on hover.
  return (
    <Text ellipsis={{ tooltipWhenOverflow: true }} style={{ minWidth: 0 }}>
      {data?.subject.title || t('acceptance.titleFallback')}
    </Text>
  );
});

export default Title;
