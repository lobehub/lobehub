'use client';

import { type CredType } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Card } from 'antd';
import { createStaticStyles } from 'antd-style';
import { File, Globe, Key, TerminalSquare } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 2px 8px rgb(0 0 0 / 10%);
    }
  `,
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  `,
  icon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    margin-block-end: 12px;
    border-radius: 12px;

    background: ${cssVar.colorFillSecondary};
  `,
  title: css`
    margin-block-end: 4px;
    font-weight: 500;
  `,
}));

interface CredTypeSelectorProps {
  onSelect: (type: CredType) => void;
}

const typeConfigs: Array<{
  description: string;
  icon: React.ReactNode;
  type: CredType;
}> = [
  {
    description: 'creds.typeDesc.kv-env',
    icon: <TerminalSquare size={24} />,
    type: 'kv-env',
  },
  {
    description: 'creds.typeDesc.kv-header',
    icon: <Globe size={24} />,
    type: 'kv-header',
  },
  {
    description: 'creds.typeDesc.oauth',
    icon: <Key size={24} />,
    type: 'oauth',
  },
  {
    description: 'creds.typeDesc.file',
    icon: <File size={24} />,
    type: 'file',
  },
];

const CredTypeSelector: FC<CredTypeSelectorProps> = ({ onSelect }) => {
  const { t } = useTranslation('setting');

  return (
    <div className={styles.grid}>
      {typeConfigs.map(({ type, icon, description }) => (
        <Card className={styles.card} key={type} size="small" onClick={() => onSelect(type)}>
          <Flexbox align="center">
            <div className={styles.icon}>{icon}</div>
            <div className={styles.title}>{t(`creds.types.${type}`)}</div>
            <div className={styles.description}>{t(description as any)}</div>
          </Flexbox>
        </Card>
      ))}
    </div>
  );
};

export default CredTypeSelector;
