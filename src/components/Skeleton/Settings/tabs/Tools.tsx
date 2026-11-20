'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '../../Bar';
import type { SettingsTabSkeleton } from './types';

const SECTIONS = [
  { key: 'search', rows: 5 },
  { key: 'crawler', rows: 4 },
] as const;

/**
 * `ToolSetting`'s two channel sections: real title + description (static
 * copy) above an outlined, 4px-inset list of `ChannelItem` rows (drag handle,
 * rank, 24px icon, name, small switch). Rendered as the page's own loading
 * state too, so the swap is in place.
 */
export const ToolsChannelsSkeleton = () => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox
      aria-busy
      data-testid={'settings-tools-skeleton'}
      gap={32}
      style={{ paddingBlock: 16 }}
    >
      {SECTIONS.map(({ key, rows }) => (
        <Flexbox gap={8} key={key}>
          <Text strong fontSize={16}>
            {t(`settingTool.${key}.title`)}
          </Text>
          <Text fontSize={13} type={'secondary'}>
            {t(`settingTool.${key}.desc`)}
          </Text>
          <Block padding={4} style={{ marginBlockStart: 8 }} variant={'outlined'}>
            {Array.from({ length: rows }, (_, index) => (
              <Flexbox
                horizontal
                align={'center'}
                gap={8}
                justify={'space-between'}
                key={index}
                paddingBlock={8}
                paddingInline={12}
              >
                <Flexbox horizontal align={'center'} gap={8}>
                  <SkeletonBar height={16} width={16} />
                  <span style={{ minWidth: 16 }} />
                  <Flexbox horizontal align={'center'} gap={10} height={24}>
                    <SkeletonBar height={24} radius={'50%'} width={24} />
                    <SkeletonBar height={14} width={80 + (index % 3) * 24} />
                  </Flexbox>
                </Flexbox>
                <SkeletonBar height={16} radius={8} width={28} />
              </Flexbox>
            ))}
          </Block>
        </Flexbox>
      ))}
    </Flexbox>
  );
};

const ToolsSkeleton: SettingsTabSkeleton = { Body: ToolsChannelsSkeleton };

export default ToolsSkeleton;
