const { Pool } = require('pg');
const path = require('path');
const knexLib = require('knex');
const logger = require('./logger');

let pool = null;
let knex = null;

function initDb() {
  if (pool) return { pool, knex };
  
  pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'mailcache',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });
  
  pool.on('error', (err) => {
    logger.error('Unexpected database pool error', { error: err.message });
  });
  
  const env = process.env.NODE_ENV || 'development';
  const knexConfig = require('./knexfile.cjs')[env];
  knex = knexLib(knexConfig);
  
  logger.info('Database initialized');
  
  return { pool, knex };
}

function getDb() {
  if (!pool || !knex) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return { pool, knex };
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (knex) {
    await knex.destroy();
    knex = null;
  }
  logger.info('Database connections closed');
}

module.exports = {
  initDb,
  getDb,
  closeDb
};

