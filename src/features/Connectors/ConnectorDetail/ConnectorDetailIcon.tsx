import { Center } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

import ConnectorBrandIcon from '../ConnectorBrandIcon';

const ICON_SIZE = { large: 40, middle: 28 } as const;

const styles = stylex.create({
  tile: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    flex: 'none',
    height: 48,
    overflow: 'hidden',
    width: 48,
  },
  tileLarge: {
    borderRadius: cssVar.borderRadiusLG,
    height: 64,
    width: 64,
  },
});

interface ConnectorDetailIconProps {
  connector: Pick<ConnectorWithTools, 'identifier' | 'name' | 'sourceType'>;
  /** `large` heads the detail page; `middle` sits in denser layouts. */
  size?: keyof typeof ICON_SIZE;
}

/**
 * The same brand mark the list row shows, so the detail page reads as the
 * row it was opened from.
 */
const ConnectorDetailIcon = memo<ConnectorDetailIconProps>(({ connector, size = 'middle' }) => (
  <Center {...stylex.props(styles.tile, size === 'large' && styles.tileLarge)}>
    <ConnectorBrandIcon
      identifier={connector.identifier}
      name={connector.name}
      size={ICON_SIZE[size]}
      sourceType={connector.sourceType}
    />
  </Center>
));

ConnectorDetailIcon.displayName = 'ConnectorDetailIcon';

export default ConnectorDetailIcon;
