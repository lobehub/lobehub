import { Icon, Tag } from '@lobehub/ui';
import {
  CheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CirclePauseIcon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { FlowNodeState } from './Verify/flow';

const META = {
  blocked: { color: 'warning', icon: CirclePauseIcon },
  failed: { color: 'error', icon: XIcon },
  partial: { color: 'warning', icon: CircleDotIcon },
  passed: { color: 'success', icon: CheckIcon },
  pending: { color: undefined, icon: CircleDashedIcon },
  uncertain: { color: 'warning', icon: CircleHelpIcon },
} as const;

export const stateIcon = (state: FlowNodeState) => META[state ?? 'pending'].icon;

const StatusTag = ({ state }: { state: FlowNodeState }) => {
  const { t } = useTranslation('verify');
  const key = state ?? 'pending';
  const meta = META[key];
  return (
    <Tag color={meta.color} icon={<Icon icon={meta.icon} />} size={'small'}>
      {t(`flow.state.${key}`)}
    </Tag>
  );
};

export default StatusTag;
