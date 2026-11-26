/** A model the business layer lists in its own section above the provider list. */
export interface BusinessFeaturedModel {
  /** One line under the model name saying what it is for. */
  description?: string;
  modelId: string;
  providerId: string;
}

export interface BusinessModelListGuard {
  /**
   * Models listed first, in their own section, instead of in their provider's
   * list. A model that is not enabled is skipped.
   */
  featuredModels?: BusinessFeaturedModel[];
  /**
   * Leave a model out of the list entirely, e.g. one a workspace admin has not
   * opened to this member. Unlike `isModelRestricted`, nothing here can unlock it.
   */
  isModelHidden?: (modelId: string, providerId: string) => boolean;
  isModelRestricted?: (modelId: string, providerId: string) => boolean;
  onBeforeModelSelect?: (modelId: string, providerId: string) => boolean | Promise<boolean>;
  /** Called with the restricted model the user clicked, so each model can open its own upsell. */
  onRestrictedModelClick?: (modelId: string, providerId: string) => void;
  /**
   * Badge shown on a restricted model. Returning `undefined` keeps the common `pro`
   * label; a business override names a different tier per model.
   */
  restrictedBadgeLabel?: (modelId: string, providerId: string) => string | undefined;
  sortModelLast?: (modelId: string, providerId: string) => boolean;
}

export const useBusinessModelListGuard = (): BusinessModelListGuard => {
  return {};
};
