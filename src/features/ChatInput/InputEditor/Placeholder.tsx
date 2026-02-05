import { KeyEnum } from '@lobechat/types';
import { combineKeys,Flexbox, Hotkey } from '@lobehub/ui';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

const Placeholder = memo(() => {
  const useCmdEnterToSend = useUserStore(preferenceSelectors.useCmdEnterToSend);
  const wrapperShortcut = useCmdEnterToSend
    ? KeyEnum.Enter
    : combineKeys([KeyEnum.Mod, KeyEnum.Enter]);

  // Don't remove this line for i18n reactivity
  void useTranslation('chat');

  return (
    <Flexbox horizontal align={'center'} as={'span'} gap={4} wrap={'wrap'}>
      <Trans
        i18nKey={'sendPlaceholder'}
        ns={'chat'}
        components={{
          hotkey: (
            <Trans
              i18nKey={'input.warpWithKey'}
              ns={'chat'}
              components={{
                key: (
                  <Hotkey
                    as={'span'}
                    keys={wrapperShortcut}
                    style={{ color: 'inherit' }}
                    styles={{ kbdStyle: { color: 'inhert' } }}
                    variant={'borderless'}
                  />
                ),
              }}
            />
          ),
        }}
      />
      {'...'}
    </Flexbox>
  );
});

export default Placeholder;
