interface FooterPromotionContext {
  isProductHuntNotificationRead: boolean;
  isWithinProductHuntWindow: boolean;
  serverConfigInit: boolean;
}

interface FooterPromotionState {
  shouldAutoShowProductHuntCard: boolean;
  shouldShowProductHuntMenuEntry: boolean;
}

type FooterPromotionPipelineStep = (
  context: FooterPromotionContext,
  state: FooterPromotionState,
) => FooterPromotionState;

const initialFooterPromotionState: FooterPromotionState = {
  shouldAutoShowProductHuntCard: false,
  shouldShowProductHuntMenuEntry: false,
};

const resolveProductHuntPromotion: FooterPromotionPipelineStep = (context, state) => {
  if (!context.isWithinProductHuntWindow) return state;

  return {
    ...state,
    shouldAutoShowProductHuntCard:
      context.serverConfigInit && !context.isProductHuntNotificationRead,
    shouldShowProductHuntMenuEntry: true,
  };
};

const footerPromotionPipeline = [
  resolveProductHuntPromotion,
] as const satisfies readonly FooterPromotionPipelineStep[];

export const resolveFooterPromotionState = (
  context: FooterPromotionContext,
): FooterPromotionState =>
  footerPromotionPipeline.reduce(
    (state, step) => step(context, state),
    initialFooterPromotionState,
  );

export type { FooterPromotionContext, FooterPromotionState };
