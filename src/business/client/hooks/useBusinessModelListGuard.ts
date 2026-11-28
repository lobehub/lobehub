/** A model the business layer lists in its own section above the provider list. */
export interface BusinessFeaturedModel {
  /** Short tag after the model name saying what sets it apart. */
  badge?: string;
  /** @deprecated Ignored by the model list; kept so hosts that still pass it type-check. */
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
   * Why the viewer cannot pick a model they can see, e.g. one above the tier a
   * workspace admin allows them. The model switch panel keeps such a model listed,
   * dimmed and inert, and shows the reason on hover; the composer's model trigger
   * shows it too while that model is selected. Unlike `isModelRestricted` there is
   * no upsell, since the viewer cannot lift it, and a restricted model keeps its
   * upsell instead. A model with a reason stays listed in the panel even when
   * `isModelHidden` leaves it out of the other pickers.
   */
  getModelDisabledReason?: (modelId: string, providerId: string) => string | undefined;
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
