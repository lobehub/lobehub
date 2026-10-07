'use client';

import { Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Hourglass,
  Loader2,
  type LucideIcon,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type CaseVerdict } from './verdict';

export const VERDICT_META: Record<
  CaseVerdict,
  { color: string; icon: LucideIcon; labelKey: string; spin?: boolean }
> = {
  completed: { color: 'processing', icon: CircleDot, labelKey: 'run.status.completed' },
  error: { color: 'warning', icon: TriangleAlert, labelKey: 'table.filter.error' },
  external: { color: 'purple', icon: Hourglass, labelKey: 'run.status.external' },
  failed: { color: 'error', icon: XCircle, labelKey: 'table.filter.failed' },
  passed: { color: 'success', icon: CheckCircle2, labelKey: 'table.filter.passed' },
  pending: { color: 'default', icon: CircleDashed, labelKey: 'run.status.pending' },
  running: { color: 'processing', icon: Loader2, labelKey: 'run.status.running', spin: true },
};

/** A case verdict as text + icon + color — never color alone. */
const VerdictTag = ({ verdict }: { verdict: CaseVerdict }) => {
  const { t } = useTranslation('eval');
  const meta = VERDICT_META[verdict];

  return (
    <Tag color={meta.color} icon={<Icon icon={meta.icon} size={12} spin={meta.spin} />}>
      {t(meta.labelKey as any)}
    </Tag>
  );
};

export default VerdictTag;
