#!/usr/bin/env bash
# Shared macOS brightness probe. Source this file; call image_brightness <PNG>.
# Prints the brightest RGB channel on a 16x16 grid. Exit 2 = unmeasured.
image_brightness() (
  for tool in sips python3; do
    command -v "$tool" >/dev/null 2>&1 || { echo "Missing $tool for image brightness check." >&2; exit 2; }
  done
  probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/acceptance-image.XXXXXX")" || exit 2
  trap 'rm -rf "$probe_dir"' EXIT
  sips -z 16 16 "$1" --out "$probe_dir/small.png" >/dev/null 2>&1 || exit 2
  sips -s format bmp "$probe_dir/small.png" --out "$probe_dir/small.bmp" >/dev/null 2>&1 || exit 2
  python3 - "$probe_dir/small.bmp" <<'PY'
import sys

try:
    data = open(sys.argv[1], 'rb').read()
    if len(data) < 54 or data[:2] != b'BM':
        raise ValueError('invalid BMP')
    offset = int.from_bytes(data[10:14], 'little')
    width = int.from_bytes(data[18:22], 'little', signed=True)
    height = abs(int.from_bytes(data[22:26], 'little', signed=True))
    bpp = int.from_bytes(data[28:30], 'little')
    compression = int.from_bytes(data[30:34], 'little')
    stride = ((width * bpp + 31) // 32) * 4
    if width != 16 or height != 16 or bpp not in (24, 32) or compression not in (0, 3):
        raise ValueError('unsupported BMP layout')
    # sips emits BITMAPV5HEADER + BI_BITFIELDS for RGBA screenshots. Accept
    # its BGR channel masks, excluding alpha from the brightness measurement.
    if compression == 3 and (bpp != 32 or offset < 66 or
                             data[54:66] != bytes.fromhex('0000ff0000ff0000ff000000')):
        raise ValueError('unsupported BMP channel masks')
    if offset < 54 or len(data) < offset + height * stride:
        raise ValueError('truncated BMP')
    maximum = max(
        data[offset + y * stride + x * (bpp // 8) + channel]
        for y in range(height) for x in range(width) for channel in range(3)
    )
    print(maximum)
except (OSError, ValueError) as error:
    print(f'Image brightness check unavailable: {error}', file=sys.stderr)
    sys.exit(2)
PY
)
