import { showToast } from "./ui.js";

const IMGBB_KEY =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env.VITE_IMGBB_KEY
    : "";
const MAX_UPLOAD_DIMENSION = 1600; // px
const JPEG_QUALITY = 0.82; // compression
const MAX_IMAGES_PER_POST = 10;

/**
 * Resize image file client-side to limit dimensions and bytes.
 * Returns a Blob suitable for FormData upload.
 */
async function resizeImage(file, maxDim = MAX_UPLOAD_DIMENSION, quality = JPEG_QUALITY) {
  if (!file.type.startsWith("image/")) return file;
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    i.src = url;
  });
  const { width, height } = img;
  const ratio = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.round(width * ratio);
  const h = Math.round(height * ratio);

  // If no resizing needed and file is already JPEG/PNG, still try to slightly compress if large
  if (ratio === 1 && file.size < 800 * 1024) {
    return file; // leave as-is
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  // export to blob (use image/jpeg for compression)
  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
  return blob || file;
}

/**
 * Upload a single Blob/File to imgbb. Returns url string.
 */
async function uploadOne(blobOrFile) {
  if (!IMGBB_KEY) {
    throw new Error("Missing VITE_IMGBB_KEY environment variable");
  }

  const form = new FormData();
  // imgbb accepts file; if we have a Blob, pass it with a filename
  if (blobOrFile instanceof Blob && !(blobOrFile instanceof File)) {
    form.append("image", blobOrFile, "upload.jpg");
  } else {
    form.append("image", blobOrFile);
  }

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Image upload failed");
  }
  const data = await res.json();
  // prefer display_url if available; fallback to data.url
  return data?.data?.display_url || data?.data?.url || null;
}

/**
 * Upload multiple image Files. Returns array of URLs in same order.
 * - files: FileList or Array<File>
 * - options: { onProgress(idx, uploadedCount, total) }
 */
export async function uploadImages(files, options = {}) {
  if (!files) return [];
  const arr = Array.from(files).slice(0, MAX_IMAGES_PER_POST);
  if (arr.length === 0) return [];

  const urls = [];
  let uploaded = 0;
  for (let i = 0; i < arr.length; i++) {
    const f = arr[i];
    try {
      const resized = await resizeImage(f);
      const url = await uploadOne(resized);
      if (url) urls.push(url);
      uploaded++;
      options.onProgress?.(i, uploaded, arr.length);
    } catch (e) {
      console.error("Image upload failed for file", f.name, e);
      showToast(`Image failed: ${f.name}`, "warn");
      // continue uploading other images instead of aborting all
    }
  }
  if (uploaded > 0) showToast(`Uploaded ${uploaded}/${arr.length} images`, "success");
  return urls;
}

/* preserve legacy single-image export for compatibility */
export async function uploadImage(file) {
  const urls = await uploadImages([file]);
  return urls[0] || null;
}
