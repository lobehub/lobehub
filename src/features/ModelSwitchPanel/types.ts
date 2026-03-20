import { type DropdownMenuPlacement } from '@lobehub/ui';
import { type AiModelForSelect } from 'model-bank';
import { type ComponentType } from 'react';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { type PricingMode } from './components/ModelDetailPanel';

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
  children?: React.ReactNode;
  /**
   * When set (e.g. image/video generation), uses this list instead of enabled chat models.
   */
  enabledList?: EnabledProviderWithModels[];
  /**
   * Current model ID. If not provided, uses currentAgentModel from store.
   */
  model?: string;
  /**
   * Optional row component for generation UIs (e.g. ImageModelItem). Requires `enabledList` + `pricingMode`.
   */
  ModelItemComponent?: ComponentType<any>;
  /**
   * Callback when model changes. If not provided, uses updateAgentConfig from store.
   */
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  /**
   * Whether to open the panel on hover. Defaults to true.
   */
  openOnHover?: boolean;
  /**
   * Dropdown placement. Defaults to 'topLeft'.
   */
  placement?: DropdownPlacement;
  /**
   * Pass-through to ModelDetailPanel for image/video approximate pricing.
   */
  pricingMode?: PricingMode;
  /**
   * Current provider ID. If not provided, uses currentAgentModelProvider from store.
   */
  provider?: string;
}
