'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC, memo, type ReactNode } from 'react';

import { useDensity } from '@/styles/density';

import CredIcon from './CredIcon';
import { styles } from './style';

interface CredItemProps {
  cred: UserCredSummary;
  /** Opens the item's detail, which holds its edit, remove and sharing actions. */
  onClick: (cred: UserCredSummary) => void;
  /** Tags shown after the name (owner, sharing state). */
  tags?: ReactNode;
  /** Inline marker right after the name, e.g. the private lock in the workspace list. */
  titleSuffix?: ReactNode;
}

/**
 * One vault item: the website's logo (else the OAuth avatar or the type icon),
 * the name with its markers, and the description. The whole row opens it.
 */
const CredItem: FC<CredItemProps> = memo(({ cred, onClick, tags, titleSuffix }) => {
  const { compact, tokens } = useDensity();

  return (
    <Flexbox
      horizontal
      align="center"
      gap={tokens.sectionGap}
      role="button"
      tabIndex={0}
      className={
        stylex.props(styles.container, compact && styles.containerCompact, styles.clickable)
          .className
      }
      onClick={() => onClick(cred)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(cred);
        }
      }}
    >
      <div {...stylex.props(styles.icon, compact && styles.iconCompact)}>
        <CredIcon avatarSize={tokens.controlHeight} cred={cred} size={20} />
      </div>
      <Flexbox gap={compact ? 2 : 4} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <Flexbox horizontal align="center" gap={8}>
          <span {...stylex.props(styles.title, compact && styles.titleCompact)}>{cred.name}</span>
          {titleSuffix}
          {tags}
        </Flexbox>
        {cred.description && (
          <span {...stylex.props(styles.description, compact && styles.descriptionCompact)}>
            {cred.description}
          </span>
        )}
      </Flexbox>
    </Flexbox>
  );
});

CredItem.displayName = 'CredItem';

export default CredItem;
