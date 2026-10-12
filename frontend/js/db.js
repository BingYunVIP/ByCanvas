/**
 * IndexedDB —— 浏览器侧的持久化。
 *
 * 这是用户数据的主存放地：会话历史和生成的图片都在这里；API 配置等小设置
 * 另有 localStorage 镜像，用于 IndexedDB 暂时不可用时的恢复。服务器不存副本。
 *
 * 为什么主体用 IndexedDB 而不是 localStorage：localStorage 只有 5MB 且有
 * 字符串序列化开销，存不下几张图。小体积设置会额外镜像一份到
 * localStorage，避免浏览器在 IndexedDB 被禁用、升级被阻塞或页面立即刷新时
 * 把刚填写的 API Key 和偏好设置悄悄丢掉。
 */

import { cloneState, equalState, mergeState, StorageConflictError } from './state-merge.js';

const DB_NAME = 'bycanvas';
const DB_VERSION = 3;

const CONVERSATIONS = 'conversations';
const IMAGES = 'images';
const SETTINGS = 'settings';
const SETTING_BACKUP_PREFIX = 'bycanvas:setting:v3:';
const settingViews = new Map();
let conversationView = null;
let deletedExamples = [];
/** 库里所有会话行的编号（含已删除墓碑）：给演示分配编号时要避开，别把墓碑悄悄覆盖掉。 */
let reservedIds = [];
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('bycanvas:v3') : null;
if (channel) channel.onmessage = () => window.dispatchEvent(new Event('bycanvas:storage'));
function notifyChanges() { channel?.postMessage({ changed: true }); }

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('当前浏览器不可用 IndexedDB'));
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      dbPromise = null;
      reject(error || new Error('无法打开本机数据库'));
    };

    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CONVERSATIONS)) {
        db.createObjectStore(CONVERSATIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IMAGES)) {
        db.createObjectStore(IMAGES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: 'key' });
      }
      // 仅清理已下线的配置，保留 API 配置、会话和图片。
      if (event.oldVersion < 2) {
        const settings = req.transaction.objectStore(SETTINGS);
        settings.delete('AG');
        const general = settings.get('G');
        general.onsuccess = () => {
          const row = general.result;
          if (!row || !row.value) return;
          delete row.value.agentScrollToBottomAfterSubmit;
          delete row.value.agentMathFormattingPrompt;
          settings.put(row);
        };
      }
    };

    req.onsuccess = () => {
      if (settled) {
        req.result.close();
        return;
      }
      settled = true;
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => fail(req.error);
    req.onblocked = () => fail(new Error('本机数据库升级被其他页面阻塞，请关闭旧页面后重试'));
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;
    try {
      request = fn(store, transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error || request?.error || new Error('本机数据库写入失败'));
    transaction.onabort = () => reject(transaction.error || request?.error || new Error('本机数据库事务已取消'));
  }));
}

function backupKey(key) {
  return SETTING_BACKUP_PREFIX + encodeURIComponent(key);
}

function readSettingBackup(key) {
  if (typeof localStorage === 'undefined') return null;
  try {
    // 第二个是 v3 之前的旧前缀（本项目自己早期版本写的），v3 升级后仍能兜住。
    // 注意：这里**不**读任何 bychat 时代的键 —— 项目已整体更名，旧数据不再兼容。
    const raw = localStorage.getItem(backupKey(key))
      || localStorage.getItem('bycanvas:setting:' + encodeURIComponent(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (key === 'S' && parsed.value) delete parsed.value.appPassword;
    return parsed;
  } catch {
    return null;
  }
}

function writeSettingBackup(key, value, updatedAt, deleted = false) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(backupKey(key), JSON.stringify({ value, updatedAt, deleted }));
    return true;
  } catch {
    return false;
  }
}

/* ---------- 会话 ---------- */

export function putConversation(conv) {
  return run(CONVERSATIONS, 'readwrite', (s) => s.put(conv));
}

export function getConversation(id) {
  return run(CONVERSATIONS, 'readonly', (s) => s.get(id)).then((row) => row?._deleted ? undefined : row);
}

export function listConversations(remember = true) {
  return run(CONVERSATIONS, 'readonly', (s) => s.getAll()).then((list = []) => {
    deletedExamples = list.filter((row) => row._deleted && row.exampleId != null).map((row) => row.exampleId);
    reservedIds = list.map((row) => row.id);
    const visible = list.filter((row) => !row._deleted).map((row) => cleanConversation(row));
    if (remember) conversationView = new Map(visible.map((row) => [row.id, cloneState(row)]));
    return visible.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  });
}

function cleanConversation(row) {
  const { active, _revision, _deleted, ...value } = cloneState(row);
  if (value.messages) value.messages.forEach((round, i) => { round.id ??= 'legacy:' + i; });
  return value;
}
function imageReferences(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (row._deleted) continue;
    for (const item of [row, ...(row.messages || [])]) {
      for (const id of [...(item.images || []), ...(item.referenceImages || [])]) {
        if (typeof id === 'string' && id.startsWith('img_')) ids.add(id);
      }
    }
  }
  return ids;
}
export function deletedExampleIds() { return [...deletedExamples]; }

