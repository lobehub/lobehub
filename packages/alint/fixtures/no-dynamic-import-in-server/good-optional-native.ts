// Fixture: a justified dynamic import of an optional native dependency.
export const loadNativeWatcher = async () => {
  try {
    // `@parcel/watcher` is an optional native addon; it is absent on the
    // slim Docker image, so resolve it lazily and fall back to polling.
    const watcher = await import('@parcel/watcher');
    return watcher.subscribe;
  } catch {
    return null;
  }
};
