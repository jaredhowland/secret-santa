const MAX_URL_LENGTH = 2048;
const MAX_DESCRIPTION_LENGTH = 500;

export type WishlistInput =
  | { ok: true; url: string | null; description: string | null }
  | { ok: false; error: string };

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim() || null;
}

export function parseWishlistInput(body: unknown): WishlistInput {
  const { url: rawUrl, description: rawDescription } = (body ?? {}) as Record<string, unknown>;

  const url = optionalString(rawUrl);
  const description = optionalString(rawDescription);
  if (url === undefined || description === undefined) {
    return { ok: false, error: 'URL and description must be text' };
  }

  if (!url && !description) {
    return { ok: false, error: 'Enter a link or a description' };
  }

  if (url) {
    if (url.length > MAX_URL_LENGTH) return { ok: false, error: 'URL is too long' };
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: 'URL must start with http:// or https://' };
      }
    } catch {
      return { ok: false, error: 'Invalid URL format' };
    }
  }

  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` };
  }

  return { ok: true, url, description };
}
