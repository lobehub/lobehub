import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import dynamic from '@/libs/next/dynamic';

import { useShowContextWindow } from './useShowContextWindow';

const LargeTokenContent = dynamic(() => import('./TokenTag'), { ssr: false });

const Token = memo<PropsWithChildren>(({ children }) => {
  const showTag = useShowContextWindow();

  return showTag && children;
});

const ContextWindow = () => {
  return (
    <Token>
      <LargeTokenContent />
    </Token>
  );
};

export default ContextWindow;
