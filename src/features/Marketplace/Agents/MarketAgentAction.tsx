import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { RowAddAction } from '@/features/Settings/skill/features/RowActions';

import { useMarketAgentInstall } from './useMarketAgentInstall';

const styles = stylex.create({
  added: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    gap: 4,
    paddingInline: 8,
    fontSize: 13,
    color: cssVar.colorTextTertiary,
  },
});

/** "+" that adds a Marketplace Agent to mine, or "Added" once I have it. */
const MarketAgentAction = memo<{ id: string; onAdded?: () => void; title: string }>(
  ({ id, onAdded, title }) => {
    const { t } = useTranslation('discover');
    const { add, added, canCreate, pending } = useMarketAgentInstall(id, title);

    if (added)
      return (
        <span {...stylex.props(styles.added)}>
          <Icon icon={CheckIcon} size={14} />
          {t('marketplaceAgents.added')}
        </span>
      );

    return (
      <RowAddAction
        disabled={!canCreate}
        label={t('marketplaceAgents.add')}
        loading={pending}
        onClick={async () => {
          if ((await add()) && onAdded) onAdded();
        }}
      />
    );
  },
);

MarketAgentAction.displayName = 'MarketplaceAgentAction';

export default MarketAgentAction;
