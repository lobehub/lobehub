// The bundled line-art illustration is a fixed input to artwork generation.
export const lineArtReferenceUrl = (appOrigin: string) =>
  // alint-expect
  new URL('/app-images/agent-artwork-styles/line-art-reference.webp', appOrigin).toString();
