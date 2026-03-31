async function parseJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return null;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    return null;
  }
}

function readApiKey() {
  return (
    process.env.IMGBB_KEY ||
    process.env.VITE_IMGBB_KEY ||
    ""
  ).trim();
}

function readContentLength(req) {
  const raw = req.headers["content-length"];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase();
}

function hasAllowedOrigin(req) {
  const host = requestHost(req);
  if (!host) return true;
  const configuredAppUrl = process.env.VITE_APP_URL || "";
  let configuredHost = "";
  try {
    configuredHost = configuredAppUrl ? new URL(configuredAppUrl).host.toLowerCase() : "";
  } catch {
    configuredHost = "";
  }
  const candidates = [req.headers.origin, req.headers.referer].filter(Boolean);
  if (!candidates.length) return true;
  return candidates.some((value) => {
    try {
      const candidateHost = new URL(String(value)).host.toLowerCase();
      return (
        candidateHost === host ||
        candidateHost === configuredHost ||
        host.endsWith(`.${candidateHost}`) ||
        candidateHost.endsWith(`.${host}`) ||
        (configuredHost && candidateHost.endsWith(`.${configuredHost}`)) ||
        (configuredHost && configuredHost.endsWith(`.${candidateHost}`))
      );
    } catch {
      return false;
    }
  });
}

function normalizeImgbbUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(String(rawUrl).trim());
    if (parsed.protocol !== "https:") {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch {
    return String(rawUrl || "").trim() || null;
  }
}

function extractImgbbUrl(payload) {
  return normalizeImgbbUrl(
    payload?.data?.display_url ||
      payload?.data?.medium?.url ||
      payload?.data?.url ||
      payload?.data?.image?.url ||
      payload?.data?.thumb?.url ||
      null
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!hasAllowedOrigin(req)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  if (readContentLength(req) > 12_000_000) {
    return res.status(413).json({ error: "Upload payload too large" });
  }

  const apiKey = readApiKey();
  if (!apiKey) {
    return res.status(500).json({
      error: "Missing ImgBB environment variable. Add IMGBB_KEY in Vercel or .env.",
    });
  }

  const body = await parseJsonBody(req);
  const image = typeof body?.image === "string" ? body.image.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "upload.jpg";

  if (!image) {
    return res.status(400).json({ error: "Missing image payload" });
  }

  if (!/^[A-Za-z0-9+/=_-]+$/.test(image) || image.length > 11_000_000) {
    return res.status(400).json({ error: "Invalid image payload" });
  }

  try {
    const form = new URLSearchParams();
    form.set("image", image);
    form.set("name", name);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage =
        payload?.error?.message ||
        payload?.data?.error?.message ||
        "ImgBB upload failed";
      return res.status(response.status).json({ error: errorMessage });
    }

    const url = extractImgbbUrl(payload);
    if (!url) {
      return res.status(502).json({ error: "ImgBB did not return an image URL" });
    }

    return res.status(200).json({
      url,
    });
  } catch (error) {
    console.error("[imgbb-upload] Upload failed:", error);
    return res.status(500).json({ error: error?.message || "Upload proxy failed" });
  }
}
