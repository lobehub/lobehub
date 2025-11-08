import { Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { useNavigate } from 'react-router-dom';

const useStyles = createStyles(({ css, token }) => {
  return {
    container: css`
      cursor: pointer;

      width: fit-content;
      height: 24px;
      padding-inline: 8px;
      border-radius: 6px;

      color: ${token.colorTextTertiary};

      &:hover {
        color: ${token.colorTextSecondary};
        background: ${token.colorFillTertiary};
      }
    `,
  };
});

interface GoBackProps {
  /**
   * The path to navigate to (relative to MemoryRouter)
   * e.g., "/" for /knowledge, "/bases" for /knowledge/bases
   */
  to: string;
}

/**
 * GoBack component for react-router-dom
 * Uses useNavigate instead of Next.js Link
 */
const GoBack = memo<GoBackProps>(({ to }) => {
  const { t } = useTranslation('components');
  const { styles } = useStyles();
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(to);
  };

  return (
    <Flexbox align={'center'} className={styles.container} gap={4} horizontal onClick={handleClick}>
      <Icon icon={ArrowLeft} />
      <div>{t('GoBack.back')}</div>
    </Flexbox>
  );
});

GoBack.displayName = 'GoBack';

export default GoBack;
