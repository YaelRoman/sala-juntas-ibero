const { Pool } = require('pg');

// Fail fast if required DB credentials are missing.
const REQUIRED = ['DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[DB] Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'America/Mexico_City'");
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = pool;
