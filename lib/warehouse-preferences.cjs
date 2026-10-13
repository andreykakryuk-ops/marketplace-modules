'use strict';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const validateLayout=value=>{if(!value||!Array.isArray(value.order)||!Array.isArray(value.hidden))throw error('INVALID_PREFERENCES');const out={};for(const key of ['order','hidden']){const rows=value[key];if(rows.length>20000||rows.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(rows).size!==rows.length)throw error('INVALID_PREFERENCES');out[key]=[...rows];}return out;};
const upgradeLayout=validateLayout;const defaultLayout=()=>({order:[],hidden:[]});
const locks = globalThis[Symbol.for('starsenix.warehouse.preferences.v1')] ??= new Map();
const error = code => Object.assign(new Error(code), { code });
function createWarehousePreferences({ directory }) {
  if (!path.isAbsolute(directory)) throw error('INVALID_DIRECTORY');
  const root = path.resolve(directory);
  const userKey = userId => {
    if (typeof userId !== 'string' || !userId.trim() || userId.length > 500) throw error('INVALID_USER');
    return crypto.createHash('sha256').update(userId).digest('hex');
  };
  async function guard(create = false) {
    if (create) await fs.mkdir(root, { recursive: true, mode: 0o700 });
    let current = path.parse(root).root;
    for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw error('UNSAFE_PATH');
    }
  }
  async function read(userId) {
    const key = userKey(userId), file = path.join(root, key + '.json');
    try {
      await guard(); const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4000000) throw error('UNSAFE_PATH');
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      if (value.schemaVersion !== 1 || value.userKey !== key || !Number.isSafeInteger(value.revision) || value.revision < 1) throw error('INVALID_PREFERENCES');
      return { revision: value.revision, layout: upgradeLayout(value.layout) };
    } catch (e) { if (e.code === 'ENOENT') return { revision: 0, layout: defaultLayout() }; throw e; }
  }
  async function write(userId, { layout, expectedRevision }) {
    const key = userKey(userId), value = validateLayout(layout);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw error('INVALID_REVISION');
    const file = path.join(root, key + '.json'), lockKey = process.platform === 'win32' ? file.toLowerCase() : file;
    const previous = locks.get(lockKey) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const current = await read(userId);
      if (current.revision !== expectedRevision) throw error('PREFERENCE_CONFLICT');
      await guard(true);
      const next = { schemaVersion: 1, userKey: key, revision: current.revision + 1, layout: value };
      const temporary = file + '.' + crypto.randomUUID() + '.tmp'; let handle;
      try {
        handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(JSON.stringify(next)); await handle.sync(); await handle.close(); handle = null;
        await guard(); await fs.rename(temporary, file);
      } finally { await handle?.close(); await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
      return { revision: next.revision, layout: validateLayout(value) };
    });
    locks.set(lockKey, operation);
    try { return await operation; } finally { if (locks.get(lockKey) === operation) locks.delete(lockKey); }
  }
  return { read, write };
}
module.exports = { createWarehousePreferences };
