'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Checkbox, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
 * {@link toggleShareToolsetGrant} — plus an expand chevron
 * — shown only when the tool has more than one visitor-grantable API — that
 * reveals a per-API checkbox list underneath.
 *
 * The API list comes from the REAL manifest (builtin registry or an installed
 * plugin/MCP manifest), the same source the server gate reads, so a tool this
 * build does not yet know the APIs of simply never expands rather than
 * offering stale/guessed entries.
 */
const ToolRow = memo<ToolRowProps>(({ agentId, toolId, selected, shareConfig, onChange }) => {
  const { t } = useTranslation('agent');
  const [expanded, setExpanded] = useState(false);

  const builtinManifest = useToolStore(
    (s) => s.builtinTools.find((tool) => tool.identifier === toolId)?.manifest,
    isEqual,
  );
  const pluginManifest = useToolStore(pluginSelectors.getToolManifestById(toolId), isEqual);
  const apis = (builtinManifest ?? pluginManifest)?.api ?? [];

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
  const canExpand = !blocked && grantableApiNames.length > 1;

  const grant = getShareToolGrantForIdentifier(shareConfig.toolGrants, toolId);

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

  return (
    <Flexbox gap={2}>
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
        {canExpand && (
          <Icon
            icon={expanded ? ChevronDown : ChevronRight}
            size={14}
            style={{ color: cssVar.colorTextTertiary, cursor: 'pointer' }}
            onClick={() => setExpanded((prev) => !prev)}
          />
        )}
      </Flexbox>
      {expanded && canExpand && (
        <Flexbox gap={4} style={{ paddingInlineStart: 24 }}>
          {apis.map((api) => {
            const apiAvailability = getShareApiAvailability(
              toolId,
              api.name,
              api.humanIntervention,
            );
            const apiBlocked = apiAvailability !== 'available';
            const apiSelected = grant === 'all' || (grant instanceof Set && grant.has(api.name));

            return (
              <Tooltip
                key={api.name}
                title={
                  apiAvailability === 'writesOwnerData'
                    ? t('share.settings.tools.apiWritesOwnerData')
                    : apiBlocked
                      ? t('share.settings.tools.apiNotAvailableToVisitors')
                      : undefined
                }
              >
                <Checkbox
                  checked={!apiBlocked && apiSelected}
                  disabled={blocked || apiBlocked}
                  onChange={() => toggleApi(api.name)}
                >
                  <Flexbox gap={0}>
                    <Text fontSize={12}>{api.name}</Text>
                    {api.description && (
                      <Text ellipsis={{ rows: 1, tooltip: true }} fontSize={11} type={'secondary'}>
                        {api.description}
                      </Text>
                    )}
                  </Flexbox>
                </Checkbox>
              </Tooltip>
            );
          })}
        </Flexbox>
      )}
    </Flexbox>
  );
});

ToolRow.displayName = 'AgentShareToolRow';

export default ToolRow;
