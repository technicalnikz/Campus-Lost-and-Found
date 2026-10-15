const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const mysql = require('mysql2/promise');

const collections = {
  users: { table: 'app_users' },
  items: { table: 'app_items' },
  claims: { table: 'app_claims' }
};
const contextStorage = new AsyncLocalStorage();
let pool;

function getConfig() {
  const names = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const configured = names.filter(name => process.env[name]);
  if (configured.length === 0 && !process.env.DB_PORT) return null;
  if (configured.length !== names.length) {
    throw new Error('DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD must all be configured.');
  }

  const port = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
  }

  return {
    host: process.env.DB_HOST,
    port,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  };
}

function isConfigured() {
  return getConfig() !== null;
}

function getPool() {
  const config = getConfig();
  if (!config) throw new Error('MySQL database environment variables are not configured.');
  if (!pool) pool = mysql.createPool(config);
  return pool;
}

function getCollectionName(filePath) {
  const name = path.basename(filePath, '.json');
  if (!collections[name]) throw new Error(`Unsupported persistent data file: ${name}.json`);
  return name;
}

function readCollection(filePath) {
  const context = contextStorage.getStore();
  if (!context) throw new Error('MySQL data can only be accessed within a database transaction.');
  return context.data[getCollectionName(filePath)];
}

function writeCollection(filePath, value) {
  if (!Array.isArray(value)) throw new TypeError(`Expected an array for ${filePath}.`);
  const context = contextStorage.getStore();
  if (!context) throw new Error('MySQL data can only be changed within a database transaction.');
  const name = getCollectionName(filePath);
  context.data[name] = value;
  context.dirty.add(name);
}

async function createTables(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      record_id VARCHAR(191) NOT NULL PRIMARY KEY,
      payload JSON NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_items (
      record_id VARCHAR(191) NOT NULL PRIMARY KEY,
      payload JSON NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_claims (
      record_id VARCHAR(191) NOT NULL PRIMARY KEY,
      payload JSON NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      migration_key VARCHAR(191) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_store_lock (
      lock_id TINYINT NOT NULL PRIMARY KEY
    ) ENGINE=InnoDB
  `);
  await connection.query('INSERT IGNORE INTO app_store_lock (lock_id) VALUES (1)');
}

async function loadData(connection) {
  const data = {};
  for (const [name, definition] of Object.entries(collections)) {
    const [rows] = await connection.query(`SELECT payload FROM ${definition.table}`);
    data[name] = rows.map(row =>
      typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    );
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
    await connection.execute(
      `INSERT INTO ${table} (record_id, payload) VALUES (?, ?)`,
      [String(row.id), JSON.stringify(row)]
    );
  }
}

async function acquireContext() {
  const connection = await getPool().getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    // Existing handlers mutate collection snapshots; serialize their transactions across app instances.
    const [lockRows] = await connection.query(
      'SELECT lock_id FROM app_store_lock WHERE lock_id = 1 FOR UPDATE'
    );
    if (!lockRows.length) throw new Error('The MySQL application lock row is missing.');
    return {
      connection,
      data: await loadData(connection),
      dirty: new Set(),
      finished: false
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Could not roll back the Back2You database transaction:', rollbackError.message);
      }
    }
    connection.release();
    throw error;
  }
}

async function finishContext(context, commit) {
  if (context.finished) return;
  context.finished = true;
  try {
    if (commit) {
      for (const name of context.dirty) {
        await saveCollection(context.connection, name, context.data[name]);
      }
      await context.connection.commit();
    } else {
      await context.connection.rollback();
    }
  } catch (error) {
    try {
      await context.connection.rollback();
    } catch (rollbackError) {
      console.error('Could not roll back the Back2You database transaction:', rollbackError.message);
    }
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
      console.error('Invalid MySQL configuration:', error.message);
      return next(error);
    }
    if (!configured) return next();

    let context;
    try {
      context = await acquireContext();
    } catch (error) {
      console.error('Could not start a MySQL request transaction:', error.message);
      return next(error);
    }

    const originalEnd = res.end;
    const rollbackOnClose = () => {
      if (!res.writableFinished && !context.finished) {
        finishContext(context, false).catch(error => {
          console.error('Could not close the abandoned Back2You database transaction:', error.message);
        });
      }
    };
    res.once('close', rollbackOnClose);
    res.end = function (...args) {
      if (context.finished) return this;
      finishContext(context, res.statusCode < 500).then(() => {
        res.removeListener('close', rollbackOnClose);
        originalEnd.apply(res, args);
      }).catch(error => {
        console.error('Could not persist the Back2You request:', error.message);
        res.removeListener('close', rollbackOnClose);
        if (!res.headersSent) {
          res.statusCode = 500;
          originalEnd.call(res, JSON.stringify({
            success: false,
            message: 'Could not save application data.'
          }));
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
  if (!isConfigured()) throw new Error('MySQL database environment variables are required in production.');
  const connection = await getPool().getConnection();
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
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        importedData[name] = [];
        continue;
      }
      throw error;
    }
    const value = JSON.parse(content);
    if (!Array.isArray(value)) throw new TypeError(`Expected an array in ${filePath}.`);
    importedData[name] = value;
  }

  if (!importedData.users.length) {
    throw new Error('The JSON source must contain at least one user; no data was imported.');
  }

  await withTransaction(async () => {
    const [migrationRows] = await contextStorage.getStore().connection.execute(
      'SELECT migration_key FROM app_migrations WHERE migration_key = ?',
      ['json-data-import-v1']
    );
    if (migrationRows.length) throw new Error('JSON data has already been imported into this database.');

    const context = contextStorage.getStore();
    const existingAdmin = context.data.users.length === 1
      && context.data.items.length === 0
      && context.data.claims.length === 0
      && context.data.users[0].role === 'admin'
      && context.data.users[0].email.toLowerCase() === (process.env.ADMIN_EMAIL || 'admin@cspc.edu.ph').trim().toLowerCase()
      ? context.data.users[0]
      : null;
    const containsOnlyInitialAdmin = existingAdmin !== null;
    if (Object.values(context.data).some(rows => rows.length) && !containsOnlyInitialAdmin) {
      throw new Error('The database is not empty; refusing to overwrite existing records.');
    }

    if (containsOnlyInitialAdmin) {
      const importedAdminIndex = importedData.users.findIndex(user =>
        user.email.toLowerCase() === existingAdmin.email.toLowerCase()
      );
      if (importedAdminIndex === -1) {
        importedData.users.unshift(existingAdmin);
      } else {
        importedData.users[importedAdminIndex].passwordHash = existingAdmin.passwordHash;
      }
    }
    Object.assign(context.data, importedData);
    Object.keys(collections).forEach(name => context.dirty.add(name));
    await context.connection.execute(
      'INSERT INTO app_migrations (migration_key) VALUES (?)',
      ['json-data-import-v1']
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
