import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { useModelHasContextWindowToken } from '@/hooks/useModelHasContextWindowToken';
import dynamic from '@/libs/next/dynamic';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors, threadSelectors } from '@/store/chat/selectors';

const LargeTokenContent = dynamic(() => import('./TokenTag'), { ssr: false });

const Token = memo<PropsWithChildren>(({ children }) => {
  const showTag = useModelHasContextWindowToken();

  return showTag && children;
});

export const MainToken = memo(() => {
  const total = useChatStore(displayMessageSelectors.mainAIChatsMessageString);

  return (
    <Token>
      <LargeTokenContent total={total} />
    </Token>
  );
});

export const PortalToken = memo(() => {
  const total = useChatStore(threadSelectors.portalDisplayChatsString);

  return (
    <Token>
      <LargeTokenContent total={total} />
    </Token>
  );
});
