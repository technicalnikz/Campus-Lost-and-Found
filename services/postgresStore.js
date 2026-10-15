const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { Pool } = require('pg');

const collections = {
  users: { table: 'app_users' },
  items: { table: 'app_items' },
  claims: { table: 'app_claims' }
};
const contextStorage = new AsyncLocalStorage();
let pool;

function getConfig() {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) return null;
  return {
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  };
}

function isConfigured() {
  return getConfig() !== null;
}

function getPool() {
  const config = getConfig();
  if (!config) throw new Error('DATABASE_URL must be configured for Supabase PostgreSQL.');
  if (!pool) pool = new Pool(config);
  return pool;
}

function getCollectionName(filePath) {
  const name = path.basename(filePath, '.json');
  if (!collections[name]) throw new Error(`Unsupported persistent data file: ${name}.json`);
  return name;
}

function readCollection(filePath) {
  const context = contextStorage.getStore();
  if (!context) throw new Error('PostgreSQL data can only be accessed within a database transaction.');
  return context.data[getCollectionName(filePath)];
}

function writeCollection(filePath, value) {
  if (!Array.isArray(value)) throw new TypeError(`Expected an array for ${filePath}.`);
  const context = contextStorage.getStore();
  if (!context) throw new Error('PostgreSQL data can only be changed within a database transaction.');
  const name = getCollectionName(filePath);
  context.data[name] = value;
  context.dirty.add(name);
}

async function createTables(connection) {
  for (const definition of Object.values(collections)) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${definition.table} (
        record_id VARCHAR(255) PRIMARY KEY,
        payload JSONB NOT NULL
      )
    `);
  }
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      migration_key VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_store_lock (
      lock_id SMALLINT PRIMARY KEY
    )
  `);
  await connection.query(
    'INSERT INTO app_store_lock (lock_id) VALUES (1) ON CONFLICT (lock_id) DO NOTHING'
  );
}

async function loadData(connection) {
  const data = {};
  for (const [name, definition] of Object.entries(collections)) {
    const result = await connection.query(`SELECT payload FROM ${definition.table}`);
    data[name] = result.rows.map(row => row.payload);
  }
  return data;
}

async function saveCollection(connection, name, rows) {
  const { table } = collections[name];
  await connection.query(`DELETE FROM ${table}`);
  for (const row of rows) {
    if (!row || row.id === undefined || row.id === null) {
      throw new TypeError(`Every ${name} record must have an id.`);
    }
    await connection.query(
      `INSERT INTO ${table} (record_id, payload) VALUES ($1, $2::jsonb)`,
      [String(row.id), JSON.stringify(row)]
    );
  }
}

async function acquireContext() {
  const connection = await getPool().connect();
  let transactionStarted = false;
  try {
    await connection.query('BEGIN');
    transactionStarted = true;
    const lockResult = await connection.query(
      'SELECT lock_id FROM app_store_lock WHERE lock_id = 1 FOR UPDATE'
    );
    if (!lockResult.rowCount) throw new Error('The Supabase application lock row is missing.');
    return { connection, data: await loadData(connection), dirty: new Set(), finished: false };
  } catch (error) {
    if (transactionStarted) await connection.query('ROLLBACK').catch(() => {});
    connection.release();
    throw error;
  }
}

async function finishContext(context, commit) {
  if (context.finished) return;
  context.finished = true;
  try {
    if (commit) {
      for (const name of context.dirty) await saveCollection(context.connection, name, context.data[name]);
      await context.connection.query('COMMIT');
    } else {
      await context.connection.query('ROLLBACK');
    }
  } catch (error) {
    await context.connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    context.connection.release();
  }
}

async function withTransaction(callback) {
  const context = await acquireContext();
  try {
    const result = await contextStorage.run(context, callback);
    await finishContext(context, true);
    return result;
  } catch (error) {
    await finishContext(context, false).catch(rollbackError => {
      console.error('Could not finish the Back2You database transaction:', rollbackError.message);
    });
    throw error;
  }
}

