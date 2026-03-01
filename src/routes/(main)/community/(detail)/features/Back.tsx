'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    back: css`
      color: ${cssVar.colorTextDescription};

      &:hover {
        color: ${cssVar.colorText};
      }
    `,
  };
});

const Back = memo<{ href: string; style?: CSSProperties }>(({ href, style }) => {
  const { t } = useTranslation('discover');

  return (
    <Link className={styles.back} style={{ marginBottom: 8, ...style }} to={href}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon icon={ArrowLeft} />
        {t(`back`)}
      </Flexbox>
    </Link>
  );
});

export default Back;
