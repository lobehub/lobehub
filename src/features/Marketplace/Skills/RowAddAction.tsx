import { ActionIcon } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { memo } from 'react';

/** The "+" at the end of every Market row (apps, skills, Agents): one style for all three. */
const RowAddAction = memo<{ loading?: boolean; onClick: () => void; title: string }>(
  ({ loading, onClick, title }) => (
    <ActionIcon
      aria-label={title}
      icon={PlusIcon}
      loading={loading}
      title={title}
      onClick={onClick}
    />
  ),
);

RowAddAction.displayName = 'MarketRowAddAction';

export default RowAddAction;
