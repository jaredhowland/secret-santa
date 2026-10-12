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

const MAX_IMAGE_URL = 2048;
const MAX_PRICE_LEN = 20;
const PRICE_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
const KNOWN_GUARD_ERRORS = ['Unsupported protocol', 'Address not allowed'];

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
        const str = resolved.toString();
        imageUrl = str.length <= MAX_IMAGE_URL ? str : null;
      }
    } catch {
      // Ignore unparsable image URLs
    }
  }

  const amount = meta('product:price:amount', 'og:price:amount');
  const currency = meta('product:price:currency', 'og:price:currency');
  const price =
    amount &&
    amount.length <= MAX_PRICE_LEN &&
    PRICE_RE.test(amount) &&
    (!currency || currency.toUpperCase() === 'USD')
      ? amount
      : null;

  return { title: title ? title.slice(0, 300) : null, imageUrl, price };
}

function decoderFor(contentType: string): TextDecoder {
  const label = /charset\s*=\s*"?([^\s;"]+)/i.exec(contentType)?.[1];
  if (label) {
    try {
      return new TextDecoder(label);
    } catch {
      // Unsupported label: fall back to UTF-8
    }
  }
  return new TextDecoder();
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
  const bytes = Buffer.concat(chunks).subarray(0, maxBytes);
  return decoderFor(res.headers.get('content-type') ?? '').decode(bytes);
}

const cancelBody = (res: Response) => res.body?.cancel().catch(() => {});

/** Best-effort metadata for any public http(s) page. Never throws. */
export async function fetchLinkMetadata(
  rawUrl: string,
  guard: (url: string) => Promise<URL> = assertPublicHttpUrl,
): Promise<LinkMetadata> {
  try {
    let current = rawUrl;
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await guard(current);
      const res = await fetch(url, {
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SecretSantaBot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await cancelBody(res);
        if (!location) return empty();
        current = new URL(location, url).toString();
        continue;
      }

      if (!res.ok) {
        await cancelBody(res);
        return empty();
      }
      if (!/text\/html|application\/xhtml\+xml/i.test(res.headers.get('content-type') ?? '')) {
        await cancelBody(res);
        return empty();
      }
      return parseLinkMetadata(await readCapped(res, MAX_BYTES), url.toString());
    }
    return empty();
  } catch (error) {
    const known =
      (error as { code?: string } | null)?.code === 'ERR_INVALID_URL' ||
      (error instanceof Error && KNOWN_GUARD_ERRORS.includes(error.message));
    if (!known) {
      console.error('Link metadata fetch failed:', error instanceof Error ? error.message : error);
    }
    return empty();
  }
}
