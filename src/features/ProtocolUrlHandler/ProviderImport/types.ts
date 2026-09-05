import type { AiProviderSourceType } from '@/types/aiProvider';

export interface ExistingProviderPreview {
  id: string;
  identity: string;
  name: string;
  source: AiProviderSourceType;
}
