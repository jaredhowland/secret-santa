# Flexible Wishlist Items

## Goal

Let users add wishlist items with any URL (not only Amazon) and/or a free-text description. At least one of URL or description is required.

## Database

- `wishlist_items`: rename `amazon_url` to `url` (nullable), add nullable `description`.
- `CHECK (url IS NOT NULL OR description IS NOT NULL)`.
- SQLite cannot drop `NOT NULL` in place, so a one-time startup migration in `server/db/database.ts` rebuilds the table, copying existing rows (`amazon_url` -> `url`). It is skipped if already migrated.
- `server/db/schema.sql` holds the new definition for fresh installs.

## Server (`server/routes/wishlist.ts`)

- `POST /api/wishlist` accepts `{ url?, description? }`. Values are trimmed; empty strings count as missing. Neither present -> 400.
- A provided URL must be valid `http` or `https`. Amazon-only and HTTPS-only checks are removed.
- Metadata:
  - Amazon URLs use the existing scraper (`server/utils/amazon.ts`).
  - Other URLs use a new generic fetcher reading Open Graph / Twitter tags, falling back to `<title>`.
  - Fetch failures never block the add; the item is saved without metadata.
- SSRF protection in the generic fetcher:
  - Resolve hostname; reject loopback, private, link-local, and cloud-metadata IPs.
  - Redirects handled manually (max 3), re-validating each hop.
  - 5s timeout, ~1 MB body cap, HTML content types only.
- Responses return `url`, `description`, `title`, `imageUrl`, `price` (`amazonUrl` renamed to `url`) on GET, POST, and recipient endpoints.
- Santa notification email label: title, then description, then hostname.

## Client

- `types/index.ts`, `hooks/useWishlist.ts`, `lib/api.ts`: `addItem({ url?, description? })`, field rename.
- `WishlistForm`: optional Link input (any URL) and optional Description textarea; submit disabled until one is filled; client-side validation mirrors the server; generic copy.
- `WishlistItemCard`:
  - Title falls back to description, then hostname.
  - Description shown under the title when a title also exists.
  - Button reads "View on Amazon" for Amazon links, "View link" otherwise; no button for text-only items.
  - "Amazon" price badge only for Amazon links.
- `MyWishlistPage` and `RecipientWishlistPage`: copy updated; new add payload.

## Verification

No test framework exists in the repo. Verify with type checks and build, run the migration against a copy of an existing DB, and exercise the API with: URL only, text only, both, neither, private-IP URL, non-http scheme.
