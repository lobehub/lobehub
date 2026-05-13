import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { useModelHasContextWindowToken } from '@/hooks/useModelHasContextWindowToken';
import dynamic from '@/libs/next/dynamic';

const LargeTokenContent = dynamic(() => import('./TokenTag'), { ssr: false });

const Token = memo<PropsWithChildren>(({ children }) => {
  const showTag = useModelHasContextWindowToken();

  return showTag && children;
});

const ContextWindow = memo(() => {
  return (
    <Token>
      <LargeTokenContent />
    </Token>
  );
});

ContextWindow.displayName = 'ContextWindow';

export default ContextWindow;
