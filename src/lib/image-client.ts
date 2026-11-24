"use client";

// Browser-side photo preparation for the ad. The photo is shrunk to at most 1,600 px on its longest side and re-encoded as a JPEG,
// which keeps the upload small (well under a serverless function's request limit) and drops EXIF data such as GPS location.
// `createImageBitmap` rejects for formats the browser cannot decode (for example HEIC in Chrome); the caller shows a plain message.
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export async function downsizeToJpeg(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new Error("too_large");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("unsupported_type");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#ffffff"; // a PNG with transparency would turn black in a JPEG otherwise
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality),
  );
}
