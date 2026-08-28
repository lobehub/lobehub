'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
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
  title: string;
  /** Target path of the "view all" affordance; omitted when there is no fuller view. */
  viewAllUrl?: string;
}

const SectionTitle = memo<SectionTitleProps>(({ title, viewAllUrl }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <Flexbox horizontal align={'center'} justify={'space-between'}>
      <h2 className={styles.title}>{title}</h2>
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
