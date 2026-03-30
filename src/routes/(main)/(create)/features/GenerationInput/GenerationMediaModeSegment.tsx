'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Select, type SelectProps } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ImageIcon, Video } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export interface GenerationMediaModeSegmentProps {
  /** `hero`: large inline headline select (cyan, borderless). `toolbar`: compact control in the input bar. */
  layout?: 'hero' | 'toolbar';
  mode: 'image' | 'video';
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  lite: css`
    height: 36px;
  `,
  heroSelect: css`
    width: auto;
    font-size: inherit;
    line-height: 1.2;
  `,
  heroText: css`
    font-size: 24px;
    font-weight: 600;
    line-height: 1.2;
  `,
}));

const GenerationMediaModeSegment = memo<GenerationMediaModeSegmentProps>(
  ({ mode, layout = 'toolbar' }) => {
    const { t } = useTranslation('common');
    const navigate = useNavigate();
    const isHero = layout === 'hero';

    const options = useMemo<SelectProps['options']>(
      () => [
        {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              {!isHero && <Icon icon={ImageIcon} />}
              <span className={isHero ? styles.heroText : undefined}>{t('tab.image')}</span>
            </Flexbox>
          ),
          value: 'image',
        },
        {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              {!isHero && <Icon icon={Video} />}
              <span className={isHero ? styles.heroText : undefined}>{t('tab.video')}</span>
            </Flexbox>
          ),
          value: 'video',
        },
      ],
      [t, isHero],
    );

    const labelRender: SelectProps['labelRender'] = useCallback(
      (props: any) => {
        const v = String((props as { value?: string }).value ?? '');
        const isVideo = v === 'video';
        const text = isVideo ? t('tab.video') : t('tab.image');
        if (isHero) {
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
        }
        return (
          <Flexbox horizontal align="center" gap={6}>
            <Icon icon={isVideo ? Video : ImageIcon} size={16} />
            <span style={{ whiteSpace: 'nowrap' }}>{text}</span>
          </Flexbox>
        );
      },
      [isHero, t],
    );

    const handleChange = useCallback(
      (value: string) => {
        if (value === mode) return;
        navigate(value === 'video' ? '/video' : '/image');
      },
      [mode, navigate],
    );

    return (
      <Select
        className={isHero ? styles.heroSelect : styles.lite}
        labelRender={labelRender}
        options={options}
        popupMatchSelectWidth={false}
        size={isHero ? 'large' : 'middle'}
        value={mode}
        variant={isHero ? 'borderless' : 'filled'}
        onChange={handleChange}
      />
    );
  },
);

GenerationMediaModeSegment.displayName = 'GenerationMediaModeSegment';

export default GenerationMediaModeSegment;
