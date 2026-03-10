import { combineKeys,Flexbox, Hotkey, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import { KeyEnum } from '@/types/hotkey';

const ShortcutHint = memo(() => {
  const { t } = useTranslation('chat');

  const useCmdEnterToSend = useUserStore(preferenceSelectors.useCmdEnterToSend);

  const sendShortcut = useCmdEnterToSend
    ? combineKeys([KeyEnum.Mod, KeyEnum.Enter])
    : KeyEnum.Enter;

  const wrapperShortcut = useCmdEnterToSend
    ? KeyEnum.Enter
    : combineKeys([KeyEnum.Mod, KeyEnum.Enter]);

  return (
    <Text
      fontSize={12}
      style={{ color: cssVar.colorTextQuaternary, userSelect: 'none', zIndex: 1 }}
    >
      <Flexbox horizontal align={'center'} gap={4} justify={'flex-end'} paddingBlock={4}>
        <Hotkey
          keys={sendShortcut}
          style={{ color: 'inherit' }}
          variant={'borderless'}
          styles={{
            kbdStyle: { color: 'inherit' },
          }}
        />
        <span>{t('input.send')}</span>
        <span>/</span>
        <Hotkey
          keys={wrapperShortcut}
          style={{ color: 'inherit' }}
          variant={'borderless'}
          styles={{
            kbdStyle: { color: 'inherit' },
          }}
        />
        <span>{t('input.warp')}</span>
      </Flexbox>
    </Text>
  );
});

export default ShortcutHint;
