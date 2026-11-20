import { Flexbox, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import WideScreenContainer from '@/features/WideScreenContainer';

import { styles } from './styles';

/**
 * Stands in for the composer while a shared Agent's owner reads a visitor's conversation with it:
 * the owner can follow the conversation but never takes part in it.
 */
export function ReadOnlyNotice() {
  const { t } = useTranslation('channel');

  return (
    <WideScreenContainer fullWidth paddingInline={8}>
      <div role="status" {...stylex.props(styles.archivedNotice)}>
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          <Icon icon={Eye} size={16} />
          <span>{t('shareVisitorReadOnlyNotice')}</span>
        </Flexbox>
      </div>
    </WideScreenContainer>
  );
}
