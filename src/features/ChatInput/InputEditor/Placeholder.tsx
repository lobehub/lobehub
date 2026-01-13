import { KeyEnum } from '@lobechat/types';
import { Flexbox, Hotkey, combineKeys } from '@lobehub/ui';
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
    <Flexbox align={'center'} as={'span'} gap={4} horizontal wrap={'wrap'}>
      <Trans
        components={{
          hotkey: (
            <Trans
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
              i18nKey={'input.warpWithKey'}
              ns={'chat'}
            />
          ),
        }}
        i18nKey={'sendPlaceholder'}
        ns={'chat'}
      />
      {'...'}
    </Flexbox>
  );
});

export default Placeholder;
