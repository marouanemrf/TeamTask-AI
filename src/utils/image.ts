const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

/** Value for the file input's `accept` attribute. */
export const AVATAR_ACCEPT = ACCEPTED_TYPES.join(",");

/** Returns a user-facing error, or undefined when the file can be used as a profile picture. */
export function validateImageFile(file: File): string | undefined {
  if (!ACCEPTED_TYPES.includes(file.type)) return "Choose a JPG, PNG, WebP or GIF image.";
  if (file.size > MAX_INPUT_BYTES) return "The image must be 5 MB or smaller.";
  return undefined;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be read"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Center-crops to a square and resizes (default 256×256). Re-encoding through a canvas also
 * strips EXIF metadata such as GPS location. Prefers WebP, falls back to JPEG.
 */
export async function toSquareAvatar(file: Blob, size = 256): Promise<Blob> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);

  const webp = await canvasToBlob(canvas, "image/webp", 0.85);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.85);
  if (!jpeg) throw new Error("Image could not be encoded");
  return jpeg;
}
