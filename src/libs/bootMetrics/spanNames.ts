export const projectionBootSpanNames = {
  databaseRead: 'projection-db-read',
  decode: 'projection-decode',
  hydration: 'projection-hydration',
  /** Renderer settle after the main process already answered. */
  ipcDelivery: 'projection-ipc-delivery',
  /** Renderer send until the main process picked the request up. */
  ipcInbound: 'projection-ipc-inbound',
  ipcRoundtrip: 'projection-ipc-roundtrip',
  mainWork: 'projection-main-work',
  storeInject: 'projection-store-inject',
} as const;
