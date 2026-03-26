import { showToast } from "./ui.js";

const MAX_UPLOAD_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;
const MAX_IMAGES_PER_POST = 10;
const PUBLIC_IMGBB_FALLBACK_KEY = "dae3de7222aca4af1a7d47c6cfd70840";

async function resizeImage(file, maxDim = MAX_UPLOAD_DIMENSION, quality = JPEG_QUALITY) {
  if (!file.type.startsWith("image/")) return file;

  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    image.src = url;
  });

  const { width, height } = img;
  const ratio = Math.min(1, maxDim / Math.max(width, height));
  const targetWidth = Math.round(width * ratio);
  const targetHeight = Math.round(height * ratio);

  if (ratio === 1 && file.size < 800 * 1024) {
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", quality);
  });

  return blob || file;
}

async function blobToBase64(blobOrFile) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blobOrFile);
  });
}

async function uploadOne(blobOrFile, filename = "upload.jpg") {
  const image = await blobToBase64(blobOrFile);
  const payloadBody = JSON.stringify({
    image,
    name: filename,
  });
  const res = await fetch("/api/imgbb-upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payloadBody,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const proxyError = payload?.error || "Image upload failed";
    const publicKey =
      (typeof window !== "undefined" && window.__PUBLIC_UPLOAD_CONFIG__?.imgbbKey) ||
      (typeof import.meta !== "undefined" && import.meta.env?.VITE_IMGBB_KEY) ||
      PUBLIC_IMGBB_FALLBACK_KEY ||
      "";

    if (publicKey && /missing imgbb environment variable/i.test(proxyError)) {
      return uploadDirectToImgBB(image, filename, publicKey);
    }

    throw new Error(proxyError);
  }

  if (!payload?.url) {
    throw new Error("Image upload completed without a returned URL");
  }

  return payload.url;
}

async function uploadDirectToImgBB(image, filename, apiKey) {
  const form = new URLSearchParams();
  form.set("image", image);
  form.set("name", filename);

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.data?.error?.message || "Direct ImgBB upload failed");
  }

  const url = payload?.data?.display_url || payload?.data?.url || null;
  if (!url) {
    throw new Error("Direct ImgBB upload returned no image URL");
  }

  return url;
}

export async function uploadImages(files, options = {}) {
  if (!files) return [];
  const arr = Array.from(files).slice(0, MAX_IMAGES_PER_POST);
  if (arr.length === 0) return [];

  const urls = [];
  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < arr.length; i++) {
    const file = arr[i];
    try {
      const resized = await resizeImage(file);
      const url = await uploadOne(resized, file.name || `upload-${i + 1}.jpg`);
      urls.push(url);
      uploaded++;
      options.onProgress?.(i, uploaded, arr.length);
    } catch (error) {
      failed++;
      console.error("Image upload failed for file", file.name, error);
      showToast(`Image failed: ${file.name} (${error?.message || "upload error"})`, "warn");
    }
  }

  if (uploaded > 0) {
    showToast(`Uploaded ${uploaded}/${arr.length} images`, "success");
  }

  if (failed > 0 && uploaded > 0) {
    showToast(`${failed} image(s) were skipped`, "warn");
  }

  if (uploaded === 0) {
    throw new Error("All selected image uploads failed");
  }

  return urls;
}

export async function uploadImage(file) {
  const urls = await uploadImages([file]);
  return urls[0] || null;
}
