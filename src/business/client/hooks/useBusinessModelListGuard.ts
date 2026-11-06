export interface BusinessModelListGuard {
  isModelRestricted?: (modelId: string, providerId: string) => boolean;
  onBeforeModelSelect?: (modelId: string, providerId: string) => boolean | Promise<boolean>;
  onRestrictedModelClick?: () => void;
  /**
   * Badge shown on restricted models. Defaults to the common `pro` label; a business
   * override sets it when the restriction is a different tier.
   */
  restrictedBadgeLabel?: string;
  sortModelLast?: (modelId: string, providerId: string) => boolean;
}

export const useBusinessModelListGuard = (): BusinessModelListGuard => {
  return {};
};
