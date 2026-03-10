'use client';

import { Flexbox } from '@lobehub/ui';
import { Switch } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { SkeletonSwitch } from '@/components/Skeleton';
import Image from '@/libs/next/Image';

interface LabCardProps {
  checked: boolean;
  cover?: string;
  desc: string;
  loading: boolean;
  meta?: string;
  onChange: (v: boolean) => void;
  title: string;
}

const styles = createStaticStyles(({ css }) => ({
  card: css`
    width: 100%;
    max-width: 800px;
    margin-block: 0;
    margin-inline: auto;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
  `,
  desc: css`
    color: ${cssVar.colorTextSecondary};
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    display: grid;
    grid-template-columns: 250px 1fr 80px;
    gap: 16px;
    align-items: center;
  `,
  thumb: css`
    position: relative;

    overflow: hidden;

    width: 250px;
    height: 150px;
    border-radius: ${cssVar.borderRadiusLG};

    background: linear-gradient(135deg, ${cssVar.colorFillTertiary}, ${cssVar.colorFillQuaternary});
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  wrap: css`
    width: 100%;
  `,
}));

const LabCard = memo<PropsWithChildren<LabCardProps>>(
  ({ title, desc, checked, onChange, meta, loading, cover }) => {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.row}>
            <div className={styles.thumb}>
              {cover && (
                <Image fill unoptimized alt={title} src={cover} style={{ objectFit: 'cover' }} />
              )}
            </div>
            <Flexbox gap={6}>
              <div className={styles.title}>{title}</div>
              <div className={styles.desc}>{desc}</div>
              {meta ? <div className={styles.meta}>{meta}</div> : null}
            </Flexbox>
            <Flexbox align={'flex-end'} height={'100%'} justify={'center'} paddingInline={8}>
              {loading ? <SkeletonSwitch /> : <Switch checked={checked} onChange={onChange} />}
            </Flexbox>
          </div>
        </div>
      </div>
    );
  },
);

LabCard.displayName = 'LabCard';

export default LabCard;
