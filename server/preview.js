import * as cheerio from "cheerio";

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_500_000;

/**
 * Descarga la página y extrae og:image / og:title (o equivalentes).
 * Muchas tiendas (Shein, Zara, etc.) no tienen API pública; esto es lo más estable.
 */
export async function fetchProductPreview(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch {
    throw new Error("URL no válida");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Solo se permiten enlaces http(s)");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(urlString, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`La tienda respondió ${res.status}`);

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error("Página demasiado grande");

  const html = new TextDecoder("utf-8").decode(buf);
  const $ = cheerio.load(html);

  let imageUrl =
    $('meta[property="og:image"]').attr("content")?.trim() ||
    $('meta[name="twitter:image"]').attr("content")?.trim() ||
    $('meta[name="twitter:image:src"]').attr("content")?.trim() ||
    "";

  let title =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $('meta[name="twitter:title"]').attr("content")?.trim() ||
    $("title").first().text()?.trim() ||
    "";

  if (imageUrl && !/^https?:/i.test(imageUrl)) {
    try {
      imageUrl = new URL(imageUrl, parsed.origin).href;
    } catch {
      imageUrl = "";
    }
  }

  return {
    title: title.slice(0, 220),
    imageUrl: imageUrl || null,
    productUrl: parsed.href,
  };
}
