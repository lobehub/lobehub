'use client';

import { type CredType } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type FC } from 'react';

import { CRED_TYPE_ICONS } from './credTypes';

const styles = stylex.create({
  icon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  title: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface CredModalTitleProps {
  title: string;
  type: CredType;
}

/**
 * The header of the create, edit and view modals: the credential type's icon
 * beside the title, so the modal says which kind of secret it holds before
 * any field does.
 */
const CredModalTitle: FC<CredModalTitleProps> = ({ title, type }) => (
  <Flexbox horizontal align={'center'} gap={12} style={{ minWidth: 0 }}>
    <span {...stylex.props(styles.icon)}>
      <Icon icon={CRED_TYPE_ICONS[type]} size={16} />
    </span>
    <span {...stylex.props(styles.title)}>{title}</span>
  </Flexbox>
);

export default CredModalTitle;
