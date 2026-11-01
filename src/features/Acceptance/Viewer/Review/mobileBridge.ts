interface AcceptanceWebViewBridge {
  injectedObjectJson?: () => string;
  postMessage: (message: string) => void;
}

/** Older native clients and ordinary browsers keep the normal clipboard flow. */
export const draftRepairPromptInMobile = (acceptanceId: string, text: string): boolean => {
  if (typeof window === 'undefined' || window.top !== window) return false;

  const bridge = (window as Window & { ReactNativeWebView?: AcceptanceWebViewBridge })
    .ReactNativeWebView;
  try {
    if (!bridge?.injectedObjectJson || typeof bridge.postMessage !== 'function') return false;
    const capabilities = JSON.parse(bridge.injectedObjectJson());
    if (capabilities?.acceptanceDraftVersion !== 1) return false;

    bridge.postMessage(
      JSON.stringify({ acceptanceId, text, type: 'acceptance.draftRepairPrompt', version: 1 }),
    );
    return true;
  } catch {
    return false;
  }
};
