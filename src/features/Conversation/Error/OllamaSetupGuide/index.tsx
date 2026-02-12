import { Block } from '@lobehub/ui';
import { memo } from 'react';

import OllamaSetupGuide from '@/components/OllamaSetupGuide';
import { isDesktop } from '@/const/version';

import OllamaDesktopSetupGuide from './Desktop';

const SetupGuide = memo<{ id?: string }>(({ id }) => {
  return (
    <Block
      align={'center'}
      gap={8}
      padding={16}
      variant={'outlined'}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      {isDesktop ? <OllamaDesktopSetupGuide id={id} /> : <OllamaSetupGuide />}
    </Block>
  );
});

export default SetupGuide;
