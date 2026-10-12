import * as cheerio from 'cheerio';
import { assertPublicHttpUrl } from './urlSafety.js';

export interface LinkMetadata {
  title: string | null;
  imageUrl: string | null;
  price: string | null;
}

const MAX_REDIRECTS = 3;
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 5000;

const empty = (): LinkMetadata => ({ title: null, imageUrl: null, price: null });

export function parseLinkMetadata(html: string, baseUrl: string): LinkMetadata {
  const $ = cheerio.load(html);

  const meta = (...names: string[]): string | null => {
    for (const name of names) {
      const value = $(`meta[property="${name}"], meta[name="${name}"]`)
        .first()
        .attr('content')
        ?.trim();
      if (value) return value;
    }
    return null;
  };

  const title = meta('og:title', 'twitter:title') || $('title').first().text().trim() || null;

  let imageUrl: string | null = null;
  const rawImage = meta('og:image', 'twitter:image');
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, baseUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        imageUrl = resolved.toString();
      }
    } catch {
      // Ignore unparsable image URLs
    }
  }

  const amount = meta('product:price:amount', 'og:price:amount');
  const currency = meta('product:price:currency', 'og:price:currency');
  const price =
    amount && /^\d[\d,]*\.?\d*$/.test(amount) && (!currency || currency.toUpperCase() === 'USD')
      ? amount
      : null;

  return { title: title ? title.slice(0, 300) : null, imageUrl, price };
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Best-effort metadata for any public http(s) page. Never throws. */
export async function fetchLinkMetadata(rawUrl: string): Promise<LinkMetadata> {
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await assertPublicHttpUrl(current);
      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SecretSantaBot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return empty();
        current = new URL(location, url).toString();
        continue;
      }

      if (!res.ok) return empty();
      if (!/text\/html|application\/xhtml\+xml/i.test(res.headers.get('content-type') ?? '')) {
        return empty();
      }
      return parseLinkMetadata(await readCapped(res, MAX_BYTES), url.toString());
    }
    return empty();
  } catch (error) {
    console.error('Link metadata fetch failed:', error instanceof Error ? error.message : error);
    return empty();
  }
}
