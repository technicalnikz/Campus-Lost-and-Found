require('dotenv').config();

const path = require('path');
const mysqlStore = require('../services/mysqlStore');

async function main() {
  if (!mysqlStore.isConfigured()) {
    throw new Error('Configure DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD before importing data.');
  }

  const sourceDir = process.env.LEGACY_DATA_DIR || path.join(__dirname, '..', 'data');
  await mysqlStore.initialize();
  const imported = await mysqlStore.importJsonFiles(sourceDir);
  console.log('Imported JSON data into MySQL:', imported);
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error('JSON-to-MySQL import failed:', error.message);
    process.exitCode = 1;
  }

  try {
    await mysqlStore.close();
  } catch (error) {
    console.error('Could not close the MySQL connection pool:', error.message);
    process.exitCode = 1;
  }
}

run();
