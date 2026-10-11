import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { List, ListTree } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolsViewMode } from './useToolsViewMode';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

/**
 * Switches the Tools list between its grouped and flat views. Shared by both hosts —
 * the chat input's Tools popover and the "+" menu's skills submenu — so they always
 * show the same control for the same preference.
 */
const ToolsViewModeSwitch = memo(() => {
  const { t } = useTranslation('setting');
  const { updateViewMode, viewMode } = useToolsViewMode();

  const isFlat = viewMode === 'flat';

  return (
    <Tooltip title={t(isFlat ? 'tools.view.toggleToGrouped' : 'tools.view.toggleToFlat')}>
      <button
        aria-label={t(isFlat ? 'tools.view.flat' : 'tools.view.grouped')}
        className={styles.button}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          updateViewMode(isFlat ? 'grouped' : 'flat');
        }}
      >
        <Icon icon={isFlat ? List : ListTree} size={16} />
      </button>
    </Tooltip>
  );
});

ToolsViewModeSwitch.displayName = 'ToolsViewModeSwitch';

export default ToolsViewModeSwitch;
