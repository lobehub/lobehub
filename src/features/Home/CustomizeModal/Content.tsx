'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Button, Switch, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { RotateCcw, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import CountStepper from './components/CountStepper';
import SettingRow from './components/SettingRow';
import { HOME_COUNT_MAX, HOME_COUNT_MIN, HOME_WIDGET_KEYS } from './config';
import { useHomeCustomization } from './useHomeCustomization';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-y: auto;
    max-block-size: min(70vh, 560px);
    padding-block: 4px 20px;
    padding-inline: 20px;
  `,
  footer: css`
    padding-block: 12px;
    padding-inline: 12px 20px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    padding-block: 16px 4px;
    padding-inline: 20px;
  `,
}));

const CustomizeModalContent = memo(() => {
  const { t } = useTranslation('home');
  const { close } = useModalContext();
  const {
    isWidgetHidden,
    recentsCount,
    reset,
    setRecentsCount,
    setTaskCount,
    showPortrait,
    taskCount,
    togglePortrait,
    toggleWidget,
  } = useHomeCustomization();

  return (
    <Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        gap={16}
        justify={'space-between'}
      >
        <Text as={'h2'} fontSize={16} weight={600}>
          {t('dashboard.customize.title')}
        </Text>
        <ActionIcon
          icon={XIcon}
          size={'small'}
          title={t('close', { ns: 'common' })}
          onClick={close}
        />
      </Flexbox>

      <Flexbox className={styles.body} gap={20}>
        <Flexbox gap={12}>
          <Text fontSize={12} type={'secondary'} weight={600}>
            {t('dashboard.customize.group.decoration')}
          </Text>
          <SettingRow
            description={t('dashboard.customize.portrait.desc')}
            title={t('dashboard.customize.portrait.title')}
          >
            <Switch
              aria-label={t('dashboard.customize.portrait.title')}
              checked={showPortrait}
              onChange={togglePortrait}
            />
          </SettingRow>
        </Flexbox>

        <Flexbox gap={12}>
          <Text fontSize={12} type={'secondary'} weight={600}>
            {t('dashboard.customize.group.sections')}
          </Text>
          {HOME_WIDGET_KEYS.map((key) => (
            <SettingRow key={key} title={t(`dashboard.customize.widget.${key}`)}>
              <Switch
                aria-label={t(`dashboard.customize.widget.${key}`)}
                checked={!isWidgetHidden(key)}
                onChange={() => toggleWidget(key)}
              />
            </SettingRow>
          ))}
        </Flexbox>

        <Flexbox gap={12}>
          <Text fontSize={12} type={'secondary'} weight={600}>
            {t('dashboard.customize.group.listSize')}
          </Text>
          <SettingRow title={t('dashboard.customize.recents.count.title')}>
            <CountStepper
              label={t('dashboard.customize.recents.count.title')}
              max={HOME_COUNT_MAX}
              min={HOME_COUNT_MIN}
              value={recentsCount}
              onChange={setRecentsCount}
            />
          </SettingRow>
          <SettingRow title={t('dashboard.customize.tasks.count.title')}>
            <CountStepper
              label={t('dashboard.customize.tasks.count.title')}
              max={HOME_COUNT_MAX}
              min={HOME_COUNT_MIN}
              value={taskCount}
              onChange={setTaskCount}
            />
          </SettingRow>
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal align={'center'} className={styles.footer}>
        <Button
          htmlType={'button'}
          icon={<RotateCcw size={14} />}
          size={'small'}
          type={'text'}
          onClick={reset}
        >
          {t('dashboard.customize.reset')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default CustomizeModalContent;
