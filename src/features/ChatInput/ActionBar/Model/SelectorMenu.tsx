import { ModelIcon } from '@lobehub/icons';
import {
  DropdownMenuItem,
  DropdownMenuItemContent,
  DropdownMenuItemExtra,
  DropdownMenuItemLabel,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuSubmenuArrow,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger,
  renderDropdownMenuItems,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelSwitchSubmenuPopup } from '@/features/ModelSwitchPanel';

import type { SelectorSubmenuItem } from '../../components/buildSelectorSubmenu';
import { buildSelectorSubmenu } from '../../components/buildSelectorSubmenu';
import type { ReasoningEffortControl } from '../../hooks/useReasoningEffortControl';
import { type DropdownPlacement } from '../context';

const styles = createStaticStyles(({ css }) => ({
  meta: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    max-width: 150px;

    /* The packaged extra slot defaults to the code font (it is styled for
       keyboard hints); a model name belongs in the UI font. */
    font-family: ${cssVar.fontFamily};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  name: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  popup: css`
    width: 240px;
  `,
}));

/**
 * The effort rows go through `renderDropdownMenuItems`, which draws base-ui's own
 * submenu arrow. That glyph is not exported, so the hand-built model row would
 * otherwise sit next to them wearing a different arrow.
 */
const SubmenuArrow = () => (
  <svg
    aria-hidden
    fill="currentColor"
    stroke="currentColor"
    strokeLinejoin="round"
    strokeWidth={1.5}
    viewBox="0 0 16 16"
  >
    <path d="M6 5l4 3-4 3z" />
  </svg>
);

interface SelectorMenuProps {
  canSelectModel: boolean;
  children: ReactNode;
  displayName: string;
  effort: ReasoningEffortControl;
  model: string;
  onModelChange: (params: { model: string; provider: string }) => Promise<void>;
  openOnHover?: boolean;
  placement?: DropdownPlacement;
  provider: string;
}

/**
 * Model + reasoning effort as one control: the collapsed menu names both
 * current values, and each opens its own submenu — the model one mounting the
 * full model panel. Mirrors the heterogeneous-agent selector so both chat
 * surfaces read the same way.
 */
const SelectorMenu = memo<SelectorMenuProps>(
  ({
    canSelectModel,
    children,
    displayName,
    effort,
    model,
    onModelChange,
    openOnHover = false,
    placement = 'topLeft',
    provider,
  }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);

    const {
      effortKey,
      effortLevels,
      effortValue,
      hasReasoningMode,
      modeLevels,
      modeValue,
      select,
    } = effort;

    // The model panel commits on click and then asks its host to close; here
    // that host is the whole model+effort menu, not a panel of its own.
    const handleModelPanelOpenChange = useCallback((nextOpen: boolean) => {
      if (!nextOpen) setOpen(false);
    }, []);

    const items = useMemo(() => {
      const rows: SelectorSubmenuItem[] = [];

      if (effortKey)
        rows.push(
          buildSelectorSubmenu({
            current: effortValue ?? '',
            label: t('reasoningEffort.title'),
            onSelect: (value: string) => select({ [effortKey]: value }),
            options: effortLevels.map((level) => ({
              label: t(`reasoningEffort.levels.${level}`),
              value: level,
            })),
            valueLabel: effortValue ? t(`reasoningEffort.levels.${effortValue}`) : '',
          }),
        );

      if (hasReasoningMode)
        rows.push(
          buildSelectorSubmenu({
            current: modeValue,
            label: t('extendParams.reasoningMode.title'),
            onSelect: (value: string) => select({ reasoningMode: value as typeof modeValue }),
            options: modeLevels.map((mode) => ({
              label: t(`reasoningEffort.mode.${mode}`),
              value: mode,
            })),
            valueLabel: t(`reasoningEffort.mode.${modeValue}`),
          }),
        );

      return rows;
    }, [effortKey, effortLevels, effortValue, hasReasoningMode, modeLevels, modeValue, select, t]);

    const modelMeta = (
      <DropdownMenuItemExtra className={styles.meta}>
        <ModelIcon model={model} size={16} />
        <span className={styles.name}>{displayName}</span>
      </DropdownMenuItemExtra>
    );

    return (
      <DropdownMenuRoot open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger openOnHover={openOnHover}>{children}</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner hoverTrigger={openOnHover} placement={placement} sideOffset={8}>
            <DropdownMenuPopup className={styles.popup}>
              {canSelectModel ? (
                <DropdownMenuSubmenuRoot>
                  <DropdownMenuSubmenuTrigger label={t('modelSelector.model')}>
                    <DropdownMenuItemContent>
                      <DropdownMenuItemLabel>{t('modelSelector.model')}</DropdownMenuItemLabel>
                      {modelMeta}
                      <DropdownMenuSubmenuArrow>
                        <SubmenuArrow />
                      </DropdownMenuSubmenuArrow>
                    </DropdownMenuItemContent>
                  </DropdownMenuSubmenuTrigger>
                  <ModelSwitchSubmenuPopup
                    model={model}
                    provider={provider}
                    onModelChange={onModelChange}
                    onOpenChange={handleModelPanelOpenChange}
                  />
                </DropdownMenuSubmenuRoot>
              ) : (
                // Locked model (agent-pinned or use-only access): still name it,
                // since reasoning effort below stays the user's to change.
                <DropdownMenuItem disabled closeOnClick={false}>
                  <DropdownMenuItemContent>
                    <DropdownMenuItemLabel>{t('modelSelector.model')}</DropdownMenuItemLabel>
                    {modelMeta}
                  </DropdownMenuItemContent>
                </DropdownMenuItem>
              )}
              {renderDropdownMenuItems(items)}
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    );
  },
);

SelectorMenu.displayName = 'ModelSelectorMenu';

export default SelectorMenu;
