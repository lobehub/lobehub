import { createStaticStyles, Flexbox, Hotkey } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';
import hotkeyMeta from '@/locales/default/hotkey';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';
import { type HotkeyGroupId } from '@/types/hotkey';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`
    font-size: 12px;
    line-height: 1.3;
    color: ${cssVar.colorTextDescription};
  `,
  hotkey: css`
    gap: 4px;

    kbd {
      min-width: 26px;
      height: 26px;
      border: 1px solid ${cssVar.colorBorder};
    }
  `,
}));

interface HotkeyContentProps {
  groupId: HotkeyGroupId;
}

const HotkeyContent = memo<HotkeyContentProps>(({ groupId }) => {
  const settings = useUserStore(settingsSelectors.currentSettings, isEqual);
  const { t } = useTranslation(['hotkey', 'setting']);
  return (
    <>
      {HOTKEYS_REGISTRATION.filter((item) => item.group === groupId).map((item) => (
        <Flexbox horizontal align={'flex-start'} gap={16} key={item.id} width={'100%'}>
          <Flexbox flex={1} gap={4} justify={'space-between'}>
            <span>{t(`${item.id}.title`)}</span>
            {hotkeyMeta[`${item.id}.desc`] ? (
              <span className={styles.desc}>{t(`${item.id}.desc`)}</span>
            ) : null}
          </Flexbox>
          {/* A sequence (`g>i`) is keys pressed one after another, not together. */}
          <Flexbox horizontal align={'center'} gap={6}>
            {(settings.hotkey[item.id] ?? '').split('>').map((keys, index) => (
              <Fragment key={index}>
                {index > 0 && (
                  <span className={styles.desc}>{t('hotkey.sequenceThen', { ns: 'setting' })}</span>
                )}
                <Hotkey
                  className={styles.hotkey}
                  keys={keys}
                  style={{
                    zoom: 1.1,
                  }}
                />
              </Fragment>
            ))}
          </Flexbox>
        </Flexbox>
      ))}
    </>
  );
});

export default HotkeyContent;
