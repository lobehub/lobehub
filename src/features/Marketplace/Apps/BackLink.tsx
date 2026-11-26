import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    height: 24,
    paddingInlineStart: 0,
    paddingInlineEnd: 6,
    marginInlineStart: -4,
    borderWidth: 0,
    borderRadius: cssVar.borderRadiusSM,
    font: 'inherit',
    fontSize: 13,
    color: {
      'default': cssVar.colorTextSecondary,
      ':hover': cssVar.colorText,
    },
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
});

/** "‹ Back" above a sub-page (an app, a category): quiet, and one size on every page. */
const BackLink = memo<{ onClick: () => void }>(({ onClick }) => {
  const { t } = useTranslation('discover');
  return (
    <button type={'button'} {...stylex.props(styles.link)} onClick={onClick}>
      <Icon icon={ChevronLeft} size={16} />
      {t('apps.back')}
    </button>
  );
});

BackLink.displayName = 'MarketplaceBackLink';

export default BackLink;
