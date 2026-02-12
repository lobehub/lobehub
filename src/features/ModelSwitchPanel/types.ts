import { type DropdownMenuPlacement } from '@lobehub/ui';
import { type AiModelForSelect } from 'model-bank';
import { type ReactNode } from 'react';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

export type GroupMode = 'byModel' | 'byProvider';

export interface ModelWithProviders {
  displayName: string;
  model: AiModelForSelect;
  providers: Array<{
    id: string;
    logo?: string;
    name: string;
    source?: EnabledProviderWithModels['source'];
  }>;
}

export type ListItem =
  | {
      data: ModelWithProviders;
      type: 'model-item-single';
    }
  | {
      data: ModelWithProviders;
      type: 'model-item-multiple';
    }
  | {
      provider: EnabledProviderWithModels;
      type: 'group-header';
    }
  | {
      model: AiModelForSelect;
      provider: EnabledProviderWithModels;
      type: 'provider-model-item';
    }
  | {
      provider: EnabledProviderWithModels;
      type: 'empty-model';
    }
  | {
      type: 'no-provider';
    };

export type DropdownPlacement = DropdownMenuPlacement;

export interface ModelSwitchPanelProps {
  children?: ReactNode;
  /**
   * Current model ID. If not provided, uses currentAgentModel from store.
   */
  model?: string;
  /**
   * Callback when model changes. If not provided, uses updateAgentConfig from store.
   */
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  /**
   * Dropdown placement. Defaults to 'topLeft'.
   */
  placement?: DropdownPlacement;
  /**
   * Current provider ID. If not provided, uses currentAgentModelProvider from store.
   */
  provider?: string;
}
