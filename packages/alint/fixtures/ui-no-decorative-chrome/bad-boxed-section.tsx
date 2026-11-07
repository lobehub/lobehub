// Fixture: a bordered, filled box with a bold restating title around one list.
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  // alint-expect
  box: css`
    padding: 16px;
    border: 2px solid ${cssVar.colorBorder};
    border-radius: 8px;
    background: ${cssVar.colorFillTertiary};
  `,
  title: css`
    padding-block-end: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    font-weight: 600;
  `,
}));

const IntegrationsSection = memo<{ children: ReactNode }>(({ children }) => {
  const { t } = useTranslation('setting');

  return (
    <div className={styles.box}>
      <div className={styles.title}>{t('integrations.title')}</div>
      <Flexbox gap={8}>{children}</Flexbox>
    </div>
  );
});

export default IntegrationsSection;
