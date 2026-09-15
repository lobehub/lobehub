// Resolved in the SSR environment for every `*.client` module (see
// `share-client-only-stub`). The conversation and page-viewer stacks behind
// those imports are the app's whole weight; the worker never renders them, so
// they must not be bundled into it either.
const ClientOnlyModule = () => null;

export default ClientOnlyModule;
