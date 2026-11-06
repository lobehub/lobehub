'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Segmented, type SegmentedOptions, Select, type SelectProps } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ImageIcon, Video } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

export interface GenerationMediaModeSegmentProps {
  /** `hero`: large labeled headline select. `toolbar`: compact icon-only toggle group. */
  layout?: 'hero' | 'toolbar';
  mode: 'image' | 'video';
}

const styles = stylex.create({
  heroSelect: { width: 'auto', fontSize: 'inherit', lineHeight: 1.2 },
  heroText: { fontSize: '24px', fontWeight: 600, lineHeight: 1.2 },
  toolbarItem: { width: '30px', height: '30px', paddingInline: '0' },
  toolbarLabel: { display: 'none' },
});

const GenerationMediaModeSegment = memo<GenerationMediaModeSegmentProps>(
  ({ mode, layout = 'toolbar' }) => {
    const { t } = useTranslation('common');
    const navigate = useWorkspaceAwareNavigate();
    const isHero = layout === 'hero';

    const heroOptions = useMemo<SelectProps['options']>(
      () => [
        {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <span {...stylex.props(styles.heroText)}>{t('tab.image')}</span>
            </Flexbox>
          ),
          value: 'image',
        },
        {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <span {...stylex.props(styles.heroText)}>{t('tab.video')}</span>
            </Flexbox>
          ),
          value: 'video',
        },
      ],
      [t],
    );

    const toolbarOptions = useMemo<SegmentedOptions<'image' | 'video'>>(
      () => [
        {
          icon: <Icon icon={ImageIcon} size={16} />,
          label: t('tab.image'),
          title: t('tab.image'),
          value: 'image',
        },
        {
          icon: <Icon icon={Video} size={16} />,
          label: t('tab.video'),
          title: t('tab.video'),
          value: 'video',
        },
      ],
      [t],
    );

    const labelRender: SelectProps['labelRender'] = useCallback(
      (props: any) => {
        const v = String((props as { value?: string }).value ?? '');
        const text = v === 'video' ? t('tab.video') : t('tab.image');
        return (
          <span
            style={{
              fontSize: 'inherit',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {text}
          </span>
        );
      },
      [t],
    );

    const handleChange = useCallback(
      (value: string) => {
        if (value === mode) return;
        navigate(value === 'video' ? '/video' : '/image');
      },
      [mode, navigate],
    );

    if (!isHero)
      return (
        <Segmented<'image' | 'video'>
          options={toolbarOptions}
          size={'small'}
          value={mode}
          classNames={{
            item: stylex.props(styles.toolbarItem).className,
            itemLabel: stylex.props(styles.toolbarLabel).className,
          }}
          onChange={handleChange}
        />
      );

    return (
      <Select
        className={stylex.props(styles.heroSelect).className}
        labelRender={labelRender}
        options={heroOptions}
        popupMatchSelectWidth={false}
        size={'large'}
        value={mode}
        variant={'borderless'}
        onChange={handleChange}
      />
    );
  },
);

GenerationMediaModeSegment.displayName = 'GenerationMediaModeSegment';

export default GenerationMediaModeSegment;
