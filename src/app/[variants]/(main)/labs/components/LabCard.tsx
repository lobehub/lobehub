'use client';

import { Switch } from 'antd';
import { createStyles } from 'antd-style';
import Image from 'next/image';
import { PropsWithChildren, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

interface LabCardProps {
  checked: boolean;
  cover?: string;
  desc: string;
  loading: boolean;
  meta?: string;
  onChange: (v: boolean) => void;
  title: string;
}

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    width: 100%;
    max-width: 800px;
    margin-block: 0;
    margin-inline: auto;
    padding: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;

    background: ${token.colorBgContainer};
  `,
  desc: css`
    color: ${token.colorTextSecondary};
  `,
  meta: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
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
    border-radius: ${token.borderRadiusLG}px;

    background: linear-gradient(135deg, ${token.colorFillTertiary}, ${token.colorFillQuaternary});
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  wrap: css`
    width: 100%;
  `,
}));

const LabCard = memo<PropsWithChildren<LabCardProps>>(
  ({ title, desc, checked, onChange, meta, loading, cover }) => {
    const { styles } = useStyles();

    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.row}>
            <div className={styles.thumb}>
              {cover && <Image alt={title} fill src={cover} style={{ objectFit: 'cover' }} />}
            </div>
            <Flexbox gap={6}>
              <div className={styles.title}>{title}</div>
              <div className={styles.desc}>{desc}</div>
              {meta ? <div className={styles.meta}>{meta}</div> : null}
            </Flexbox>
            {!loading && (
              <Flexbox align={'flex-end'} height={'100%'} justify={'center'} paddingInline={8}>
                <Switch checked={checked} onChange={onChange} />
              </Flexbox>
            )}
          </div>
        </div>
      </div>
    );
  },
);

LabCard.displayName = 'LabCard';

export default LabCard;
