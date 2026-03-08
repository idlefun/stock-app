const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Per-file write locks to prevent concurrent read-modify-write races
const locks = {};

function getLock(filename) {
  if (!locks[filename]) locks[filename] = Promise.resolve();
  return locks[filename];
}

function withLock(filename, fn) {
  const prev = getLock(filename);
  const next = prev.then(fn, fn);
  locks[filename] = next.catch(() => {});
  return next;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJSON(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function writeJSON(filename, data) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);
  const tmpPath = path.join(DATA_DIR, `.${filename}.tmp.${process.pid}`);
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, content, 'utf-8');
  await fs.rename(tmpPath, filePath);
}

async function readOrDefault(filename, defaultValue) {
  const data = await readJSON(filename);
  if (data === null) {
    await writeJSON(filename, defaultValue);
    return defaultValue;
  }
  return data;
}

module.exports = { DATA_DIR, ensureDataDir, readJSON, writeJSON, readOrDefault, withLock };
