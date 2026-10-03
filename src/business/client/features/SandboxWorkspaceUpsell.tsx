/**
 * Rendered in the composer control bar where the sandbox working-directory
 * picker would be, for a user who opted into the persistent-sandbox experiment
 * but whose plan does not include one.
 *
 * Empty in the open-source build: persistence there is a deployment decision,
 * not a purchase, so there is nothing to upsell. Downstream builds override this
 * module through their own `@/business/...` mapping.
 */
const SandboxWorkspaceUpsell = () => null;

export default SandboxWorkspaceUpsell;
