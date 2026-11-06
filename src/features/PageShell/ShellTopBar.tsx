'use client';

import { cssVar as cssVarValue, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, ChevronsUpDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useActiveWorkspace } from '@/business/client/hooks/useActiveWorkspace';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { ProductLogo } from '@/components/Branding';
import WorkspaceAvatar from '@/components/WorkspaceAvatar';
import UserAvatar from '@/features/User/UserAvatar';

/**
 * The application bar for pages that live OUTSIDE the main left-nav shell.
 *
 * The product's primary chrome is a vertical rail, which suits surfaces you
 * browse. A page someone was linked to needs the opposite: name the product
 * and the collection along the top edge, then get out of the way. Routes like
 * `/acceptance` are registered outside `(main)`, so without this bar they
 * begin at the very top of the window with no chrome at all — which is what
 * makes a standalone, shareable page read as an inner pane of a console.
 *
 * The bar owns no data beyond the workspace scope; the collection supplies its
 * own title, its menu, and where "back" goes.
 */
interface ShellTopBarProps {
  /** Trailing controls placed before the user avatar. */
  actions?: ReactNode;
  /**
   * Brand click target. The brand mark doubles as the way out: hovering swaps
   * it for a back arrow rather than spending a second slot on a control that
   * is only occasionally wanted.
   */
  onBack?: () => void;
  /**
   * Replaces the read-only workspace pill, e.g. with a control that switches
   * the page's scope. Rendered in personal scope too.
   */
  scope?: ReactNode;
  /** The collection this page belongs to, e.g. Deliveries. */
  title?: ReactNode;
  /** Sits right after the title — typically the button opening the list drawer. */
  titleExtra?: ReactNode;
}

// The brand mark swaps for a back arrow while the (interactive) brand is hovered.
const styles = stylex.create({
  back: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
  },
  brand: {
    position: 'relative',
    inlineSize: '26px',
    blockSize: '26px',
    borderRadius: cssVar.borderRadius,
  },
  brandInteractive: { cursor: 'pointer' },
  mark: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    opacity: 1,
  },
  markInteractive: {
    opacity: { default: 1, [stylex.when.ancestor(':hover')]: 0 },
  },
  root: {
    flex: 'none',
    blockSize: '48px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  scopePill: {
    cursor: 'default',
    paddingBlock: '3px',
    paddingInline: '6px',
    borderRadius: cssVar.borderRadius,
  },
});

const ShellTopBar = ({ actions, onBack, scope, title, titleExtra }: ShellTopBarProps) => {
  const workspace = useActiveWorkspace();
  const workspaces = useWorkspaces();

  // The pill is a SCOPE SWITCHER, not an identity label. Personal scope has no
  // scope to switch to, so the bar is the product, the collection, and you.
  const switchable = workspaces.length > 1;
  const scopeName = workspace?.name;

  return (
    <Flexbox horizontal align={'center'} className={stylex.props(styles.root).className} gap={8}>
      <div
        {...stylex.props(
          styles.brand,
          onBack && styles.brandInteractive,
          onBack && stylex.defaultMarker(),
        )}
        onClick={onBack}
      >
        <div {...stylex.props(styles.mark, onBack && styles.markInteractive)}>
          <ProductLogo size={22} />
        </div>
        {onBack && (
          <div {...stylex.props(styles.back)}>
            <Icon icon={ArrowLeft} size={17} />
          </div>
        )}
      </div>

      {title && (
        <Text ellipsis fontSize={15} style={{ minWidth: 0 }} weight={600}>
          {title}
        </Text>
      )}
      {titleExtra}

      {scope ??
        (scopeName && (
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.scopePill).className}
            gap={6}
          >
            <WorkspaceAvatar avatar={workspace?.avatar} name={scopeName} size={20} />
            <Text fontSize={13} weight={600}>
              {scopeName}
            </Text>
            {switchable && <ChevronsUpDownIcon color={cssVarValue.colorTextQuaternary} size={12} />}
          </Flexbox>
        ))}

      <Flexbox flex={1} />
      {actions}
      <UserAvatar clickable size={26} />
    </Flexbox>
  );
};

export default ShellTopBar;
