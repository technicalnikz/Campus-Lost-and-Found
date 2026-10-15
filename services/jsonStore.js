const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysqlStore = require('./mysqlStore');

function readJsonArray(filePath) {
  if (mysqlStore.isConfigured()) return mysqlStore.readCollection(filePath);

  let data;
  try {
    data = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const value = JSON.parse(data);
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected an array in ${filePath}.`);
  }
  return value;
}

function writeJsonArray(filePath, value) {
  if (mysqlStore.isConfigured()) return mysqlStore.writeCollection(filePath, value);

  if (!Array.isArray(value)) {
    throw new TypeError(`Expected an array for ${filePath}.`);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  });
  fs.renameSync(temporaryPath, filePath);
}

module.exports = { readJsonArray, writeJsonArray };
