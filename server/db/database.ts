import { Database } from 'bun:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { migrateWishlistItems } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure data directory exists
const dataDir = join(__dirname, '../../data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// Initialize database
const dbPath = join(dataDir, 'santa.db');
const db = new Database(dbPath);
export { db };

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Initialize schema
const schemaPath = join(__dirname, 'schema.sql');
const schema = readFileSync(schemaPath, 'utf-8');

migrateWishlistItems(db, schema);
db.run(schema);

console.log('Database initialized at:', dbPath);

// Type definitions for database rows
export interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  is_admin: number;
  has_seen_reveal: number;
  created_at: string;
}

export interface Match {
  id: number;
  giver_id: number;
  receiver_id: number;
  year: number;
}

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

export interface Session {
  id: string;
  user_id: number;
  expires_at: string;
}
