# Flexible Wishlist Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add wishlist items with any http(s) URL and/or a text description (at least one required), instead of Amazon-only links.

**Architecture:** `wishlist_items` is migrated (`amazon_url` -> nullable `url`, new nullable `description`, CHECK constraint) by a one-time startup migration. The server validates input in a pure helper, fetches metadata via the existing Amazon scraper or a new SSRF-guarded generic Open Graph fetcher, and returns renamed fields. The client form/card/hook are updated to the new shape.

**Tech Stack:** Bun runtime (`bun:sqlite`, `bun:test`), Express, cheerio, React 18 + Vite + TypeScript, Tailwind.

Spec: `docs/superpowers/specs/2026-10-11-flexible-wishlist-items-design.md`

**Conventions:** Server runs on Bun (see `Dockerfile`). Run server tests with `cd server && bun test`. Run client checks with `cd client && bun run build`. Server unit tests live next to their source as `*.test.ts`.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/db/schema.sql` | modify | New `wishlist_items` definition |
| `server/db/migrations.ts` | create | One-time `amazon_url` -> `url` table rebuild |
| `server/db/migrations.test.ts` | create | Migration tests |
| `server/db/database.ts` | modify | Call migration; update `WishlistItem` row type |
| `server/utils/urlSafety.ts` | create | Private-IP detection + `assertPublicHttpUrl` |
| `server/utils/urlSafety.test.ts` | create | SSRF guard tests |
| `server/utils/linkMetadata.ts` | create | Generic OG metadata parse + safe fetch |
| `server/utils/linkMetadata.test.ts` | create | Parser + fetch tests |
| `server/utils/amazon.ts` | modify | Add `isAmazonUrl` |
| `server/utils/wishlistInput.ts` | create | Validate/normalize POST body |
| `server/utils/wishlistInput.test.ts` | create | Validation tests |
| `server/routes/wishlist.ts` | modify | Use new helpers, renamed fields |
| `server/services/email.ts` | modify | Escape item label in HTML |
| `server/types/index.ts` | modify | Response/request type rename |
| `client/src/types/index.ts` | modify | `WishlistItem` fields, `NewWishlistItem` |
| `client/src/hooks/useWishlist.ts` | modify | `addItem(input)` |
| `client/src/components/wishlist/WishlistForm.tsx` | modify | URL + description fields |
| `client/src/components/wishlist/WishlistItemCard.tsx` | modify | Generic rendering |
| `client/src/pages/MyWishlistPage.tsx` | modify | New payload, copy |

---

### Task 1: Schema and migration

**Files:**
- Modify: `server/db/schema.sql:19-26`
- Create: `server/db/migrations.ts`
- Create: `server/db/migrations.test.ts`
- Modify: `server/db/database.ts`

- [ ] **Step 1: Update `server/db/schema.sql`**

Replace the `wishlist_items` block with:

```sql
CREATE TABLE IF NOT EXISTS wishlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    url TEXT,
    description TEXT,
    title TEXT,
    image_url TEXT,
    price TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (url IS NOT NULL OR description IS NOT NULL)
);
```

- [ ] **Step 2: Write the failing test `server/db/migrations.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { migrateWishlistItems } from './migrations';

const schema = readFileSync(join(import.meta.dir, 'schema.sql'), 'utf-8');

function oldDb() {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, is_admin INTEGER DEFAULT 0, has_seen_reveal INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE wishlist_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), amazon_url TEXT NOT NULL, title TEXT, image_url TEXT, price TEXT, added_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`INSERT INTO users (email, password_hash, name) VALUES ('a@b.c', 'x', 'A')`);
  db.run(`INSERT INTO wishlist_items (user_id, amazon_url, title, price) VALUES (1, 'https://www.amazon.com/dp/B08N5WRWNW', 'Thing', '9.99')`);
  return db;
}

