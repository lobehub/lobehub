import { isDesktop } from '@lobechat/const';
import { memo } from 'react';

import OllamaSetupGuide from '@/components/OllamaSetupGuide';
import { ErrorActionContainer } from '@/features/Conversation/Error/style';

import OllamaDesktopSetupGuide from './Desktop';

const SetupGuide = memo<{ container?: boolean }>(({ container = true }) => {
  const content = isDesktop ? <OllamaDesktopSetupGuide /> : <OllamaSetupGuide />;

  if (!container) return content;

  return <ErrorActionContainer style={{ paddingBlock: 0 }}>{content}</ErrorActionContainer>;
});

export default SetupGuide;
