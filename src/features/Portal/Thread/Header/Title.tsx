import { Skeleton } from '@lobehub/ui';

import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import ActiveThread from './Active';
import NewThread from './New';

const Header = () => {
  const isInNew = useChatStore((s) => s.startToForkThread);

  const isInit = useChatStore(threadSelectors.isCurrentTopicThreadsLoaded);
  const isThreadPending = useChatStore(threadSelectors.isPortalThreadPending);

  if (!isInit || (!isInNew && isThreadPending)) return <Skeleton height={22} width={200} />;

  return isInNew ? <NewThread /> : <ActiveThread />;
};

export default Header;
