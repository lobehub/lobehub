/** Wrap little-endian mono PCM16 frames in a WAV container. */
export const encodeWav = (frames: ArrayBuffer[], sampleRate: number): Blob => {
  const dataBytes = frames.reduce((total, frame) => total + frame.byteLength, 0);
  const header = new DataView(new ArrayBuffer(44));
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      header.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeText(0, 'RIFF');
  header.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  header.setUint32(16, 16, true);
  // PCM, mono, 16-bit
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  writeText(36, 'data');
  header.setUint32(40, dataBytes, true);

  return new Blob([header.buffer, ...frames], { type: 'audio/wav' });
};

export const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x80_00) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x80_00));
  }
  return btoa(binary);
};
