'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

import CardBanner from '../../components/CardBanner';

const styles = createStaticStyles(({ css, cssVar }) => ({
  background: css`
    pointer-events: none;

    position: absolute;
    z-index: 0;
    inset: 0;
    transform: scale(3);

    overflow: hidden;

    &::before {
      content: '';

      position: absolute;
      z-index: 1;
      inset: 0;

      width: 100%;
      height: 100%;

      background: color-mix(in srgb, ${cssVar.colorBgContainer} 50%, transparent);
    }
  `,
  container: css`
    position: relative;
    overflow: hidden;
    border-radius: ${cssVar.borderRadiusLG};
    box-shadow:
      0 0 0 1px ${cssVar.colorFill} inset,
      ${cssVar.boxShadowTertiary};
  `,
  header: css`
    position: relative;
    overflow: hidden;
    height: 58px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface HighlightBlockProps extends FlexboxProps {
  avatar?: string | ReactNode;
  icon: LucideIcon;
  title: string;
}

const HighlightBlock = memo<HighlightBlockProps>(({ avatar, title, icon, children, ...rest }) => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  return (
    <Flexbox className={styles.container} flex={'none'} width={'100%'} {...rest}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        flex={'none'}
        gap={12}
        padding={16}
      >
        <Icon icon={icon} size={20} style={{ zIndex: 1 }} />
        <h2 style={{ fontSize: 16, fontWeight: 'bold', margin: 0, zIndex: 1 }}>{title}</h2>
        <CardBanner avatar={avatar} className={styles.background} size={mobile ? 64 : 512} />
      </Flexbox>
      {children}
    </Flexbox>
  );
});

export default HighlightBlock;
