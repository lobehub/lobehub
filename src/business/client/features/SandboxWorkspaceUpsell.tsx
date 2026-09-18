/**
 * Opens whatever explains, to a user whose plan has no persistent sandbox, how
 * to get one. Called from the "keep files" row of the execution-device menu,
 * which renders inert with a tag for such a plan; the tag calls this.
 *
 * A no-op in the open-source build: persistence there is a deployment decision,
 * not a purchase, so there is nothing to sell. Downstream builds override this
 * module through their own `@/business/...` mapping.
 */
export const openSandboxWorkspaceUpsell = (): void => {};
