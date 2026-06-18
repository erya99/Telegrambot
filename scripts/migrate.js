// scripts/migrate.js
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function migrate() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const sql = fs.readFileSync(
    path.join(__dirname, '../src/database/migrations/001_schema.sql'),
    'utf8'
  );

  try {
    await pool.query(sql);
    console.log('✅ Migration başarılı');
  } catch (err) {
    console.error('❌ Migration hatası:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
