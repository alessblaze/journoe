const DB_NAME = 'journal-secure-storage';
const DB_VERSION = 1;
const STORE_NAME = 'wrapped_keys';
const WRAPPED_KEY_ID = 'journal-key';

interface WrappedKeyRecord {
  id: string;
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deriveWrappingKey(password: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password) as Uint8Array<ArrayBuffer>,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 250000,
      hash: 'SHA-256',
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    usages
  );
}



async function wrapKeyForPassword(keyHex: string, password: string): Promise<WrappedKeyRecord> {
  const encoder = new TextEncoder();
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(password, salt, ['encrypt']);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    encoder.encode(keyHex)
  );

  return {
    id: WRAPPED_KEY_ID,
    version: DB_VERSION,
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(ciphertext),
  };
}

async function saveWrappedRecord(record: WrappedKeyRecord): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save wrapped key'));
    tx.onabort = () => reject(tx.error ?? new Error('Failed to save wrapped key'));
  });
  db.close();
}

async function getWrappedRecord(): Promise<WrappedKeyRecord | null> {
  const db = await openDB();
  const record = await new Promise<WrappedKeyRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(WRAPPED_KEY_ID);

    request.onsuccess = () => resolve((request.result as WrappedKeyRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Failed to load wrapped key'));
  });
  db.close();
  return record;
}

export const keyStorage = {
  async storeWrappedKey(keyHex: string, password: string): Promise<void> {
    const record = await wrapKeyForPassword(keyHex, password);
    await saveWrappedRecord(record);
  },

  async verifyPasswordWrap(keyHex: string, password: string): Promise<void> {
    const record = await wrapKeyForPassword(keyHex, password);

    const salt = new Uint8Array(base64ToArrayBuffer(record.salt));
    const iv = new Uint8Array(base64ToArrayBuffer(record.iv));
    const ciphertext = base64ToArrayBuffer(record.ciphertext);
    const wrappingKey = await deriveWrappingKey(password, salt, ['decrypt']);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      wrappingKey,
      ciphertext
    );

    if (new TextDecoder().decode(decrypted) !== keyHex) {
      throw new Error('Failed to verify the local recovery key with the new password.');
    }
  },

  async unlockWrappedKey(password: string): Promise<string | null> {
    const record = await getWrappedRecord();
    if (!record) {
      return null;
    }

    try {
      const salt = new Uint8Array(base64ToArrayBuffer(record.salt));
      const iv = new Uint8Array(base64ToArrayBuffer(record.iv));
      const ciphertext = base64ToArrayBuffer(record.ciphertext);
      const wrappingKey = await deriveWrappingKey(password, salt, ['decrypt']);
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        wrappingKey,
        ciphertext
      );

      return new TextDecoder().decode(decrypted);
    } catch {
      return null;
    }
  },

  async hasWrappedKey(): Promise<boolean> {
    const record = await getWrappedRecord();
    return record !== null;
  },

  async clear(): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(WRAPPED_KEY_ID);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear wrapped key'));
      tx.onabort = () => reject(tx.error ?? new Error('Failed to clear wrapped key'));
    });
    db.close();
  },
};
