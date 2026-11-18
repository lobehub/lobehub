import { type ItemType } from '@lobehub/ui';
import { Flexbox, Icon, usePopoverContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Settings, Zap } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { buildAgentProfileTabPath } from '@/features/AgentProfileTabs/tabOptions';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useAgentId } from '../../hooks/useAgentId';
import { ScrollSignalProvider } from './ScrollSignalContext';
import ToolsList from './ToolsList';

const styles = stylex.create({
  footer: {
    display: 'flex',
    gap: '14px',
    alignItems: 'center',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorFill,
  },
  header: {
    paddingBlock: '8px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorFill,
  },
  iconButton: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderStyle: 'none',
    borderRadius: '6px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'color 0.2s, background 0.2s',
  },
  statsItem: {
    display: 'inline-flex',
    gap: '5px',
    alignItems: 'center',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
  },
});

interface PopoverContentProps {
  autoCount: number;
  detailPopoverDisabled?: boolean;
  header: ReactNode;
  items: ItemType[];
  showFooter?: boolean;
}

const PopoverContent = memo<PopoverContentProps>(
  ({ autoCount, detailPopoverDisabled, header, items, showFooter = true }) => {
    const { t } = useTranslation('setting');
    const agentId = useAgentId();
    const navigate = useWorkspaceAwareNavigate();

    const { close: closePopover } = usePopoverContext();

    return (
      <Flexbox gap={0}>
        <div {...stylex.props(styles.header)}>{header}</div>
        <ScrollSignalProvider
          style={{
            maxHeight: 'min(50vh, 480px)',
            overflowY: 'auto',
          }}
        >
          <ToolsList detailPopoverDisabled={detailPopoverDisabled} items={items} />
        </ScrollSignalProvider>
        {showFooter && (
          <div {...stylex.props(styles.footer)}>
            <span {...stylex.props(styles.statsItem)}>
              <Icon icon={Zap} size={12} />
              {autoCount}
            </span>
            <Flexbox horizontal align="center" gap={2} style={{ marginInlineStart: 'auto' }}>
              <button
                aria-label={t('tools.picker.management')}
                {...stylex.props(styles.iconButton)}
                disabled={!agentId}
                type="button"
                onClick={() => {
                  if (!agentId) return;
                  closePopover();
                  navigate(buildAgentProfileTabPath(agentId, 'tools'));
                }}
              >
                <Icon icon={Settings} size={14} />
              </button>
            </Flexbox>
          </div>
        )}
      </Flexbox>
    );
  },
);

PopoverContent.displayName = 'PopoverContent';

export default PopoverContent;
