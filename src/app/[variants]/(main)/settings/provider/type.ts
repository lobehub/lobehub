import type {ProviderConfigProps} from './features/ProviderConfig';

export interface ProviderItem extends Omit<ProviderConfigProps, 'id' | 'source'> {
  id: string;
}
