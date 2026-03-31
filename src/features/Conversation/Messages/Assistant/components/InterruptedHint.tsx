import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const InterruptedHint = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <div className={styles.container}>
      {t('messageAction.interrupted')} · {t('messageAction.interruptedHint')}
    </div>
  );
});

InterruptedHint.displayName = 'InterruptedHint';

export default InterruptedHint;
