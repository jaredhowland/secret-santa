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
