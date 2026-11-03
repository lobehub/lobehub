import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { messageStateSelectors, useConversationStore } from '../../store';
import ExtraContainer from '../components/Extras/ExtraContainer';
import Translate from '../components/Extras/Translate';

interface UserMessageExtraProps {
  extra: any;
  id: string;
}

export const UserMessageExtra = memo<UserMessageExtraProps>(({ extra, id }) => {
  const loading = useConversationStore(messageStateSelectors.isMessageGenerating(id));
  const isLogin = useUserStore(authSelectors.isLogin);

  const showTranslate = !!extra?.translate;

  const showExtra = isLogin && showTranslate;

  if (!showExtra) return;

  return (
    <Flexbox gap={8} style={{ marginTop: 8 }}>
      {extra?.translate && (
        <ExtraContainer>
          <Translate id={id} {...extra?.translate} loading={loading} />
        </ExtraContainer>
      )}
    </Flexbox>
  );
});
