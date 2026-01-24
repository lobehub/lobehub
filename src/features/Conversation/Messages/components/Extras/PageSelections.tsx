import type { PageSelection } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    padding-inline: 8px;
    border-inline-start: 3px solid ${token.colorBorderSecondary};
    border-radius: 0;
  `,
  content: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    margin-block-start: 0;

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
          {selection.startLine && (
            <Flexbox align="center" gap={4} horizontal>
              <Typography.Text className={styles.header}>
                <span>
                  {' '}
                  (
                  {t('pageSelection.lines', {
                    end: selection.endLine ?? selection.startLine,
                    start: selection.startLine,
                  })}
                  )
                </span>
              </Typography.Text>
            </Flexbox>
          )}
          <div className={styles.content}>{selection.content}</div>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default PageSelections;
