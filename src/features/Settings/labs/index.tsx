'use client';

import { isDesktop } from '@lobechat/const';
import { type FormGroupItemType, type FormItemProps } from '@lobehub/ui';
import { Flexbox, Form, Tooltip } from '@lobehub/ui';
import { Alert, Skeleton, Switch, Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FlaskConicalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

import { LAB_FEATURES, type LabFeatureItem, type LabStage } from './features';

const styles = createStaticStyles(({ css }) => ({
  labItem: css`
    .ant-form-item-row {
      align-items: center !important;
    }
  `,
}));

const StageTag = memo<{ stage: LabStage }>(({ stage }) => {
  const { t } = useTranslation('labs');

  return (
    <Tooltip title={t(`stage.${stage}.desc`)}>
      <Tag color={stage === 'alpha' ? 'warning' : 'info'} size={'small'}>
        {t(`stage.${stage}.label`)}
      </Tag>
    </Tooltip>
  );
});

const LabsForm = memo(() => {
  const { t: tLabs } = useTranslation('labs');

  const [isPreferenceInit, isUserStateInit, isUserStateInitError, refreshUserState, updateLab] =
    useUserStore((s) => [
      preferenceSelectors.isPreferenceInit(s),
      s.isUserStateInit,
      s.isUserStateInitError,
      s.refreshUserState,
      s.updateLab,
    ]);
  const labChecked = useUserStore((s) =>
    LAB_FEATURES.map(({ flag }) => labPreferSelectors[flag](s)),
  );

  if (!isUserStateInit) {
    // A failed user-state init must show error + Retry, not a permanent skeleton
    if (isUserStateInitError)
      return (
        <AsyncError
          error={isUserStateInitError}
          variant={'block'}
          onRetry={() => refreshUserState()}
        />
      );
    return <Skeleton.Text rows={5} />;
  }

  const checkedByFlag = Object.fromEntries(
    LAB_FEATURES.map(({ flag }, index) => [flag, labChecked[index]]),
  );

  const toFormItem = ({ flag, i18nKey, stage }: LabFeatureItem): FormItemProps => ({
    children: (
      <Switch
        checked={checkedByFlag[flag]}
        loading={!isPreferenceInit}
        onChange={(next: boolean) => updateLab({ [flag]: next })}
      />
    ),
    className: styles.labItem,
    desc: tLabs(`features.${i18nKey}.desc`),
    label: (
      <SettingsSearchAnchor id={`labs-${flag}`}>
        <Flexbox horizontal align={'center'} gap={8}>
          {tLabs(`features.${i18nKey}.title`)}
          <StageTag stage={stage} />
        </Flexbox>
      </SettingsSearchAnchor>
    ),
    minWidth: undefined,
  });

  // Cross-surface experiments. Platform-specific ones (Electron main-process
  // features) live in the Desktop group below; everything else is General.
  const generalItems = LAB_FEATURES.filter((feature) => !feature.desktopOnly);
  // Desktop-only experiments: local agent runtimes, iMessage bridge, and the
  // in-app browser (renderer-retained Electron webviews).
  const desktopItems = LAB_FEATURES.filter((feature) => feature.desktopOnly);

  const items: FormGroupItemType[] = [
    {
      children: generalItems.map((item) => toFormItem(item)),
      title: tLabs('group.general'),
    },
  ];

  // The Desktop group only renders in the Electron shell — all its experiments
  // are main-process features that do not exist on web.
  if (isDesktop) {
    items.push({
      children: desktopItems.map((item) => toFormItem(item)),
      title: tLabs('group.desktop'),
    });
  }

  return (
    <Form
      collapsible={false}
      items={items}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t: tLabs } = useTranslation('labs');

  return (
    <>
      {showSettingHeader && <SettingHeader title={tLabs('title')} />}
      <Flexbox gap={16}>
        <Alert
          showIcon
          icon={FlaskConicalIcon}
          title={tLabs('description')}
          type={'info'}
          variant={'filled'}
        />
        <LabsForm />
      </Flexbox>
    </>
  );
};

export default Page;
