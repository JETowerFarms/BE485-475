#!/usr/bin/env node
// Seed/verify admin user in DB using the app's own DB connection
require('dotenv').config({ path: '/home/money/backend/.env' });
const { db } = require('/home/money/backend/src/database');

async function main() {
  try {
    // Check if users table exists
    const tableExists = await db.oneOrNone(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'"
    );
    if (!tableExists) {
      console.log('users table does not exist — creating...');
      await db.none(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      console.log('users table created.');
    } else {
      console.log('users table exists.');
    }

    // Check if admin exists
    const admin = await db.oneOrNone("SELECT id, username FROM users WHERE username = 'admin'");
    if (admin) {
      console.log('Admin user already exists:', admin);
    } else {
      console.log('Creating admin user...');
      await db.none(`
        INSERT INTO users (username, password_hash)
        VALUES ('admin', crypt('Solar2026!', gen_salt('bf')))
      `);
      console.log('Admin user created with password Solar2026!');
    }

    // List all users
    const users = await db.any('SELECT id, username, created_at FROM users');
    console.log('All users:', users);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