describe('migrateWishlistItems', () => {
  test('copies existing rows into the new url column', () => {
    const db = oldDb();
    migrateWishlistItems(db, schema);
    const row = db.query('SELECT * FROM wishlist_items').get() as any;
    expect(row.url).toBe('https://www.amazon.com/dp/B08N5WRWNW');
    expect(row.title).toBe('Thing');
    expect(row.price).toBe('9.99');
    expect(row.description).toBeNull();
  });

  test('new table accepts description-only and rejects empty rows', () => {
    const db = oldDb();
    migrateWishlistItems(db, schema);
    db.run(`INSERT INTO wishlist_items (user_id, description) VALUES (1, 'a blue scarf')`);
    expect(() => db.run(`INSERT INTO wishlist_items (user_id) VALUES (1)`)).toThrow();
  });

  test('is a no-op on a fresh or already migrated database', () => {
    const db = new Database(':memory:');
    db.run(schema);
    migrateWishlistItems(db, schema);
    migrateWishlistItems(db, schema);
    expect(db.query('SELECT COUNT(*) AS n FROM wishlist_items').get()).toEqual({ n: 0 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && bun test db/migrations.test.ts`
Expected: FAIL (cannot find module `./migrations`).

- [ ] **Step 4: Create `server/db/migrations.ts`**

```ts
import type { Database } from 'bun:sqlite';

/** Rebuilds wishlist_items when it still has the legacy amazon_url column. */
export function migrateWishlistItems(db: Database, schemaSql: string): void {
  const columns = db.query('PRAGMA table_info(wishlist_items)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'amazon_url')) return;

  db.transaction(() => {
    db.run('ALTER TABLE wishlist_items RENAME TO wishlist_items_old');
    db.run(schemaSql);
    db.run(
      `INSERT INTO wishlist_items (id, user_id, url, title, image_url, price, added_at)
       SELECT id, user_id, amazon_url, title, image_url, price, added_at FROM wishlist_items_old`
    );
    db.run('DROP TABLE wishlist_items_old');
  })();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test db/migrations.test.ts`
Expected: 3 pass.

- [ ] **Step 6: Wire into `server/db/database.ts`**

Add import `import { migrateWishlistItems } from './migrations.js';` and change the schema section:

```ts
const schema = readFileSync(schemaPath, 'utf-8');

migrateWishlistItems(db, schema);
db.run(schema);
```

Update the row type:

```ts
export interface WishlistItem {
  id: number;
  user_id: number;
  url: string | null;
  description: string | null;
  title: string | null;
  image_url: string | null;
  price: string | null;
  added_at: string;
}
```

- [ ] **Step 7: Commit**

```bash
git add server/db
git commit -m "feat(db): allow wishlist items with url and/or description"
```

---

### Task 2: SSRF guard

**Files:**
- Create: `server/utils/urlSafety.ts`
- Create: `server/utils/urlSafety.test.ts`

- [ ] **Step 1: Write the failing test `server/utils/urlSafety.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { assertPublicHttpUrl, isPrivateIp } from './urlSafety';

describe('isPrivateIp', () => {
  test.each([
    '0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '198.18.0.1', '224.0.0.1',
    '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1',
  ])('%s is private', (ip) => expect(isPrivateIp(ip)).toBe(true));

  test.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])(
    '%s is public',
    (ip) => expect(isPrivateIp(ip)).toBe(false)
  );
});

describe('assertPublicHttpUrl', () => {
  test.each([
    'ftp://example.com/x',
    'file:///etc/passwd',
    'http://127.0.0.1/',
    'http://localhost/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5:8080/',
  ])('rejects %s', async (u) => {
    await expect(assertPublicHttpUrl(u)).rejects.toThrow();
  });

  test('accepts a public IP literal', async () => {
    const url = await assertPublicHttpUrl('https://8.8.8.8/path');
    expect(url.hostname).toBe('8.8.8.8');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test utils/urlSafety.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `server/utils/urlSafety.ts`**

```ts
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function isPrivateIpv4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;

  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIpv4(mappedDotted[1]);

  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  const first = parseInt(lower.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link local
    (first & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

/** Throws unless the URL is http(s) and every resolved address is public. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported protocol');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error('Address not allowed');
  }
  return url;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test utils/urlSafety.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/urlSafety.ts server/utils/urlSafety.test.ts
git commit -m "feat(server): add SSRF guard for outbound URL fetches"
```

---

### Task 3: Generic link metadata

**Files:**
- Create: `server/utils/linkMetadata.ts`
- Create: `server/utils/linkMetadata.test.ts`

- [ ] **Step 1: Write the failing test `server/utils/linkMetadata.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { fetchLinkMetadata, parseLinkMetadata } from './linkMetadata';

describe('parseLinkMetadata', () => {
  test('reads Open Graph tags and resolves relative images', () => {
    const html = `<html><head>
      <title>Fallback</title>
      <meta property="og:title" content="Cool Mug">
      <meta property="og:image" content="/img/mug.png">
      <meta property="product:price:amount" content="12.50">
      <meta property="product:price:currency" content="USD">
    </head></html>`;
    expect(parseLinkMetadata(html, 'https://shop.example/p/1')).toEqual({
      title: 'Cool Mug',
      imageUrl: 'https://shop.example/img/mug.png',
      price: '12.50',
    });
  });

  test('falls back to <title> and ignores non-USD prices and non-http images', () => {
    const html = `<head><title> Plain Page </title>
      <meta property="og:image" content="javascript:alert(1)">
      <meta property="og:price:amount" content="10">
      <meta property="og:price:currency" content="EUR"></head>`;
    expect(parseLinkMetadata(html, 'https://x.example/')).toEqual({
      title: 'Plain Page',
      imageUrl: null,
      price: null,
    });
  });

  test('returns nulls when nothing is found', () => {
    expect(parseLinkMetadata('<html></html>', 'https://x.example/')).toEqual({
      title: null,
      imageUrl: null,
      price: null,
    });
  });
});

describe('fetchLinkMetadata', () => {
  test('never contacts loopback addresses', async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch() {
        hits++;
        return new Response('<title>secret</title>', { headers: { 'content-type': 'text/html' } });
      },
    });
    try {
      const result = await fetchLinkMetadata(`http://127.0.0.1:${server.port}/`);
      expect(result).toEqual({ title: null, imageUrl: null, price: null });
      expect(hits).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test('returns empty metadata for an invalid URL', async () => {
    expect(await fetchLinkMetadata('not a url')).toEqual({ title: null, imageUrl: null, price: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test utils/linkMetadata.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `server/utils/linkMetadata.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test utils/linkMetadata.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/linkMetadata.ts server/utils/linkMetadata.test.ts
git commit -m "feat(server): add SSRF-guarded generic link metadata fetcher"
```

---

### Task 4: Input validation and Amazon detection

**Files:**
- Modify: `server/utils/amazon.ts` (append `isAmazonUrl`)
- Create: `server/utils/wishlistInput.ts`
- Create: `server/utils/wishlistInput.test.ts`

- [ ] **Step 1: Write the failing test `server/utils/wishlistInput.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { parseWishlistInput } from './wishlistInput';
import { isAmazonUrl } from './amazon';

describe('parseWishlistInput', () => {
  test('accepts url only', () => {
    expect(parseWishlistInput({ url: ' https://shop.example/a ' })).toEqual({
      ok: true, url: 'https://shop.example/a', description: null,
    });
  });

  test('accepts description only', () => {
    expect(parseWishlistInput({ description: ' a blue scarf ' })).toEqual({
      ok: true, url: null, description: 'a blue scarf',
    });
  });

  test('accepts both and treats blank strings as missing', () => {
    expect(parseWishlistInput({ url: 'http://a.example', description: 'x' })).toEqual({
      ok: true, url: 'http://a.example', description: 'x',
    });
    expect(parseWishlistInput({ url: '  ', description: 'x' })).toEqual({
      ok: true, url: null, description: 'x',
    });
  });

  test.each([
    [{}], [{ url: '', description: '  ' }], [null], [undefined], ['str'],
  ])('rejects when neither is present: %j', (body) => {
    expect(parseWishlistInput(body).ok).toBe(false);
  });

  test.each([
    [{ url: 'not a url' }],
    [{ url: 'ftp://files.example/x' }],
    [{ url: 'javascript:alert(1)' }],
    [{ url: 123 }],
    [{ description: 123 }],
    [{ url: 'https://a.example/' + 'x'.repeat(2100) }],
    [{ description: 'x'.repeat(501) }],
  ])('rejects invalid input: %j', (body) => {
    expect(parseWishlistInput(body).ok).toBe(false);
  });
});

describe('isAmazonUrl', () => {
  test('matches amazon hosts only', () => {
    expect(isAmazonUrl('https://www.amazon.com/dp/B08N5WRWNW')).toBe(true);
    expect(isAmazonUrl('https://smile.amazon.com/dp/B08N5WRWNW')).toBe(true);
    expect(isAmazonUrl('https://amazon.com.evil.example/dp/x')).toBe(false);
    expect(isAmazonUrl('https://shop.example/')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test utils/wishlistInput.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Append `isAmazonUrl` to `server/utils/amazon.ts`**

```ts
const AMAZON_HOSTS = ['amazon.com', 'www.amazon.com', 'smile.amazon.com'];

export function isAmazonUrl(url: string): boolean {
  try {
    return AMAZON_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Create `server/utils/wishlistInput.ts`**

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && bun test utils/wishlistInput.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/utils
git commit -m "feat(server): add wishlist input validation and Amazon URL detection"
```

---

### Task 5: Server route, types, email

**Files:**
- Modify: `server/routes/wishlist.ts`
- Modify: `server/services/email.ts:60-80`
- Modify: `server/types/index.ts`

- [ ] **Step 1: Update `server/routes/wishlist.ts` imports and add a response mapper**

Replace the import of `fetchProductInfo` and add helpers after `const router = Router();`:

```ts
import { fetchProductInfo, isAmazonUrl } from '../utils/amazon.js';
import { fetchLinkMetadata } from '../utils/linkMetadata.js';
import { parseWishlistInput } from '../utils/wishlistInput.js';
```

```ts
function toResponse(item: WishlistItem) {
  return {
    id: item.id,
    userId: item.user_id,
    url: item.url,
    description: item.description,
    title: item.title,
    imageUrl: item.image_url,
    price: item.price,
    addedAt: item.added_at,
  };
}

function itemLabel(item: { title: string | null; description: string | null; url: string | null }) {
  if (item.title) return item.title;
  if (item.description) return item.description;
  try {
    return item.url ? new URL(item.url).hostname : 'New Item';
  } catch {
    return 'New Item';
  }
}
```

- [ ] **Step 2: Use `toResponse` in the two list endpoints**

In `GET /`: replace `res.json(items.map((item: WishlistItem) => ({ ... })));` with `res.json(items.map(toResponse));`.

In `GET /recipient`: replace the `items: items.map((item: WishlistItem) => ({ ... })),` with `items: items.map(toResponse),`.

- [ ] **Step 3: Replace the validation + insert section of `POST /`**

Replace everything from `const { amazonUrl } = req.body;` through the `.run(userId, sanitizedUrl, ...)` insert with:

```ts
    const input = parseWishlistInput(req.body);
    if (!input.ok) {
      res.status(400).json({ error: input.error });
      return;
    }
    const { url, description } = input;

    let metadata: { title: string | null; imageUrl: string | null; price: string | null } = {
      title: null,
      imageUrl: null,
      price: null,
    };
    if (url) {
      metadata = isAmazonUrl(url) ? await fetchProductInfo(url) : await fetchLinkMetadata(url);
    }

    const result = db
      .prepare(
        'INSERT INTO wishlist_items (user_id, url, description, title, image_url, price) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(userId, url, description, metadata.title, metadata.imageUrl, metadata.price);
```

Update the doc comment above the route to `Add item to wishlist (url and/or description; fetches page metadata)`.

- [ ] **Step 4: Fix the remaining references in `POST /`**

Change the email call argument `productInfo.title || 'New Item'` to `itemLabel(item)`, and replace the final `res.status(201).json({ ... })` with `res.status(201).json(toResponse(item));`. Confirm no `productInfo`, `amazonUrl`, or `amazon_url` references remain in the file:

Run: `grep -nE "productInfo|amazonUrl|amazon_url" server/routes/wishlist.ts`
Expected: no output.

- [ ] **Step 5: Escape the item label in `server/services/email.ts`**

Add above `sendWishlistUpdateEmail`:

```ts
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
```

and change `${itemTitle}</p>` in the template to `${escapeHtml(itemTitle)}</p>`.

- [ ] **Step 6: Update `server/types/index.ts`**

In `WishlistItemResponse` replace `amazonUrl: string;` with:

```ts
  url: string | null;
  description: string | null;
```

Replace `AddWishlistItemRequest` with:

```ts
export interface AddWishlistItemRequest {
  url?: string;
  description?: string;
}
```

- [ ] **Step 7: Verify**

Run: `cd server && bun test && bunx tsc --noEmit`
Expected: all tests pass. If `tsc` reports errors, confirm they also exist on the previous commit (`git stash; bunx tsc --noEmit; git stash pop`) and only fix ones introduced by this task.

- [ ] **Step 8: Smoke test the migration against a copy of real data**

Run (skip if `data/santa.db` does not exist):

```bash
cp data/santa.db /tmp/santa-migrate.db && cd server && bun -e "
import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { migrateWishlistItems } from './db/migrations';
const db = new Database('/tmp/santa-migrate.db');
const before = db.query('SELECT COUNT(*) AS n FROM wishlist_items').get();
migrateWishlistItems(db, readFileSync('db/schema.sql','utf-8'));
console.log(before, db.query('SELECT COUNT(*) AS n FROM wishlist_items').get(), db.query('PRAGMA table_info(wishlist_items)').all().map(c=>c.name));
"
```
Expected: row counts equal; columns include `url` and `description`, not `amazon_url`.

- [ ] **Step 9: Commit**

```bash
git add server
git commit -m "feat(server): accept any url and/or description on wishlist items"
```

---

### Task 6: Client types and hook

**Files:**
- Modify: `client/src/types/index.ts:19-27`
- Modify: `client/src/hooks/useWishlist.ts:9,41-45`

- [ ] **Step 1: Update `client/src/types/index.ts`**

```ts
export interface WishlistItem {
  id: number;
  userId: number;
  url: string | null;
  description: string | null;
  title: string | null;
  imageUrl: string | null;
  price: string | null;
  addedAt: string;
}

export interface NewWishlistItem {
  url?: string;
  description?: string;
}
```

- [ ] **Step 2: Update `client/src/hooks/useWishlist.ts`**

Change the import to `import type { WishlistItem, NewWishlistItem } from '@/types';`, the interface member to `addItem: (input: NewWishlistItem) => Promise<void>;`, and the callback to:

```ts
  const addItem = useCallback(async (input: NewWishlistItem) => {
    setError(null);
    try {
      const newItem = await api.post<WishlistItem>('/wishlist', input);
```

(leave the rest of the callback unchanged).

- [ ] **Step 3: Commit** (client build is verified after Task 9, since components still reference old fields)

```bash
git add client/src/types client/src/hooks
git commit -m "refactor(client): rename wishlist item fields and addItem payload"
```

---

### Task 7: Wishlist form

**Files:**
- Modify: `client/src/components/wishlist/WishlistForm.tsx`

- [ ] **Step 1: Rewrite the component body**

Replace the props, state, `validateUrl`, `handleSubmit`, and the field/button section so the file reads:

```tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { NewWishlistItem } from '@/types';

interface WishlistFormProps {
  onAdd: (input: NewWishlistItem) => Promise<void>;
}

export function WishlistForm({ onAdd }: WishlistFormProps) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasInput = url.trim() !== '' || description.trim() !== '';

  const validate = (): boolean => {
    if (!hasInput) {
      setError('Enter a link or a description');
      return false;
    }
    if (url.trim()) {
      try {
        const { protocol } = new URL(url.trim());
        if (protocol !== 'http:' && protocol !== 'https:') {
          setError('Link must start with http:// or https://');
          return false;
        }
      } catch {
        setError('Please enter a valid link');
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validate()) return;

    setLoading(true);
    try {
      await onAdd({
        url: url.trim() || undefined,
        description: description.trim() || undefined,
      });
      setUrl('');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item to wishlist');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-[#e5e0d8]">
      <CardHeader>
        <CardTitle className="text-xl text-gray-900">Add Wishlist Item</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="item-url">Link (optional)</Label>
            <Input
              id="item-url"
              type="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              disabled={loading}
              className="border-gray-300 focus-visible:ring-[#1a472a]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-description">Description (optional)</Label>
            <textarea
              id="item-description"
              rows={3}
              maxLength={500}
              placeholder="e.g. A medium blue scarf, any brand"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setError(null);
              }}
              disabled={loading}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a472a] disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-sm text-gray-500">
              Add a link, a description, or both. At least one is required.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            disabled={loading || !hasInput}
            className="w-full bg-[#1a472a] hover:bg-[#1a472a]/90 text-white"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Adding Item...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Add to Wishlist
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/wishlist/WishlistForm.tsx
git commit -m "feat(client): wishlist form accepts any link and/or description"
```

---

### Task 8: Item card

**Files:**
- Modify: `client/src/components/wishlist/WishlistItemCard.tsx`

- [ ] **Step 1: Add helpers above the component**

```tsx
const AMAZON_HOSTS = ['amazon.com', 'www.amazon.com', 'smile.amazon.com'];

function getHostname(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Derive display values inside the component**

After `const displayPrice = formatPrice(item.price);` add:

```tsx
  const hostname = getHostname(item.url);
  const isAmazon = !!item.url && AMAZON_HOSTS.includes(new URL(item.url).hostname.toLowerCase());
  const heading = item.title || item.description || hostname || 'Wishlist item';
  const showDescription = !!item.title && !!item.description;
```

- [ ] **Step 3: Update the content block**

Replace the `<h3>` and price block with:

```tsx
          <h3 className="font-medium text-gray-900 line-clamp-2 min-h-[3rem] leading-snug">
            {heading}
          </h3>
          {showDescription && (
            <p className="mt-2 text-sm text-gray-600 line-clamp-3 whitespace-pre-line">
              {item.description}
            </p>
          )}
          {displayPrice && (
            <div className="flex items-center gap-2 mt-3">
              <p className="text-xl font-bold text-[#1a472a]">{displayPrice}</p>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {isAmazon ? 'Amazon' : hostname}
              </span>
            </div>
          )}
```

- [ ] **Step 4: Update the footer**

Replace the `<CardFooter>` block with one rendered only for items that have a link:

```tsx
        {item.url && (
          <CardFooter className="p-4 pt-0">
            <Button
              asChild
              className="w-full h-11 bg-gradient-to-r from-[#1a472a] to-[#2d5a3d] hover:from-[#1a472a] hover:to-[#1a472a] text-white font-medium shadow-sm hover:shadow-md transition-all duration-300"
            >
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2"
                aria-label={isAmazon ? 'View on Amazon' : 'View link'}
              >
                <ExternalLink className="w-4 h-4" />
                {isAmazon ? 'View on Amazon' : 'View link'}
              </a>
            </Button>
          </CardFooter>
        )}
```

Also change the image `alt` fallback from `'Product image'` to `'Wishlist item image'`.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/wishlist/WishlistItemCard.tsx
git commit -m "feat(client): render link and text-only wishlist items"
```

---

### Task 9: Page wiring and copy

**Files:**
- Modify: `client/src/pages/MyWishlistPage.tsx:5,16-18,40,68`

- [ ] **Step 1: Update the page**

Add `import type { NewWishlistItem } from '@/types';` and change:

```tsx
  const handleAdd = async (input: NewWishlistItem) => {
    await addItem(input);
  };
```

Change the subtitle to `Add links or ideas you'd love to receive this Secret Santa season` and the empty state description to `Add a link or describe something above to help your Secret Santa find the perfect gift!`.

`RecipientWishlistPage.tsx` needs no change (it only renders `WishlistItemCard`).

- [ ] **Step 2: Verify the client builds and lints**

Run: `cd client && bun run build && bun run lint`
Expected: both succeed. Fix any remaining `amazonUrl` references: `grep -rn "amazonUrl" client/src server` should print nothing.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages
git commit -m "feat(client): update wishlist page for links and descriptions"
```

---

### Task 10: End-to-end manual verification

- [ ] **Step 1: Run the full suite**

Run: `cd server && bun test`
Expected: all pass.

- [ ] **Step 2: Start the app against a copy of the real DB**

Run: `cd client && bun run build && cd ../server && bun index.ts` (server log must show `Database initialized`). Open http://localhost:3001 and log in.

- [ ] **Step 3: Check each case in the UI**

| Input | Expected |
|---|---|
| Amazon URL only | Card with Amazon title/image/price and "View on Amazon" |
| Non-Amazon product URL only | Card with page title/image, hostname badge, "View link" |
| Description only | Card with description as heading, placeholder image, no button |
| URL + description | Card shows title, description beneath, button |
| Both empty | Submit disabled; no request sent |
| `http://localhost:3001/` or `http://169.254.169.254/` | Item saved as plain link, no title/image, and no server request made to it |
| `ftp://x.example` | Error shown, nothing saved |
| Pre-existing items | Still visible after the migration |

- [ ] **Step 3: Check the recipient view and email**

As a matched giver, open the recipient wishlist and confirm all card types render. If email is configured, confirm the Santa notification shows the title, then description, then hostname, and that HTML in a description is shown as text.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found in manual verification"
```
