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
