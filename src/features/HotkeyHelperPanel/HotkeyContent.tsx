import { Flexbox, Hotkey } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';
import hotkeyMeta from '@/locales/default/hotkey';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';
import { type HotkeyGroupId } from '@/types/hotkey';

const styles = stylex.create({
  desc: {
    color: cssVar.colorTextDescription,
    fontSize: '12px',
    lineHeight: 1.3,
  },
  hotkey: {
    gap: '4px',
  },
  kbd: {
    borderColor: cssVar.colorBorder,
    borderStyle: 'solid',
    borderWidth: '1px',
    height: '26px',
    minWidth: '26px',
  },
});

interface HotkeyContentProps {
  groupId: HotkeyGroupId;
}

const HotkeyContent = memo<HotkeyContentProps>(({ groupId }) => {
  const settings = useUserStore(settingsSelectors.currentSettings, isEqual);
  const { t } = useTranslation('hotkey');
  return (
    <>
      {HOTKEYS_REGISTRATION.filter((item) => item.group === groupId).map((item) => (
        <Flexbox horizontal align={'flex-start'} gap={16} key={item.id} width={'100%'}>
          <Flexbox flex={1} gap={4} justify={'space-between'}>
            <span>{t(`${item.id}.title`)}</span>
            {hotkeyMeta[`${item.id}.desc`] ? (
              <span {...stylex.props(styles.desc)}>{t(`${item.id}.desc`)}</span>
            ) : null}
          </Flexbox>
          <Hotkey
            className={stylex.props(styles.hotkey).className}
            classNames={{ kbdClassName: stylex.props(styles.kbd).className }}
            keys={settings.hotkey[item.id]}
            style={{
              zoom: 1.1,
            }}
          />
        </Flexbox>
      ))}
    </>
  );
});

export default HotkeyContent;
