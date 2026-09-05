'use client';

import { Flexbox, Tooltip } from '@lobehub/ui';
import { ActionIcon, Checkbox, Popover, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { SlidersHorizontalIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginTag from '@/features/ProfileEditor/PluginTag';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import {
  getShareApiAvailability,
  getShareToolAvailability,
  getShareToolGrantForIdentifier,
  toggleShareToolApi,
  toggleShareToolsetGrant,
} from './toolVisitorAvailability';
import type { AgentShareConfigPatch, AgentShareConfigState } from './useAgentShare';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  list: css`
    overflow-y: auto;
    max-height: 320px;
    padding-block: 6px;
    padding-inline: 12px;
  `,
  popup: css`
    width: 360px;
    max-width: calc(100vw - 32px);
  `,
  row: css`
    padding-block: 6px;
  `,
}));

interface ToolRowProps {
  agentId: string;
  onChange: (patch: AgentShareConfigPatch) => void;
  selected: boolean;
  shareConfig: AgentShareConfigState;
  toolId: string;
}

/**
 * One toolset row in the visitor tool picker: the existing selectable
 * `PluginTag` chip — checked for a full grant, indeterminate (minus) for a
 * partial per-API one, and toggling between them via
 * {@link toggleShareToolsetGrant} — plus a small "fine-tune" button — shown
 * only when the tool has more than one visitor-grantable API — that opens the
 * per-API checkbox list in a popover.
 *
 * A popover rather than an inline expansion on purpose: the chips flow in a
 * wrapped row, so expanding one in place reflows every chip after it and the
 * whole page below. The popover keeps the chip grid still and shows the
 * granted/total count next to the button so a partial grant is legible
 * without opening it.
 *
 * The API list comes from the REAL manifest (builtin registry or an installed
 * plugin/MCP manifest), the same source the server gate reads, so a tool this
 * build does not yet know the APIs of simply never offers the button rather
 * than stale/guessed entries.
 */
const ToolRow = memo<ToolRowProps>(({ agentId, toolId, selected, shareConfig, onChange }) => {
  const { t } = useTranslation('agent');
  const [open, setOpen] = useState(false);

  const builtinManifest = useToolStore(
    (s) => s.builtinTools.find((tool) => tool.identifier === toolId)?.manifest,
    isEqual,
  );
  const pluginManifest = useToolStore(pluginSelectors.getToolManifestById(toolId), isEqual);
  const apis = (builtinManifest ?? pluginManifest)?.api ?? [];
  const toolTitle = (builtinManifest ?? pluginManifest)?.meta?.title ?? toolId;

  const availability = getShareToolAvailability(toolId, {
    allowReadMemory: shareConfig.allowReadMemory,
  });
  // Anything short of `available` is disabled: the gate would strip the
  // grant, so accepting the tick would only confirm a permission that never
  // takes effect. The tooltip carries the reason.
  const blocked = availability !== 'available';

  const grantableApiNames = apis
    .filter(
      (api) => getShareApiAvailability(toolId, api.name, api.humanIntervention) === 'available',
    )
    .map((api) => api.name);
  const canConfigure = !blocked && grantableApiNames.length > 1;

  const grant = getShareToolGrantForIdentifier(shareConfig.toolGrants, toolId);
  const grantedCount =
    grant === 'all'
      ? grantableApiNames.length
      : grant instanceof Set
        ? grantableApiNames.filter((name) => grant.has(name)).length
        : 0;

  const toggleTool = () => {
    onChange((current) => ({
      toolGrants: toggleShareToolsetGrant(current.toolGrants, toolId),
    }));
  };

  const toggleApi = (apiName: string) => {
    onChange((current) => ({
      toolGrants: toggleShareToolApi(current.toolGrants, toolId, apiName, grantableApiNames),
    }));
  };

  const apiPicker = (
    <Flexbox className={styles.popup}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        gap={12}
        justify={'space-between'}
      >
        <Text ellipsis weight={500}>
          {toolTitle}
        </Text>
        <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
          {t('share.settings.tools.apiGrantedCount', {
            granted: String(grantedCount),
            total: String(grantableApiNames.length),
          })}
        </Text>
      </Flexbox>
      <Flexbox className={styles.list}>
        {apis.map((api) => {
          const apiAvailability = getShareApiAvailability(toolId, api.name, api.humanIntervention);
          const apiBlocked = apiAvailability !== 'available';
          const apiSelected = grant === 'all' || (grant instanceof Set && grant.has(api.name));

          return (
            <Tooltip
              key={api.name}
              placement={'left'}
              title={
                apiAvailability === 'writesOwnerData'
                  ? t('share.settings.tools.apiWritesOwnerData')
                  : apiBlocked
                    ? t('share.settings.tools.apiNotAvailableToVisitors')
                    : undefined
              }
            >
              <Flexbox className={styles.row}>
                <Checkbox
                  checked={!apiBlocked && apiSelected}
                  disabled={apiBlocked}
                  onChange={() => toggleApi(api.name)}
                >
                  <Flexbox gap={0} style={{ minWidth: 0 }}>
                    <Text fontSize={13}>{api.name}</Text>
                    {api.description && (
                      <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
                        {api.description}
                      </Text>
                    )}
                  </Flexbox>
                </Checkbox>
              </Flexbox>
            </Tooltip>
          );
        })}
      </Flexbox>
    </Flexbox>
  );

  return (
    <Flexbox horizontal align={'center'} gap={2}>
      <Tooltip
        title={
          availability === 'needsMemoryPermission'
            ? t('share.settings.tools.needsMemoryPermission')
            : blocked
              ? t('share.settings.tools.notAvailableToVisitors')
              : undefined
        }
      >
        <PluginTag
          selectable
          useAllMetaList
          agentId={agentId}
          disabled={blocked}
          indeterminate={grant instanceof Set}
          pluginId={toolId}
          selected={selected}
          onSelect={blocked ? undefined : toggleTool}
        />
      </Tooltip>
      {canConfigure && (
        <Popover
          content={apiPicker}
          open={open}
          placement={'bottomLeft'}
          styles={{ content: { padding: 0 } }}
          trigger={'click'}
          onOpenChange={setOpen}
        >
          <Flexbox horizontal align={'center'} gap={2}>
            <ActionIcon
              active={open}
              icon={SlidersHorizontalIcon}
              size={'small'}
              title={t('share.settings.tools.configureApis')}
            />
            {/* Only a PARTIAL grant needs the count: "all" and "none" already
                read from the chip's own checkbox state. */}
            {grant instanceof Set && (
              <Text fontSize={12} type={'secondary'}>
                {grantedCount}/{grantableApiNames.length}
              </Text>
            )}
          </Flexbox>
        </Popover>
      )}
    </Flexbox>
  );
});

ToolRow.displayName = 'AgentShareToolRow';

export default ToolRow;
