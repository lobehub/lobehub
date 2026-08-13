'use client';

import type { ListHeterogeneousAgentModelsParams } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { useAgentValue } from '@/store/agent/projection';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import { ModelCatalogSelector } from './ModelCatalogSelector';
import SelectorMenu from './SelectorMenu';
import { resolveSelectorShape } from './selectorView';
import { useHeteroProviderPatch } from './useHeteroProviderPatch';

const HeteroModel = memo(() => {
  const agentId = useAgentId();
  const provider = useAgentValue(
    agentId,
    (agent) => agent?.agencyConfig?.heterogeneousProvider,
    isEqual,
  );
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  // Model/effort picks write the shared heterogeneous-provider config. Hide
  // the selector when this caller cannot configure that shared resource.
  const { canConfigureResource } = useChatInputResourceAccess();
  const enabled = canCreateContent && canConfigureResource;
  const patch = useHeteroProviderPatch({ agentId, enabled, provider });

  const shape = resolveSelectorShape(provider, enabled);

  if (shape.kind === 'none' || !provider) return null;

  if (shape.kind === 'catalog')
    return (
      <ModelCatalogSelector
        agentId={agentId}
        disabled={false}
        model={shape.capability.model.resolve(provider)}
        permissionReason={reason}
        type={provider.type as ListHeterogeneousAgentModelsParams['type']}
        onSelect={(value) => void patch({ model: value })}
      />
    );

  return (
    <SelectorMenu
      agentId={agentId}
      capability={shape.capability}
      patch={patch}
      permissionReason={reason}
      provider={provider}
    />
  );
});

HeteroModel.displayName = 'HeteroModel';

export default HeteroModel;
