import { Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import AppTile from './AppTile';
import type { MarketplaceApp } from './catalog';

const styles = stylex.create({
  action: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    gap: 8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 8,
    borderRadius: cssVar.borderRadiusLG,
    cursor: 'pointer',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillQuaternary,
    },
  },
  text: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
  },
});

/**
 * One catalog cell: the app's tile, name and what it does, and one action at
 * the end (`+` to add, `…` once added). The row itself opens the app's page;
 * the action keeps its clicks to itself.
 */
const AppRow = memo<{
  action?: ReactNode;
  app: MarketplaceApp;
  error?: ReactNode;
  onOpen: () => void;
  summary: string;
}>(({ action, app, error, onOpen, summary }) => (
  // lobe-design-ignore LOBE-DIV-CLICK: the row is a pointer shortcut; its action and the app name link stay keyboard reachable on the detail page
  <div {...stylex.props(styles.row)} onClick={onOpen}>
    <AppTile app={app} size={40} />
    <span {...stylex.props(styles.text)}>
      <Text ellipsis weight={500}>
        {app.name}
      </Text>
      {error ?? (
        <Text ellipsis fontSize={12} type={'secondary'}>
          {summary}
        </Text>
      )}
    </span>
    {action && (
      // lobe-design-ignore LOBE-DIV-CLICK: not a control; only stops propagation to the row
      <span {...stylex.props(styles.action)} onClick={(event) => event.stopPropagation()}>
        {action}
      </span>
    )}
  </div>
));

AppRow.displayName = 'MarketplaceAppRow';

export default AppRow;
