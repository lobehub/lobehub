import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const styles = createStaticStyles(({ css }) => {
  return {
    container: css`
      width: fit-content;
      height: 24px;
      padding-inline: 8px;
      border-radius: 6px;

      color: ${cssVar.colorTextTertiary};

      &:hover {
        color: ${cssVar.colorTextSecondary};
        background: ${cssVar.colorFillTertiary};
      }
    `,
  };
});

interface GoBackProps {
  href: string;
}

const GoBack = memo<GoBackProps>(({ href }) => {
  const { t } = useTranslation('components');

  return (
    <Link to={href}>
      <Flexbox horizontal align={'center'} className={styles.container} gap={4}>
        <Icon icon={ArrowLeft} />
        <div>{t('GoBack.back')}</div>
      </Flexbox>
    </Link>
  );
});

export default GoBack;
