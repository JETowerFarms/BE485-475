#!/usr/bin/env node
// Seed/verify admin user in DB using the app's own DB connection.
//
// Usage:
//   ADMIN_PASSWORD=<secret> node seed_admin.js
//
// The password is read from the ADMIN_PASSWORD environment variable.
// If the variable is missing, a default placeholder is used **with a
// console warning** so accidental production deployments are noisy.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { db } = require(path.join(__dirname, 'src', 'database'));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

async function main() {
  try {
    if (ADMIN_PASSWORD === 'changeme') {
      console.warn('⚠  ADMIN_PASSWORD not set — using default placeholder "changeme". Set ADMIN_PASSWORD env var for production.');
    }

    // Check if users table exists (schema should create it, but guard anyway)
    const tableExists = await db.oneOrNone(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'"
    );
    if (!tableExists) {
      console.log('users table does not exist — creating...');
      await db.none(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
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
      await db.none(
        `INSERT INTO users (username, password_hash)
         VALUES ('admin', crypt($1, gen_salt('bf')))`,
        [ADMIN_PASSWORD]
      );
      console.log('Admin user created.');
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
