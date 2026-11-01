import { createContext } from 'react';

export interface ProviderSettingsContextValue {
  modelEditable?: boolean;
  sdkType?: string;
  showAddNewModel?: boolean;
  showDeployName?: boolean;
  showModelFetcher?: boolean;
}

export const ProviderSettingsContext = createContext<ProviderSettingsContextValue>({});
