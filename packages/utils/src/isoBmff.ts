/**
 * ISO base media file format (MP4 / M4A / MOV) container inspection.
 *
 * `.mp4` names a container, not a media kind. A WhatsApp voice note ships as
 * `.mp4` carrying a single `soun` track and an `M4A ` brand, and both the
 * browser (which maps the extension) and byte sniffing (which sees the shared
 * ISO-BMFF signature) report it as `video/mp4`. Nothing downstream can tell it
 * apart from a real video without reading the box tree.
 *
 * The distinction matters because the two kinds take different routes to the
 * model: video is inlined as a `video_url` part the provider fetches itself and
 * measures against its own ceiling, while audio goes to the media-analysis
 * tool, which has no such ceiling. Misfiling a two-hour recording as video
 * therefore turns it from "transcribed in an hour" into "rejected in 1.4s".
 */

const BOX_HEADER_SIZE = 8;

/** Brands that declare the file audio-only in its very first box. */
const AUDIO_ONLY_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);

/** Boxes worth descending into on the way to the track handlers. */
const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia']);

/**
 * A malformed tree must not turn into a long walk. Real files stay far below
 * this: the box count is dominated by tracks, not by sample data.
 */
const MAX_BOXES_VISITED = 4096;

export interface IsoBmffContainerInfo {
  /** `major_brand` from the `ftyp` box. */
  brand: string;
  /** A `soun` track handler was found. */
  hasAudioTrack: boolean;
  /** A `vide` track handler was found. */
  hasVideoTrack: boolean;
}

interface WalkState {
  handlers: Set<string>;
  visited: number;
}

const getBytes = (input: ArrayBuffer | Uint8Array): Uint8Array =>
  input instanceof Uint8Array ? input : new Uint8Array(input);

const readBoxType = (bytes: Uint8Array, offset: number): string =>
  String.fromCodePoint(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

/**
 * Walk the sibling boxes in `[start, end)`, descending into the containers that
 * lead to a track handler. Anything unreadable ends the walk rather than
 * guessing: a partial answer here is reported as "not provably audio", which is
 * the safe direction.
 */
const walkBoxes = (
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
  state: WalkState,
): void => {
  let offset = start;

  while (offset + BOX_HEADER_SIZE <= end) {
    if (++state.visited > MAX_BOXES_VISITED) return;

    let size = view.getUint32(offset);
    const type = readBoxType(bytes, offset + 4);
    let payload = offset + BOX_HEADER_SIZE;

    if (size === 1) {
      // 64-bit `largesize` follows the header.
      if (payload + 8 > end) return;
      // A box larger than 4 GiB is only ever `mdat`, and nothing we look for
      // lives inside it — but we can no longer compute where it ends.
      if (view.getUint32(payload) > 0) return;
      size = view.getUint32(payload + 4);
      payload += 8;
    } else if (size === 0) {
      // Extends to the end of the file.
      size = end - offset;
    }

    if (size < BOX_HEADER_SIZE) return;

    // Clamp: when the caller handed us only the head of a file, the box that
    // runs past it is truncated rather than malformed.
    const boxEnd = Math.min(offset + size, end);
    if (payload > boxEnd) return;

    if (type === 'hdlr') {
      // FullBox: 4 bytes version/flags, 4 bytes pre_defined, then handler_type.
      const handlerAt = payload + 8;
      if (handlerAt + 4 <= boxEnd) state.handlers.add(readBoxType(bytes, handlerAt));
    } else if (CONTAINER_BOXES.has(type)) {
      walkBoxes(view, bytes, payload, boxEnd, state);
    }

    offset = boxEnd;
  }
};

/**
 * Parse the box tree of an ISO-BMFF container. Returns `undefined` for anything
 * that does not open with an `ftyp` box, which covers every non-ISO-BMFF input
 * as well as the raw-`mdat` QuickTime variants we deliberately do not classify.
 *
 * Accepts a partial buffer: `ftyp` is always first, so the brand is readable
 * from the head of a file even when `moov` sits after the media data and the
 * track handlers are therefore out of reach.
 */
export const inspectIsoBmffContainer = (
  input: ArrayBuffer | Uint8Array,
): IsoBmffContainerInfo | undefined => {
  const bytes = getBytes(input);
  if (bytes.byteLength < 12) return undefined;
  if (readBoxType(bytes, 4) !== 'ftyp') return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const state: WalkState = { handlers: new Set(), visited: 0 };

  walkBoxes(view, bytes, 0, bytes.byteLength, state);

  return {
    brand: readBoxType(bytes, 8),
    hasAudioTrack: state.handlers.has('soun'),
    hasVideoTrack: state.handlers.has('vide'),
  };
};

/**
 * Whether an ISO-BMFF container provably carries no video.
 *
 * Track handlers win when they are readable. When they are not — `moov` after
 * `mdat`, or only the head of the file on hand — the declared brand is the
 * fallback, since `M4A `/`M4B `/`M4P ` name the file as audio outright.
 *
 * Answers `false` whenever the input is unreadable or ambiguous, so a caller
 * can only ever be moved from video to audio by positive evidence.
 */
export const isAudioOnlyIsoBmff = (input: ArrayBuffer | Uint8Array): boolean => {
  const info = inspectIsoBmffContainer(input);
  if (!info) return false;

  if (info.hasVideoTrack) return false;
  if (info.hasAudioTrack) return true;

  return AUDIO_ONLY_BRANDS.has(info.brand);
};
