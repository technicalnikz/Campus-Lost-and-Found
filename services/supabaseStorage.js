const crypto = require('crypto');

const STORAGE_PREFIX = 'storage://';

function getConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'item-photos';
  return url && key ? { url, key, bucket } : null;
}

function isConfigured() {
  return Boolean(getConfig());
}

function objectKey(photo) {
  return typeof photo === 'string' && photo.startsWith(STORAGE_PREFIX)
    ? photo.slice(STORAGE_PREFIX.length)
    : null;
}

function storageUrl(config, key) {
  return `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

async function uploadImage(file) {
  const config = getConfig();
  if (!config) throw new Error('Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.');

  const key = `items/${crypto.randomUUID()}.${file.originalname?.split('.').pop()?.toLowerCase() || 'bin'}`;
  const response = await fetch(storageUrl(config, key), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.key}`,
      apikey: config.key,
      'Content-Type': file.mimetype,
      'x-upsert': 'false'
    },
    body: file.buffer
  });
  if (!response.ok) throw new Error(`Supabase Storage upload failed (${response.status}).`);
  return `${STORAGE_PREFIX}${key}`;
}

async function downloadImage(photo) {
  const config = getConfig();
  const key = objectKey(photo);
  if (!config || !key) return null;
  const response = await fetch(storageUrl(config, key), {
    headers: { Authorization: `Bearer ${config.key}`, apikey: config.key }
  });
  if (!response.ok) return null;
  return response;
}

async function deleteImage(photo) {
  const config = getConfig();
  const key = objectKey(photo);
  if (!config || !key) return;
  await fetch(storageUrl(config, key), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${config.key}`, apikey: config.key }
  });
}

module.exports = { isConfigured, objectKey, uploadImage, downloadImage, deleteImage };