/** 库里所有会话行的编号（含墓碑），用于给演示分配不冲突的编号。 */
export function storedConversationIds() { return [...reservedIds]; }

/** 演示集换版：清掉旧版留下的演示删除墓碑，避免旧编号把同编号的新演示挡掉。
    只动「演示」的墓碑，用户自己删掉的对话记录不受影响。 */
export async function clearExampleTombstones() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS, 'readwrite');
    const store = tx.objectStore(CONVERSATIONS);
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = request.result || [];
      for (const row of rows) if (row._deleted && row.exampleId != null) store.delete(row.id);
      reservedIds = rows.filter((row) => !(row._deleted && row.exampleId != null)).map((row) => row.id);
    };
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || request.error);
  });
  deletedExamples = [];
}
export function hasConversationChanges(rows) {
  if (!conversationView) return false;
  return rows.length !== conversationView.size || rows.some((row) => !equalState(cleanConversation(row), conversationView.get(row.id)));
}

/** Merge this tab's changes and remove obsolete image references in one transaction. */
export async function syncConversations(rows) {
  if (!conversationView) throw new Error('Read conversations before saving');
  for (const row of rows) {
    row.messages?.forEach((round, i) => { round.id ??= conversationView.get(row.id)?.messages?.[i]?.id || crypto.randomUUID(); });
  }
  const submitted = new Map(rows.map((row) => [row.id, cleanConversation(row)]));
  const before = conversationView;
  const changed = [...new Set([...before.keys(), ...submitted.keys()])]
    .filter((id) => !equalState(before.get(id), submitted.get(id)));
  if (!changed.length) return [];
  const adopted = new Map();
  const removedImages = [];
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([CONVERSATIONS, IMAGES], 'readwrite');
    const store = tx.objectStore(CONVERSATIONS);
    const request = store.getAll();
    let failure;
    request.onsuccess = () => {
      try {
        const records = new Map(request.result.map((row) => [row.id, row]));
        const previousImages = imageReferences(records.values());
        for (const id of changed) {
          const base = before.get(id), local = submitted.get(id), stored = records.get(id);
          if (stored?._deleted || (base && !stored)) continue;
          if (!base && stored?.exampleId != null && stored.exampleId === local?.exampleId) {
            adopted.set(id, cleanConversation(stored));
            continue;
          }
          const value = local === undefined
            ? { id, exampleId: stored?.exampleId, _deleted: true }
            : mergeState(base, local, stored ? cleanConversation(stored) : undefined);
          value._revision = (stored?._revision || 0) + 1;
          records.set(id, value);
          store.put(value);
        }
        const retained = imageReferences(records.values());
        // Only formerly referenced images can be collected. Newly saved blobs may
        // belong to a generation whose conversation has not committed yet.
        for (const id of previousImages) if (!retained.has(id)) {
          tx.objectStore(IMAGES).delete(id);
          removedImages.push(id);
        }
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(failure || tx.error || request.error);
  });
  for (const [id, value] of adopted) {
    const row = rows.find((item) => item.id === id);
    if (equalState(cleanConversation(row), submitted.get(id))) Object.assign(row, value);
    submitted.set(id, value);
  }
  conversationView = submitted;
  notifyChanges();
  return removedImages;
}

export function listImageIds() {
  return run(IMAGES, 'readonly', (s) => s.getAllKeys()).then((ids = []) => ids);
}

export function deleteImages(ids) {
  const uniqueIds = [...new Set(Array.isArray(ids) ? ids : [])];
  if (!uniqueIds.length) return Promise.resolve(0);
  return run(IMAGES, 'readwrite', (s) => {
    for (const id of uniqueIds) s.delete(id);
    return undefined;
  }).then(() => uniqueIds.length);
}

export function deleteConversation(id) {
  return run(CONVERSATIONS, 'readwrite', (s) => s.delete(id));
}

/* ---------- 图片（存 Blob，不占内存） ---------- */

export function putImage(id, blob) {
  return run(IMAGES, 'readwrite', (s) => s.put({ id, blob, createdAt: Date.now() }));
}

export function getImage(id) {
  return run(IMAGES, 'readonly', (s) => s.get(id));
}

export function deleteImage(id) {
  return run(IMAGES, 'readwrite', (s) => s.delete(id));
}

/* ---------- 设置（键值对） ---------- */

