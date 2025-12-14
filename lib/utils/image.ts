export type ImageInfo = {
  width: number;
  height: number;
  format: "jpeg" | "png";
};

export function sniffImageInfo(bytes: Uint8Array): ImageInfo | null {
  const png = sniffPng(bytes);
  if (png) return png;
  const jpeg = sniffJpeg(bytes);
  if (jpeg) return jpeg;
  return null;
}

function sniffPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;
  // PNG signature
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return null;
  }
  // IHDR chunk: length(4) + type(4) + data(13) + crc(4)
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== "IHDR") return null;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height, format: "png" };
}

function sniffJpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // SOI

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }

    // Skip fill bytes 0xFF
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;

    const marker = bytes[offset++];
    // Markers without length
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS

    if (offset + 2 > bytes.length) break;
    const segmentLen = readU16BE(bytes, offset);
    offset += 2;
    if (segmentLen < 2 || offset + (segmentLen - 2) > bytes.length) break;

    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSOF) {
      // SOF segment: precision(1), height(2), width(2), components...
      if (segmentLen < 7) return null;
      const height = readU16BE(bytes, offset + 1);
      const width = readU16BE(bytes, offset + 3);
      if (width <= 0 || height <= 0) return null;
      return { width, height, format: "jpeg" };
    }

    offset += segmentLen - 2;
  }

  return null;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] * 2 ** 24) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) +
    bytes[offset + 3];
}

