const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

console.log('='.repeat(60));
console.log('Backend Configuration Test');
console.log('='.repeat(60));
console.log('');

// Check environment variables
console.log('Environment Variables:');
console.log('  NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('  PORT:', process.env.PORT || 'not set');
console.log('  DB_HOST:', process.env.DB_HOST || 'not set');
console.log('  DB_PORT:', process.env.DB_PORT || 'not set');
console.log('  DB_NAME:', process.env.DB_NAME || 'not set');
console.log('  DB_USER:', process.env.DB_USER || 'not set');
console.log('  DB_PASSWORD:', process.env.DB_PASSWORD ? '***set***' : 'NOT SET');
console.log('');

// Check required modules
console.log('Required Modules:');
const modules = [
  'express',
  'pg',
  'pg-promise',
  'cors',
  'dotenv',
  'compression',
  'helmet',
  'express-rate-limit',
  'morgan',
  'joi',
];

let allPresent = true;
modules.forEach((mod) => {
  try {
    require.resolve(mod);
    console.log(`  ✓ ${mod}`);
  } catch (e) {
    console.log(`  ✗ ${mod} - MISSING`);
    allPresent = false;
  }
});
console.log('');

// Check source files
const fs = require('fs');
console.log('Source Files:');
const sourceFiles = [
  'src/server.js',
  'src/database.js',
  'src/routes/solar.js',
  'src/routes/farms.js',
  'src/routes/geo.js',
  'scripts/setup-database.js',
  'scripts/import-solar-data.js',
  'DATABASE_SCHEMA.sql',
];

sourceFiles.forEach((file) => {
  const exists = fs.existsSync(path.join(__dirname, file));
  console.log(`  ${exists ? '✓' : '✗'} ${file}`);
});
console.log('');

// Summary
console.log('='.repeat(60));
if (allPresent) {
  console.log('✅ Backend setup complete!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Update .env with your PostgreSQL password');
  console.log('2. Install PostgreSQL with PostGIS extension');
  console.log('3. Run: npm run db:setup');
  console.log('4. Run: npm run db:import (30-45 minutes)');
  console.log('5. Run: npm run dev');
} else {
  console.log('❌ Some modules are missing. Run: npm install');
}
console.log('='.repeat(60));
