'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Switch, Text, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { RotateCcw, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import CountStepper from './components/CountStepper';
import PresetBar from './components/PresetBar';
import SettingRow from './components/SettingRow';
import { HOME_COUNT_MAX, HOME_COUNT_MIN, HOME_WIDGET_GROUPS } from './config';
import { useHomeCustomization } from './useHomeCustomization';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-y: auto;
    max-block-size: min(70vh, 560px);
    padding-block: 12px 20px;
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
    applyPreset,
    isWidgetHidden,
    preset,
    recentsCount,
    reset,
    setRecentsCount,
    setTaskCount,
    showPortrait,
    taskCount,
    togglePortrait,
    toggleWidget,
    usageActive,
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
        <SettingRow title={t('dashboard.customize.preset.label')}>
          <PresetBar value={preset} onChange={applyPreset} />
        </SettingRow>

        {/* No heading: the groups below name parts of the page, and a heading
            over this single row would promise a category that has one member
            and no page to point at. Its own label and description say enough. */}
        <SettingRow
          description={t('dashboard.customize.portrait.desc')}
          title={t('dashboard.customize.portrait.title')}
        >
          <Switch
            aria-label={t('dashboard.customize.portrait.title')}
            checked={showPortrait}
            size={'small'}
            onChange={togglePortrait}
          />
        </SettingRow>

        {HOME_WIDGET_GROUPS.map((group) => (
          <Flexbox gap={12} key={group.key}>
            <Text fontSize={12} type={'secondary'} weight={600}>
              {t(`dashboard.customize.group.${group.key}`)}
            </Text>
            {/* The usage widget is a business slot: a deployment without it
                must not show a switch that toggles nothing. */}
            {group.widgets
              .filter((key) => key !== 'usage' || usageActive)
              .map((key) => (
                <SettingRow key={key} title={t(`dashboard.customize.widget.${key}`)}>
                  <Switch
                    aria-label={t(`dashboard.customize.widget.${key}`)}
                    checked={!isWidgetHidden(key)}
                    // The scheduled block is the second half of the task overview,
                    // so there is nothing for it to switch on while the first half
                    // is off.
                    disabled={key === 'scheduledTasks' && isWidgetHidden('tasks')}
                    size={'small'}
                    onChange={() => toggleWidget(key)}
                  />
                </SettingRow>
              ))}
          </Flexbox>
        ))}

        <Flexbox gap={12}>
          <Text fontSize={12} type={'secondary'} weight={600}>
            {t('dashboard.customize.group.listSize')}
          </Text>
          {/* A section that isn't on the page has no length to tune. */}
          <SettingRow title={t('dashboard.customize.recents.count.title')}>
            <CountStepper
              disabled={isWidgetHidden('recents')}
              label={t('dashboard.customize.recents.count.title')}
              max={HOME_COUNT_MAX}
              min={HOME_COUNT_MIN}
              value={recentsCount}
              onChange={setRecentsCount}
            />
          </SettingRow>
          <SettingRow title={t('dashboard.customize.tasks.count.title')}>
            <CountStepper
              disabled={isWidgetHidden('tasks')}
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
