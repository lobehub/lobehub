interface FooterPromotionContext {
  agentOnboardingFinished: boolean;
  agentOnboardingStarted: boolean;
  classicOnboardingFinished: boolean;
  enableAgentOnboarding: boolean;
  isAgentOnboardingPromoRead: boolean;
  isDesktop: boolean;
  isMobile: boolean;
  isProductHuntNotificationRead: boolean;
  isWithinProductHuntWindow: boolean;
  serverConfigInit: boolean;
}

interface FooterPromotionState {
  isAgentOnboardingPromoAvailable: boolean;
  shouldAutoShowAgentOnboardingPromo: boolean;
  shouldAutoShowProductHuntCard: boolean;
  shouldShowProductHuntMenuEntry: boolean;
}

type FooterPromotionPipelineStep = (
  context: FooterPromotionContext,
  state: FooterPromotionState,
) => FooterPromotionState;

const initialFooterPromotionState: FooterPromotionState = {
  isAgentOnboardingPromoAvailable: false,
  shouldAutoShowAgentOnboardingPromo: false,
  shouldAutoShowProductHuntCard: false,
  shouldShowProductHuntMenuEntry: false,
};

const resolveAgentOnboardingPromotion: FooterPromotionPipelineStep = (context, state) => {
  const isAgentOnboardingPromoAvailable =
    !context.isDesktop &&
    !context.isMobile &&
    context.serverConfigInit &&
    context.enableAgentOnboarding &&
    context.classicOnboardingFinished &&
    !context.agentOnboardingStarted &&
    !context.agentOnboardingFinished;

  if (!isAgentOnboardingPromoAvailable) return state;

  return {
    ...state,
    isAgentOnboardingPromoAvailable,
    shouldAutoShowAgentOnboardingPromo: !context.isAgentOnboardingPromoRead,
  };
};

const resolveProductHuntPromotion: FooterPromotionPipelineStep = (context, state) => {
  if (state.isAgentOnboardingPromoAvailable || !context.isWithinProductHuntWindow) return state;

  return {
    ...state,
    shouldAutoShowProductHuntCard:
      context.serverConfigInit && !context.isProductHuntNotificationRead,
    shouldShowProductHuntMenuEntry: true,
  };
};

const footerPromotionPipeline = [
  resolveAgentOnboardingPromotion,
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
