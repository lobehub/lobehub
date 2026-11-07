'use client';

import { isDesktop } from '@lobechat/const';
import { Alert, Flexbox, Tag } from '@lobehub/ui';
import { FlaskConicalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LAB_FEATURES, type LabFeatureItem } from '@/features/Settings/labs/features';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import SkeletonBar from '../../Bar';
import { SettingsFormSkeleton, type SettingsFormSkeletonItem, SWITCH_CONTROL } from '../Section';
import type { SettingsTabSkeleton } from './types';

/**
 * The experiment groups with the same General / Workspace / Desktop split and
 * every experiment's real title and description. The labs page renders it
 * below its settled intro alert while user state loads.
 */
export const LabsFormSkeleton = () => {
  const { t, ready } = useTranslation('labs');
  const enableWorkspace = useServerConfigStore(serverConfigSelectors.enableWorkspace);
  const text = (key: string, width: number, height = 14) =>
    ready ? (t(key as any) as string) : <SkeletonBar height={height} width={width} />;

  const toItem = ({ i18nKey, noteI18nKey, stage }: LabFeatureItem): SettingsFormSkeletonItem => ({
    control: SWITCH_CONTROL,
    desc: noteI18nKey ? (
      <Flexbox>
        <span>{text(`features.${i18nKey}.desc`, 280, 12)}</span>
        <span>{text(`features.${noteI18nKey}.note`, 200, 12)}</span>
      </Flexbox>
    ) : (
      text(`features.${i18nKey}.desc`, 280, 12)
    ),
    label: (
      <Flexbox horizontal align={'center'} gap={8}>
        {text(`features.${i18nKey}.title`, 120)}
        {ready && (
          <Tag color={stage === 'alpha' ? 'warning' : 'info'} size={'small'}>
            {t(`stage.${stage}.label`)}
          </Tag>
        )}
      </Flexbox>
    ),
    minWidth: undefined,
  });

  const general = LAB_FEATURES.filter((f) => !f.desktopOnly && !f.workspaceOnly);
  const workspace = enableWorkspace ? LAB_FEATURES.filter((f) => f.workspaceOnly) : [];
  const desktop = LAB_FEATURES.filter((f) => f.desktopOnly);

  return (
    <SettingsFormSkeleton
      groups={[
        { items: general.map(toItem), title: text('group.general', 72, 16) },
        ...(workspace.length > 0
          ? [{ items: workspace.map(toItem), title: text('group.workspace', 72, 16) }]
          : []),
        ...(isDesktop
          ? [{ items: desktop.map(toItem), title: text('group.desktop', 72, 16) }]
          : []),
      ]}
    />
  );
};

/** The intro alert (static copy) above the experiment groups. */
const Body = () => {
  const { t, ready } = useTranslation('labs');

  return (
    <Flexbox gap={16}>
      {ready ? (
        <Alert
          showIcon
          icon={FlaskConicalIcon}
          title={t('description')}
          type={'info'}
          variant={'filled'}
        />
      ) : (
        <SkeletonBar height={40} radius={8} />
      )}
      <LabsFormSkeleton />
    </Flexbox>
  );
};

const LabsSkeleton: SettingsTabSkeleton = { Body };

export default LabsSkeleton;
