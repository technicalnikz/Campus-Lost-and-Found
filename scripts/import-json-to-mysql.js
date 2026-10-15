require('dotenv').config();

const path = require('path');
const postgresStore = require('../services/postgresStore');

async function main() {
  if (!postgresStore.isConfigured()) {
    throw new Error('Configure DATABASE_URL before importing data.');
  }

  const sourceDir = process.env.LEGACY_DATA_DIR || path.join(__dirname, '..', 'data');
  await postgresStore.initialize();
  const imported = await postgresStore.importJsonFiles(sourceDir);
  console.log('Imported JSON data into Supabase PostgreSQL:', imported);
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error('JSON-to-MySQL import failed:', error.message);
    process.exitCode = 1;
  }

  try {
    await postgresStore.close();
  } catch (error) {
    console.error('Could not close the MySQL connection pool:', error.message);
    process.exitCode = 1;
  }
}

run();
