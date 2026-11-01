'use client';

import { type CredType } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { File, Globe, Key, TerminalSquare } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  card: {
    cursor: 'pointer',
    borderRadius: cssVar.borderRadiusLG,
    transition: 'all 0.2s',
    borderColor: { 'default': null, ':hover': cssVar.colorPrimary },
    boxShadow: { 'default': null, ':hover': '0 2px 8px rgb(0 0 0 / 10%)' },
  },
  cardDisabled: { cursor: 'not-allowed', opacity: 0.5 },
  description: { fontSize: '12px', color: cssVar.colorTextSecondary, textAlign: 'center' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' },
  icon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    marginBlockEnd: '12px',
    borderRadius: '12px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  title: { marginBlockEnd: '4px', fontWeight: 500 },
});

interface CredTypeSelectorProps {
  disabled?: boolean;
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

const CredTypeSelector: FC<CredTypeSelectorProps> = ({ disabled, onSelect }) => {
  const { t } = useTranslation('setting');

  return (
    <div {...stylex.props(styles.grid)}>
      {typeConfigs.map(({ type, icon, description }) => (
        <Block
          className={stylex.props(styles.card, disabled && styles.cardDisabled).className}
          key={type}
          padding={12}
          variant={'outlined'}
          onClick={() => {
            if (disabled) return;
            onSelect(type);
          }}
        >
          <Flexbox align="center">
            <div {...stylex.props(styles.icon)}>{icon}</div>
            <div {...stylex.props(styles.title)}>{t(`creds.types.${type}`)}</div>
            <div {...stylex.props(styles.description)}>{t(description as any)}</div>
          </Flexbox>
        </Block>
      ))}
    </div>
  );
};

export default CredTypeSelector;