function requestMiddleware() {
  return async (req, res, next) => {
    let configured;
    try {
      configured = isConfigured();
    } catch (error) {
      console.error('Invalid Supabase configuration:', error.message);
      return next(error);
    }
    if (!configured) return next();

    let context;
    try {
      context = await acquireContext();
    } catch (error) {
      console.error('Could not start a Supabase request transaction:', error.message);
      return next(error);
    }

    const originalEnd = res.end;
    const rollbackOnClose = () => {
      if (!res.writableFinished && !context.finished) {
        finishContext(context, false).catch(error =>
          console.error('Could not close the abandoned Supabase transaction:', error.message)
        );
      }
    };
    res.once('close', rollbackOnClose);
    res.end = function (...args) {
      if (context.finished) return this;
      finishContext(context, res.statusCode < 500).then(() => {
        res.removeListener('close', rollbackOnClose);
        originalEnd.apply(res, args);
      }).catch(error => {
        console.error('Could not persist the Supabase request:', error.message);
        res.removeListener('close', rollbackOnClose);
        if (!res.headersSent) {
          res.statusCode = 500;
          originalEnd.call(res, JSON.stringify({ success: false, message: 'Could not save application data.' }));
        } else {
          originalEnd.call(res);
        }
      });
      return this;
    };
    contextStorage.run(context, () => next());
  };
}

async function initialize() {
  if (!isConfigured()) throw new Error('DATABASE_URL is required in production for Supabase PostgreSQL.');
  const connection = await getPool().connect();
  try {
    await createTables(connection);
  } finally {
    connection.release();
  }
}

async function importJsonFiles(dataDir) {
  const importedData = {};
  for (const name of Object.keys(collections)) {
    const filePath = path.join(dataDir, `${name}.json`);
    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(value)) throw new TypeError(`Expected an array in ${filePath}.`);
      importedData[name] = value;
    } catch (error) {
      if (error.code === 'ENOENT') importedData[name] = [];
      else throw error;
    }
  }
  if (!importedData.users.length) {
    throw new Error('The JSON source must contain at least one user; no data was imported.');
  }

  await withTransaction(async () => {
    const context = contextStorage.getStore();
    const migration = await context.connection.query(
      'SELECT migration_key FROM app_migrations WHERE migration_key = $1', ['json-data-import-v1']
    );
    if (migration.rowCount) throw new Error('JSON data has already been imported into this database.');

    const existingAdmin = context.data.users.length === 1 && context.data.items.length === 0
      && context.data.claims.length === 0 && context.data.users[0].role === 'admin'
      && context.data.users[0].email.toLowerCase() === (process.env.ADMIN_EMAIL || 'admin@cspc.edu.ph').trim().toLowerCase()
      ? context.data.users[0] : null;
    if (Object.values(context.data).some(rows => rows.length) && !existingAdmin) {
      throw new Error('The database is not empty; refusing to overwrite existing records.');
    }
    if (existingAdmin) {
      const importedAdmin = importedData.users.find(user => user.email.toLowerCase() === existingAdmin.email.toLowerCase());
      if (!importedAdmin) importedData.users.unshift(existingAdmin);
      else importedAdmin.passwordHash = existingAdmin.passwordHash;
    }
    Object.assign(context.data, importedData);
    Object.keys(collections).forEach(name => context.dirty.add(name));
    await context.connection.query(
      'INSERT INTO app_migrations (migration_key) VALUES ($1)', ['json-data-import-v1']
    );
  });
  return Object.fromEntries(Object.entries(importedData).map(([name, rows]) => [name, rows.length]));
}

async function close() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  await activePool.end();
}

module.exports = {
  close,
  importJsonFiles,
  initialize,
  isConfigured,
  readCollection,
  requestMiddleware,
  withTransaction,
  writeCollection
};
