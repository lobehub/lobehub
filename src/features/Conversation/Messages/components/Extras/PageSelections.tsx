import type { PageSelection } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { createStyles } from 'antd-style';
import { FileText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorFillQuaternary};
  `,
  content: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorTextSecondary};
    white-space: pre-wrap;
  `,
  header: css`
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextDescription};
  `,
  icon: css`
    color: ${token.colorTextTertiary};
  `,
}));

interface PageSelectionsProps {
  selections: PageSelection[];
}

const PageSelections = memo<PageSelectionsProps>(({ selections }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('chat');

  if (!selections || selections.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {selections.map((selection) => (
        <Flexbox className={styles.container} gap={8} key={selection.id}>
          <Flexbox align="center" gap={4} horizontal>
            <FileText className={styles.icon} size={14} />
            <Typography.Text className={styles.header}>
              {t('pageSelection.reference')}
              {selection.startLine !== undefined && (
                <span>
                  {' '}
                  (
                  {t('pageSelection.lines', {
                    end: selection.endLine ?? selection.startLine,
                    start: selection.startLine,
                  })}
                  )
                </span>
              )}
            </Typography.Text>
          </Flexbox>
          <div className={styles.content}>{selection.content}</div>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default PageSelections;
