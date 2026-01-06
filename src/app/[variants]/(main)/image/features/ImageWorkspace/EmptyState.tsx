import { Center } from '@lobehub/ui';
import { memo } from 'react';

import PromptInput from '../PromptInput';

const EmptyState = memo(() => {
  return (
    <Center height={'calc(100vh - 180px)'}>
      <PromptInput showTitle={true} />
    </Center>
  );
});

export default EmptyState;
