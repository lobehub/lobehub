// Everything else is bundled into dist; only packages with native bindings or bundled
// binaries stay in node_modules (unresolvable optional peers are listed so rolldown skips them).
export const honoNativeExternals = [
  '@napi-rs/canvas',
  '@react-email/render',
  'bufferutil',
  'canvas',
  'ffmpeg-static',
  'pg-native',
  'sharp',
  'utf-8-validate',
  'zipfile',
  'zlib-sync',
];