export function getSetting(key, fallback = null, remember = true) {
  return run(SETTINGS, 'readonly', (s) => s.get(key))
    .then((row) => {
      const backup = readSettingBackup(key);
      const rowUpdatedAt = Number(row?.updatedAt) || 0;
      const backupUpdatedAt = Number(backup?.updatedAt) || 0;
      const latest = backup && (!row || backupUpdatedAt > rowUpdatedAt) ? backup : row;
      const value = latest?.deleted ? undefined : latest?.value;
      if (key === 'S' && value) delete value.appPassword;
      if (remember) settingViews.set(key, cloneState(value));
      return value === undefined ? fallback : value;
    })
    .catch((error) => {
      const backup = readSettingBackup(key);
      if (backup) {
        const value = backup.deleted ? undefined : backup.value;
        if (remember) settingViews.set(key, cloneState(value));
        return value === undefined ? fallback : value;
      }
      // 设置有明确默认值；IndexedDB 暂不可用时先让页面继续启动，写入时再给出错误。
      if (remember) settingViews.set(key, undefined);
      return fallback;
    });
}

export function setSetting(key, value) {
  return setSettings({ [key]: value });
}
export function deleteSetting(key) {
  return setSettings({ [key]: undefined });
}

export function hasSettingChanges(key, value) {
  return !equalState(settingViews.get(key), value);
}

export async function readSnapshot() {
  const keys = ['S', 'G', 'model', 'size', 'groups'];
  const [rows, ...values] = await Promise.all([listConversations(false), ...keys.map((key) => getSetting(key, undefined, false))]);
  return { rows, settings: Object.fromEntries(keys.map((key, i) => [key, values[i]])) };
}
export function rememberSnapshot(snapshot) {
  conversationView = new Map(snapshot.rows.map((row) => [row.id, cloneState(row)]));
  for (const [key, value] of Object.entries(snapshot.settings)) settingViews.set(key, cloneState(value));
}

/** Synchronously mirror actual changes; merge again under the database write lock. */
export function setSettings(values) {
  let changes;
  try {
    changes = Object.entries(values || {}).flatMap(([key, value]) => {
      const backup = readSettingBackup(key);
      const remote = backup?.deleted ? undefined : backup?.value;
      const base = settingViews.has(key) ? settingViews.get(key) : remote;
      if (equalState(base, value)) return [];
      const merged = backup && key !== 'activeConversationId' ? mergeState(base, value, remote) : cloneState(value);
      return [{ key, base: cloneState(base), local: cloneState(value), value: merged,
        deleted: merged === undefined, updatedAt: Math.max(Date.now(), (backup?.updatedAt || 0) + 1) }];
    });
  } catch (error) { return Promise.reject(error); }
  if (!changes.length) return Promise.resolve(0);
  const backedUp = changes.map((item) => writeSettingBackup(item.key, item.value, item.updatedAt, item.deleted)).every(Boolean);
  // Capture the submitted view immediately so pagehide cannot enqueue it twice.
  changes.forEach((item) => settingViews.set(item.key, cloneState(item.local)));
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS, 'readwrite');
    const store = tx.objectStore(SETTINGS);
    let failure;
    for (const item of changes) {
      const req = store.get(item.key);
      req.onsuccess = () => {
        try {
          const backup = readSettingBackup(item.key);
          const row = req.result;
          if (backup && backup.updatedAt > item.updatedAt) return;
          const latest = backup && (!row || backup.updatedAt > (row.updatedAt || 0)) ? backup : row;
          const value = item.key === 'activeConversationId' ? item.local : mergeState(item.base, item.local, latest?.deleted ? undefined : latest?.value);
          const updatedAt = Math.max(item.updatedAt, latest?.updatedAt || 0);
          store.put({ key: item.key, value, deleted: value === undefined, updatedAt, revision: (row?.revision || 0) + 1 });
        } catch (error) { failure = error; tx.abort(); }
      };
    }
    tx.oncomplete = () => { notifyChanges(); resolve(changes.length); };
    tx.onabort = tx.onerror = () => reject(failure || tx.error);
  })).catch((error) => {
    if (backedUp && !(error instanceof StorageConflictError)) return changes.length;
    for (const item of changes) if (equalState(settingViews.get(item.key), item.local)) settingViews.set(item.key, item.base);
    throw error;
  });
}

/** 存一张图片 Blob，返回它的 id（会话里只存 id，不存整个 Blob） */
export async function saveImageBlob(blob) {
  const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await putImage(id, blob);
  return id;
}

/** 取出图片并转成可直接塞进 <img src> 的 URL */
export async function imageUrl(id) {
  const row = await getImage(id);
  return row ? URL.createObjectURL(row.blob) : null;
}

/** 同 api.js：挂到 window 供原型的 app.js（普通脚本）调用 */
if (typeof window !== 'undefined') {
  window.ByCanvasDB = {
    putConversation, getConversation, listConversations, syncConversations, hasConversationChanges, deleteConversation,
    deletedExampleIds, storedConversationIds, clearExampleTombstones,
    listImageIds, deleteImages, putImage, getImage, deleteImage, saveImageBlob, imageUrl,
    getSetting, setSetting, setSettings, deleteSetting, hasSettingChanges, readSnapshot, rememberSnapshot,
  };
}
