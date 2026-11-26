'use client';

import { Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = stylex.create({
  heading: {
    alignItems: 'baseline',
    color: cssVar.colorText,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: cssVar.fontSizeHeading5,
    fontWeight: 600,
    gap: 8,
    marginBlock: 0,
  },
  link: {
    alignItems: 'center',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    display: 'inline-flex',
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
  },
  root: {
    alignItems: 'center',
    display: 'flex',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 32,
  },
});

interface SectionHeadingProps {
  count?: number;
  id: string;
  label: string;
  to?: string;
}

const SectionHeading = ({ count, id, label, to }: SectionHeadingProps) => {
  const { t, i18n } = useTranslation('discover');

  return (
    <div {...stylex.props(styles.root)}>
      <h2 id={id} {...stylex.props(styles.heading)}>
        {label}
        {count !== undefined && (
          <Text as={'span'} type={'secondary'} weight={400}>
            {count.toLocaleString(i18n.language)}
          </Text>
        )}
      </h2>
      {to && (
        <WorkspaceLink
          aria-label={t('catalog.viewAllIn', { name: label })}
          to={to}
          {...stylex.props(styles.link)}
        >
          <Icon aria-hidden icon={ChevronRight} size={16} />
        </WorkspaceLink>
      )}
    </div>
  );
};

export default SectionHeading;
