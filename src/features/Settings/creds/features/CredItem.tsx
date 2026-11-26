'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC, memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDensity } from '@/styles/density';

import CredIcon from './CredIcon';
import { styles } from './style';

interface CredItemProps {
  cred: UserCredSummary;
  /** Right-aligned row meta, e.g. the workspace visibility tag and the author avatar. */
  extra?: ReactNode;
  /** Opens the item's detail, which holds its edit, remove and sharing actions. */
  onClick: (cred: UserCredSummary) => void;
  /** Tags shown after the name (owner, sharing state). */
  tags?: ReactNode;
  /** Inline marker right after the name, e.g. the private lock in the workspace list. */
  titleSuffix?: ReactNode;
}

/**
 * One vault item: the website's logo (else the OAuth avatar or the type icon),
 * the name with its markers, and one line of "type · account · description".
 * The whole row opens it.
 */
const CredItem: FC<CredItemProps> = memo(({ cred, extra, onClick, tags, titleSuffix }) => {
  const { t } = useTranslation('setting');
  const { compact, tokens } = useDensity();

  const subtitle = [t(`creds.types.${cred.type}`), cred.oauthUsername, cred.description]
    .filter(Boolean)
    .join(' · ');

  return (
    <Flexbox
      horizontal
      align="center"
      aria-label={cred.name}
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
        <span {...stylex.props(styles.description, compact && styles.descriptionCompact)}>
          {subtitle}
        </span>
      </Flexbox>
      {extra && (
        <Flexbox horizontal align="center" flex={'none'} gap={8}>
          {extra}
        </Flexbox>
      )}
    </Flexbox>
  );
});

CredItem.displayName = 'CredItem';

export default CredItem;
