'use client';

import { createStaticStyles, Flexbox, Spin } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  viewAll: css`
    cursor: pointer;

    border: none;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    background: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

interface SectionTitleProps {
  /** The cards are the local copy and a refresh is in flight. */
  loading?: boolean;
  title: string;
  /** Target path of the "view all" affordance; omitted when there is no fuller view. */
  viewAllUrl?: string;
}

const SectionTitle = memo<SectionTitleProps>(({ loading, title, viewAllUrl }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <Flexbox horizontal align={'center'} justify={'space-between'}>
      <Flexbox horizontal align={'center'} gap={8}>
        <h2 className={styles.title}>{title}</h2>
        {loading && <Spin size="small" variant="network" />}
      </Flexbox>
      {viewAllUrl && (
        <button className={styles.viewAll} type={'button'} onClick={() => navigate(viewAllUrl)}>
          {t('home.viewAll')}
        </button>
      )}
    </Flexbox>
  );
});

SectionTitle.displayName = 'SectionTitle';

export default SectionTitle;
