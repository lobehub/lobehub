import { describe, expect, it } from 'vitest';

import { inspectIsoBmffContainer, isAudioOnlyIsoBmff } from './isoBmff';

const ascii = (value: string) => Uint8Array.from(value, (char) => char.codePointAt(0)!);

const box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
  const body = payload.flatMap((part) => [...part]);
  const size = 8 + body.length;

  return Uint8Array.from([
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...ascii(type),
    ...body,
  ]);
};

const ftyp = (brand: string) => box('ftyp', ascii(brand), new Uint8Array(4));

/** FullBox header, `pre_defined`, then the handler type. */
const hdlr = (handler: string) => box('hdlr', new Uint8Array(8), ascii(handler));

const track = (handler: string) => box('trak', box('mdia', hdlr(handler)));

const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

describe('inspectIsoBmffContainer', () => {
  it('reads the brand and the track handlers', () => {
    const bytes = concat(ftyp('M4A '), box('moov', track('soun')));

    expect(inspectIsoBmffContainer(bytes)).toEqual({
      brand: 'M4A ',
      hasAudioTrack: true,
      hasVideoTrack: false,
    });
  });

  it('returns undefined for anything that does not open with ftyp', () => {
    expect(inspectIsoBmffContainer(ascii('not a container at all'))).toBeUndefined();
    expect(inspectIsoBmffContainer(new Uint8Array(4))).toBeUndefined();
  });

  it('skips over the media data instead of descending into it', () => {
    // `mdat` carries megabytes of samples in a real file; the walk must jump it
    // by size rather than scanning it for boxes that are not there.
    const mdat = box('mdat', ascii('hdlr'), ascii('vide'));
    const bytes = concat(ftyp('M4A '), mdat, box('moov', track('soun')));

    expect(inspectIsoBmffContainer(bytes)?.hasVideoTrack).toBe(false);
  });
});

describe('isAudioOnlyIsoBmff', () => {
  // The failing production file: a WhatsApp voice note named `.mp4`, which every
  // extension- and signature-based check reports as video/mp4.
  it('classifies an M4A-branded container with a single soun track as audio', () => {
    const bytes = concat(ftyp('M4A '), box('moov', track('soun')));

    expect(isAudioOnlyIsoBmff(bytes)).toBe(true);
  });

  it('leaves a container with a video track alone', () => {
    const bytes = concat(ftyp('isom'), box('moov', track('vide'), track('soun')));

    expect(isAudioOnlyIsoBmff(bytes)).toBe(false);
  });

  it('trusts a video track over an audio-only brand', () => {
    const bytes = concat(ftyp('M4A '), box('moov', track('vide')));

    expect(isAudioOnlyIsoBmff(bytes)).toBe(false);
  });

  it('falls back to the brand when the track table is out of reach', () => {
    // `moov` can sit after the media data, so a head slice holds only `ftyp`.
    expect(isAudioOnlyIsoBmff(ftyp('M4A '))).toBe(true);
    expect(isAudioOnlyIsoBmff(ftyp('isom'))).toBe(false);
  });

  it('answers false for input it cannot read', () => {
    expect(isAudioOnlyIsoBmff(new Uint8Array(0))).toBe(false);
    expect(isAudioOnlyIsoBmff(ascii('plain text file contents'))).toBe(false);
  });
});
