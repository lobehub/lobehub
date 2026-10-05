interface PendingSource {
  readonly pendingCount: number;
}

const providers = new Map<string, PendingSource>();

export const registerPageCollab = (documentId: string, provider: PendingSource) => {
  providers.set(documentId, provider);
  return () => {
    if (providers.get(documentId) === provider) providers.delete(documentId);
  };
};

export const waitForPageSynced = async (documentId: string, timeoutMs: number) => {
  const provider = providers.get(documentId);
  if (!provider) return true;

  const deadline = Date.now() + timeoutMs;
  while (provider.pendingCount > 0) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
};
