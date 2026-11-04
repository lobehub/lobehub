interface GatewayDeviceInfo {
  deviceId?: string;
}

// Desktop-only state the shared stores read while resolving a working
// directory; SSR has no gateway device, so every reader takes its web branch.
const emptyState = {
  gatewayDeviceInfo: undefined as GatewayDeviceInfo | undefined,
  // No desktop identity in SSR, so no topic pin is ever written from here.
  resolveGatewayDeviceId: async (): Promise<string | undefined> => undefined,
};

// Renderable stand-in, not a throwing proxy: shared components may call the
// hook during SSR and must see "desktop features off", not a crash.
export const useElectronStore = <T = unknown>(selector?: (state: typeof emptyState) => T): T =>
  selector ? selector(emptyState) : (emptyState as T);

useElectronStore.getState = () => emptyState;

export const getElectronStoreState = () => emptyState;
