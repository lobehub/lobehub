'use client';

import { ActionIcon, CopyButton, Flexbox, Markdown, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ExternalLink, FileTextIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    padding-inline: 16px;
    font-size: 14px;
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  icon: css`
    color: ${cssVar.colorPrimary};
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface PageCardProps {
  content: string;
  pageId?: string;
  title: string;
}

const PageCard = memo<PageCardProps>(({ content, pageId, title }) => {
  const { t } = useTranslation('plugin');
  const navigate = useNavigate();

  const handleOpen = () => {
    if (!pageId) return;
    navigate(`/page/${pageId}`);
  };

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <FileTextIcon className={styles.icon} size={16} />
        <Flexbox flex={1}>
          <div className={styles.title}>{title}</div>
        </Flexbox>
        <TooltipGroup>
          <Flexbox horizontal gap={4}>
            <CopyButton
              content={content}
              size={'small'}
              title={t('builtins.lobe-personal-pages.actions.copy')}
            />
            {pageId && (
              <ActionIcon
                icon={ExternalLink}
                size={'small'}
                title={t('builtins.lobe-personal-pages.actions.open')}
                onClick={handleOpen}
              />
            )}
          </Flexbox>
        </TooltipGroup>
      </Flexbox>
      <ScrollShadow className={styles.content} offset={12} size={12} style={{ maxHeight: 400 }}>
        <Markdown style={{ overflow: 'unset', paddingBottom: 16 }} variant={'chat'}>
          {content}
        </Markdown>
      </ScrollShadow>
    </Flexbox>
  );
});

export default PageCard;
