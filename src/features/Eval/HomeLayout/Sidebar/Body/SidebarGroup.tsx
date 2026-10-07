'use client';

import { Flexbox } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
  Button,
  Text,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type LucideIcon, RotateCw } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { isModifierClick } from '@/utils/navigation';

const styles = createStaticStyles(({ css }) => ({
  count: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextQuaternary};
  `,
  hint: css`
    padding-block: 6px;
    padding-inline: 12px;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export interface SidebarGroupItem {
  href: string;
  icon: LucideIcon;
  id: string;
  title: string;
}

interface SidebarGroupProps {
  activeHref?: string;
  /** Shown when the group settled with no items: what belongs here. */
  emptyHint: ReactNode;
  error?: unknown;
  isLoading: boolean;
  itemKey: string;
  items: SidebarGroupItem[];
  onRetry: () => void;
  title: ReactNode;
}

/**
 * One collapsible group of the eval sidebar. Every group shares the same
 * four states — loading skeleton, error + retry, empty hint, item list — so the
 * groups read as one navigation, not three hand-rolled lists.
 */
const SidebarGroup = ({
  activeHref,
  emptyHint,
  error,
  isLoading,
  itemKey,
  items,
  onRetry,
  title,
}: SidebarGroupProps) => {
  const { t } = useTranslation('eval');
  const { t: tCommon } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();

  const body = (() => {
    if (isLoading) return <SkeletonList rows={2} />;

    if (error && items.length === 0) {
      return (
        <Flexbox align="flex-start" gap={4} paddingInline={4}>
          <span className={styles.hint}>{t('home.sidebar.loadFailed')}</span>
          <Button icon={RotateCw} size="small" type="text" onClick={onRetry}>
            {tCommon('retry')}
          </Button>
        </Flexbox>
      );
    }

    if (items.length === 0) return <span className={styles.hint}>{emptyHint}</span>;

    return items.map((item) => (
      <WorkspaceLink
        key={item.id}
        to={item.href}
        onClick={(e) => {
          if (isModifierClick(e)) return;
          e.preventDefault();
          navigate(item.href);
        }}
      >
        <NavItem
          active={activeHref === item.href}
          icon={item.icon}
          iconSize={16}
          title={item.title}
        />
      </WorkspaceLink>
    ));
  })();

  return (
    <AccordionItem value={itemKey}>
      <AccordionHeader style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
        <AccordionTrigger>
          <Flexbox horizontal align="center" gap={6}>
            <Text ellipsis fontSize={12} type="secondary" weight={500}>
              {title}
            </Text>
            {items.length > 0 && <span className={styles.count}>{items.length}</span>}
          </Flexbox>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel>
        <Flexbox gap={1} paddingBlock={1}>
          {body}
        </Flexbox>
      </AccordionPanel>
    </AccordionItem>
  );
};

export default SidebarGroup;
