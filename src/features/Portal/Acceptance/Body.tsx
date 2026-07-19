import { memo } from 'react';

import { AcceptanceViewer } from '@/features/Verify';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Body = memo(() => {
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);

  return <AcceptanceViewer acceptanceId={acceptanceId} />;
});

export default Body;
