const { readJSON, writeJSON } = require('./storage');

function createCache(filename, ttlMs) {
  let memory = null;
  let loaded = false;
  let saving = null;

  function isFresh(entry) {
    if (!entry || !entry.fetchedAt) return false;
    return Date.now() - new Date(entry.fetchedAt).getTime() < ttlMs;
  }

  async function load() {
    if (!loaded) {
      memory = await readJSON(filename) || {};
      loaded = true;
    }
    return memory;
  }

  async function save() {
    if (saving) return saving;
    saving = writeJSON(filename, memory).finally(() => { saving = null; });
    return saving;
  }

  function get(key) {
    if (!memory) return null;
    const entry = key ? memory[key] : memory;
    return entry && isFresh(entry) ? entry : null;
  }

  function getStale(key) {
    if (!memory) return null;
    return key ? memory[key] || null : memory;
  }

  async function set(key, value) {
    if (!memory) memory = {};
    if (key) {
      memory[key] = { ...value, fetchedAt: new Date().toISOString() };
    } else {
      memory = { ...value, fetchedAt: new Date().toISOString() };
    }
    await save();
  }

  return { load, get, getStale, set, isFresh };
}

module.exports = { createCache };
