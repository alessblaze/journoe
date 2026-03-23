import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { api, ApiError } from '../api';
import { cryptoService } from '../crypto';
import sseService, { SSEEvent } from '../sse';
import CreateEntry from './CreateEntry';
import ViewEntry from './ViewEntry';
import Settings from './Settings';
import AdminPanel from './AdminPanel';
import Modal from './Modal';
import { useToast } from '../ToastContext';
import { Entry } from '../types';
import { extractDisplayHtml } from './LexicalEditor';

const METRO_COLORS = [
  'bg-[#0078D7]', // Blue
  'bg-[#D83B01]', // Orange
  'bg-[#00A300]', // Green
  'bg-[#E81123]', // Red
  'bg-[#8C0095]', // Purple
  'bg-[#FFB900]', // Yellow
  'bg-[#00CC6A]', // Light Green
  'bg-[#00B7C3]', // Cyan
  'bg-[#FF8C00]', // Dark Orange
];

const getMetroColor = (id: string | number) => {
  const str = String(id);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return METRO_COLORS[Math.abs(hash) % METRO_COLORS.length];
};

const Dashboard = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteEntryId, setDeleteEntryId] = useState<string | number | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => (localStorage.getItem('viewMode') as 'grid' | 'list') || 'grid');

  const autosaveMetaRef = useRef<{ id: string | number, version: number } | null>(null);
  // Ref mirrors editingEntry.version as the single source of truth for the editing version.
  // Unlike React state, a ref update is synchronous and visible immediately inside closures,
  // so inflight autosaves never send a stale version even if state hasn't re-rendered yet.
  const editVersionRef = useRef<number | null>(null);
  const editIdRef = useRef<string | number | null>(null);

  // Serialization locks to prevent rapid typing from firing overlapping autosaves
  // which causes 409 Conflicts by reusing stale version refs.
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<{
    action: 'create' | 'edit';
    title: string;
    content: string;
    mood?: string;
    isAutoSave: boolean;
    resolve: () => void;
    reject: (error: any) => void;
  } | null>(null);

  const { user, encryptionKey, logout } = useAuth();
  const { showWarning } = useToast();

  useEffect(() => {
    localStorage.setItem('viewMode', viewMode);
  }, [viewMode]);

  // Keep refs in sync with editingEntry state.
  // This is the only place the refs are set from state — all other updates go ref-first.
  useEffect(() => {
    editVersionRef.current = editingEntry?.version ?? null;
    editIdRef.current = editingEntry?.id ?? null;
  }, [editingEntry]);

  useEffect(() => {
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encryptionKey]);

  useEffect(() => {
    if (!encryptionKey) {
      return;
    }

    sseService.connect();
    sseService.setDeadConnectionHandler((reason) => {
      if (reason === 'auth_revoked') {
        showWarning('Session revoked securely by another device. Logging out.');
        logout();
      } else {
        showWarning('Live sync disconnected. Refresh the page to restore real-time updates.');
      }
    });

    const handleCreated = async (event: SSEEvent) => {
      try {
        const key = await cryptoService.importKey(encryptionKey);
        const updatedEntry = event.data as Entry;
        const decryptedContent = await cryptoService.decrypt(updatedEntry.content, key);
        const decryptedTitle = updatedEntry.title ? await cryptoService.decrypt(updatedEntry.title, key) : '';
        const decryptedMood = updatedEntry.mood ? await cryptoService.decrypt(updatedEntry.mood, key) : '';
        const entryWithDecryptedData = {
          ...updatedEntry,
          content: decryptedContent,
          title: decryptedTitle || 'Untitled',
          mood: decryptedMood,
          is_sticky: updatedEntry.is_sticky,
        };

        setEntries(prev => {
          if (prev.some(entry => entry.id === updatedEntry.id)) {
            return prev;
          }
          return [entryWithDecryptedData, ...prev];
        });
      } catch { }
    };

    const handleUpdated = async (event: SSEEvent) => {
      try {
        const key = await cryptoService.importKey(encryptionKey);
        const updatedEntry = event.data as Entry;
        const decryptedContent = await cryptoService.decrypt(updatedEntry.content, key);
        const decryptedTitle = updatedEntry.title ? await cryptoService.decrypt(updatedEntry.title, key) : '';
        const decryptedMood = updatedEntry.mood ? await cryptoService.decrypt(updatedEntry.mood, key) : '';
        const entryWithDecryptedData = {
          ...updatedEntry,
          content: decryptedContent,
          title: decryptedTitle || 'Untitled',
          mood: decryptedMood,
          is_sticky: updatedEntry.is_sticky,
        };

        setEntries(prev => prev.map(entry => entry.id === updatedEntry.id ? entryWithDecryptedData : entry));
        setSelectedEntry(prev => prev?.id === updatedEntry.id ? entryWithDecryptedData : prev);

        // If this entry is NOT being actively edited, sync the list card only.
        // If it IS open in the editor, we delay the version check by 1000ms before warning.
        // Why? Because the server broadcasts SSEs to ALL connected clients, including us!
        // If the SSE beats the HTTP PUT response back to this browser by a few milliseconds,
        // we would incorrectly think "another browser" saved it and trigger a false-positive toast.
        // A 1-second delay ensures our own local save promise resolves and updates the refs first.
        setTimeout(() => {
          if (String(editIdRef.current) === String(updatedEntry.id)) {
            if (editVersionRef.current !== null && updatedEntry.version > editVersionRef.current) {
              showWarning('Another browser saved a newer version of this entry. Your next save will fail to prevent overwriting their changes.');
            }
          }

          // Patch background shadow trackers for the CREATE autosave flow.
          if (autosaveMetaRef.current && String(autosaveMetaRef.current.id) === String(updatedEntry.id)) {
            if (updatedEntry.version > autosaveMetaRef.current.version) {
              showWarning('Another browser modified this new entry. Your next save will fail to prevent overwriting their changes.');
            }
          }
        }, 1000);
      } catch { }
    };

    const handleDeleted = (event: SSEEvent) => {
      const entryId = event.entry_id;
      setEntries(prev => prev.filter(entry => entry.id !== entryId));
      if (selectedEntry?.id === entryId) {
        setSelectedEntry(null);
      }
    };

    const unsubscribeCreated = sseService.on('created', handleCreated);
    const unsubscribeUpdated = sseService.on('updated', handleUpdated);
    const unsubscribeDeleted = sseService.on('deleted', handleDeleted);

    return () => {
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeDeleted();
      sseService.disconnect();
    };
  }, [encryptionKey]);

  // Detect if the encryption key was reset on another device/browser (staleness check)
  useEffect(() => {
    if (!encryptionKey) return;

    const checkKeyFreshness = async () => {
      try {
        const { key_fingerprint: serverFP } = await api.user.getKeyFingerprint();
        if (!serverFP) return; // No fingerprint stored yet — legacy account, skip
        const localFP = await cryptoService.fingerprint(encryptionKey);
        if (localFP !== serverFP) {
          // Key on server changed — another device generated a new key.
          // Call handleLogout() directly: it clears both encryptionKey AND user atomically
          // so the router navigates to the full email/password login screen immediately.
          showWarning('Your encryption key was reset on another device. Please log in again and enter the new key.');
          handleLogout();
        }
      } catch {
        // Network error or server unreachable — do nothing, keep session alive
      }
    };

    const handleFocus = () => checkKeyFreshness();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkKeyFreshness();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encryptionKey]);

  const loadLatestEncryptedEntry = async (entryId: string | number): Promise<Entry | null> => {
    if (!encryptionKey) {
      return null;
    }

    const encryptedEntry = await api.entries.get(entryId);
    const key = await cryptoService.importKey(encryptionKey);
    const decryptedContent = await cryptoService.decrypt(encryptedEntry.content, key);
    const decryptedTitle = encryptedEntry.title ? await cryptoService.decrypt(encryptedEntry.title, key) : '';
    const decryptedMood = encryptedEntry.mood ? await cryptoService.decrypt(encryptedEntry.mood, key) : '';

    return {
      ...encryptedEntry,
      content: decryptedContent,
      title: decryptedTitle || 'Untitled',
      mood: decryptedMood,
      is_sticky: encryptedEntry.is_sticky,
    };
  };

  const loadEntries = async () => {
    try {
      setLoading(true);
      if (!encryptionKey) {
        setError('Encryption key not found. Click Settings to regenerate a new key or logout to enter your key.');
        return;
      }

      const key = await cryptoService.importKey(encryptionKey);
      const encryptedEntries = await api.entries.list();

      const decryptedEntries = await Promise.all(
        encryptedEntries.map(async (entry) => {
          try {
            const decryptedContent = await cryptoService.decrypt(entry.content, key);
            const decryptedTitle = entry.title ? await cryptoService.decrypt(entry.title, key) : '';
            const decryptedMood = entry.mood ? await cryptoService.decrypt(entry.mood, key) : '';
            return {
              ...entry,
              content: decryptedContent,
              title: decryptedTitle || 'Untitled',
              mood: decryptedMood,
              is_sticky: entry.is_sticky,
            };
          } catch {
            return {
              ...entry,
              content: 'Unable to decrypt - check your encryption key',
              title: 'Encrypted Entry',
            };
          }
        })
      );

      setEntries(decryptedEntries);
    } catch (error: any) {
      setError('Failed to load entries: ' + error.message);
    } finally {
      setLoading(false);
    }
  };
  const processSaveQueue = async () => {
    if (isSavingRef.current || !queuedSaveRef.current) return;
    
    // Lock the saving state so concurrent saves are paused
    isSavingRef.current = true;
    
    // Pop the latest action from the queue
    const payload = queuedSaveRef.current;
    queuedSaveRef.current = null;
    
    try {
      if (payload.action === 'create') {
        await executeHandleCreate(payload.title, payload.content, payload.mood, payload.isAutoSave);
      } else {
        await executeHandleEdit(payload.title, payload.content, payload.mood, payload.isAutoSave);
      }
      payload.resolve();
    } catch (err) {
      payload.reject(err);
    } finally {
      // Unlock the saving state
      isSavingRef.current = false;
      // If the user kept typing and queued another save while we were uploading, process it now!
      if (queuedSaveRef.current) {
        processSaveQueue();
      }
    }
  };

  const handleCreate = (title: string, content: string, mood?: string, isAutoSave: boolean = false) => {
    return new Promise<void>((resolve, reject) => {
      if (queuedSaveRef.current) {
        queuedSaveRef.current.reject(new Error("Superseded by newer save"));
      }
      queuedSaveRef.current = { action: 'create', title, content, mood, isAutoSave, resolve, reject };
      processSaveQueue();
    });
  };

  const handleEdit = (title: string, content: string, mood?: string, isAutoSave: boolean = false) => {
    return new Promise<void>((resolve, reject) => {
      if (queuedSaveRef.current) {
        queuedSaveRef.current.reject(new Error("Superseded by newer save"));
      }
      queuedSaveRef.current = { action: 'edit', title, content, mood, isAutoSave, resolve, reject };
      processSaveQueue();
    });
  };

  const executeHandleCreate = async (title: string, content: string, mood?: string, isAutoSave: boolean = false) => {
    setCreating(true);
    if (!encryptionKey) {
      setError('Encryption key not found. Please set it in Settings.');
      setCreating(false);
      return;
    }
    try {
      const key = await cryptoService.importKey(encryptionKey);
      const encryptedContent = await cryptoService.encrypt(content, key);
      const encryptedTitle = title ? await cryptoService.encrypt(title, key) : '';
      const encryptedMood = mood ? await cryptoService.encrypt(mood, key) : '';

      if (autosaveMetaRef.current) {
        // Technically an update under the hood since it already autosaved.
        const updatedEntry = await api.entries.update(
          autosaveMetaRef.current.id,
          encryptedTitle,
          encryptedContent,
          autosaveMetaRef.current.version,
          encryptedMood,
          false
        );
        autosaveMetaRef.current = { id: updatedEntry.id, version: updatedEntry.version };
        if (!isAutoSave) {
          setShowCreate(false);
          autosaveMetaRef.current = null;
        }
      } else {
        const newEntry = await api.entries.create(encryptedTitle, encryptedContent, encryptedMood, false);
        if (isAutoSave) {
          autosaveMetaRef.current = { id: newEntry.id, version: newEntry.version };
        } else {
          setShowCreate(false);
          autosaveMetaRef.current = null;
        }
      }
    } catch (error: any) {
      setError('Failed to create entry: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  const executeHandleEdit = async (title: string, content: string, mood?: string, isAutoSave: boolean = false) => {
    setCreating(true);
    if (!editingEntry) return;
    if (!encryptionKey) {
      setError('Encryption key not found. Please set it in Settings.');
      setCreating(false);
      return;
    }
    try {
      const key = await cryptoService.importKey(encryptionKey);
      const encryptedContent = await cryptoService.encrypt(content, key);
      const encryptedTitle = title ? await cryptoService.encrypt(title, key) : '';
      const encryptedMood = mood ? await cryptoService.encrypt(mood, key) : '';

      const versionToSend = editVersionRef.current ?? editingEntry.version;
      const updatedEntry = await api.entries.update(editingEntry.id, encryptedTitle, encryptedContent, versionToSend, encryptedMood, editingEntry.is_sticky);
      const updated: Entry = {
        ...editingEntry,
        title: title || 'Untitled',
        content,
        mood,
        is_sticky: updatedEntry.is_sticky,
        version: updatedEntry.version,
        updated_at: updatedEntry.updated_at,
      };

      setEntries(prev => prev.map(e => e.id === editingEntry.id ? updated : e));
      setSelectedEntry(prev => prev?.id === editingEntry.id ? updated : prev);

      if (!isAutoSave) {
        setEditingEntry(null);
        editVersionRef.current = null;
      } else {
        editVersionRef.current = updatedEntry.version;
        setEditingEntry(updated);
      }
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latestEntry = await loadLatestEncryptedEntry(editingEntry.id);
          if (latestEntry) {
            editVersionRef.current = latestEntry.version;
            setEntries(prev => prev.map(e => e.id === latestEntry.id ? latestEntry : e));
            setSelectedEntry(prev => prev?.id === latestEntry.id ? latestEntry : prev);
            setEditingEntry(latestEntry);
          }
          setError('This entry changed elsewhere, so the latest version was loaded. Review it and re-apply your edits before saving again.');
        } catch {
          setError(error.message);
        }
      } else {
        setError('Failed to update entry: ' + error.message);
      }
    } finally {
      setCreating(false);
    }
  };

  const togglePin = async (e: React.MouseEvent, entry: Entry) => {
    e.stopPropagation();
    if (!encryptionKey) return;
    try {
      const key = await cryptoService.importKey(encryptionKey);
      const encryptedContent = await cryptoService.encrypt(entry.content, key);
      const encryptedTitle = entry.title ? await cryptoService.encrypt(entry.title, key) : '';
      const encryptedMood = entry.mood ? await cryptoService.encrypt(entry.mood, key) : '';

      const updatedEntry = await api.entries.update(
        entry.id,
        encryptedTitle,
        encryptedContent,
        entry.version,
        encryptedMood,
        !entry.is_sticky
      );

      const pinnedEntry: Entry = {
        ...entry,
        is_sticky: updatedEntry.is_sticky,
        version: updatedEntry.version,
        updated_at: updatedEntry.updated_at,
      };

      setEntries(prev => prev.map(e => e.id === entry.id ? pinnedEntry : e));
      setSelectedEntry(prev => prev?.id === entry.id ? pinnedEntry : prev);
      setEditingEntry(prev => prev?.id === entry.id ? { ...prev, is_sticky: pinnedEntry.is_sticky, version: pinnedEntry.version, updated_at: pinnedEntry.updated_at } : prev);
      if (editIdRef.current === entry.id) {
        editVersionRef.current = pinnedEntry.version;
      }
    } catch (error: any) {
      setError('Failed to pin entry: ' + error.message);
    }
  };

  const handleDelete = async (id: string | number) => {
    setDeleteEntryId(id);
  };

  const confirmDelete = async () => {
    if (!deleteEntryId) return;

    try {
      await api.entries.delete(deleteEntryId);
      setEntries(prev => prev.filter(entry => entry.id !== deleteEntryId));
      if (selectedEntry?.id === deleteEntryId) {
        setSelectedEntry(null);
      }
      setDeleteEntryId(null);
    } catch (error: any) {
      setError('Failed to delete entry: ' + error.message);
      setDeleteEntryId(null);
    }
  };

  const handleLogout = () => {
    sseService.disconnect();
    logout();
  };

  return (
    <div className="min-h-screen font-sans flex flex-col overflow-x-hidden">
      <header className="max-w-7xl mx-auto px-6 sm:px-8 w-full pt-8 sm:pt-12 pb-6 flex flex-col md:flex-row justify-between md:items-end gap-6">
        <div>
          <h1 className="text-5xl font-light tracking-tight text-white mb-2">
            Journal
          </h1>
          <p className="text-gray-400 font-semibold tracking-wide text-sm opacity-80">
            {entries.length === 0
              ? 'YOUR THOUGHTS COMPLETED'
              : `${entries.length} ${entries.length === 1 ? 'ENTRY' : 'ENTRIES'} SECURED`}
          </p>
        </div>
        <div className="flex flex-wrap gap-4 sm:gap-6 items-center">
          <button
            onClick={() => setViewMode(prev => prev === 'grid' ? 'list' : 'grid')}
            className="text-lg flex items-center gap-2 font-semibold text-gray-300 hover:text-white transition-colors"
            title="Toggle View Layout"
          >
            {viewMode === 'grid' ? (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                List
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                Grid
              </>
            )}
          </button>
          {user?.is_admin && (
            <button
              onClick={() => setShowAdminPanel(true)}
              className="text-lg font-bold text-[#0078D7] hover:text-white transition-colors"
            >
              Admin Panel
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="text-lg font-semibold text-gray-300 hover:text-white transition-colors"
          >
            Settings
          </button>
          <button
            onClick={handleLogout}
            className="text-lg font-semibold text-gray-300 hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 sm:px-8 pb-12 flex-1 w-full">
        {error && (
          <div className="bg-[#E81123] text-white p-6 mb-8 shadow-sm">
            <div className="flex items-start gap-4">
              <span className="text-2xl mt-1">⚠️</span>
              <div className="flex-1">
                <h3 className="font-bold text-lg mb-1 tracking-wide">ENCRYPTION ISSUE</h3>
                <p className="text-sm opacity-90">{error}</p>
              </div>
              <button onClick={() => setError('')} className="text-xl font-bold opacity-70 hover:opacity-100">×</button>
            </div>
            <div className="flex gap-4 mt-6">
              <button
                onClick={handleLogout}
                className="bg-white text-[#E81123] px-6 py-2 font-bold text-sm tracking-wide hover:bg-gray-100 transition-colors"
              >
                ENTER KEY
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="border-2 border-white text-white px-6 py-2 font-bold text-sm tracking-wide hover:bg-white/10 transition-colors"
              >
                REGENERATE KEY
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex gap-3 mt-12 mb-12">
            <div className="w-4 h-4 bg-[#0078D7] animate-bounce" style={{ animationDelay: '0s' }}></div>
            <div className="w-4 h-4 bg-[#0078D7] animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-4 h-4 bg-[#0078D7] animate-bounce" style={{ animationDelay: '0.4s' }}></div>
            <div className="w-4 h-4 bg-[#0078D7] animate-bounce" style={{ animationDelay: '0.6s' }}></div>
            <div className="w-4 h-4 bg-[#0078D7] animate-bounce" style={{ animationDelay: '0.8s' }}></div>
          </div>
        ) : (
          <>
            {showCreate && (
              <CreateEntry
                onClose={() => {
                  setShowCreate(false);
                  autosaveMetaRef.current = null;
                }}
                onSave={handleCreate}
                isLoading={creating}
              />
            )}

            {editingEntry && (
              <CreateEntry
                initialTitle={editingEntry.title === 'Untitled' ? '' : editingEntry.title}
                initialContent={editingEntry.content}
                initialMood={editingEntry.mood}
                onClose={() => setEditingEntry(null)}
                onSave={handleEdit}
                isLoading={creating}
              />
            )}

            {selectedEntry && (
              <ViewEntry
                entry={selectedEntry}
                onClose={() => setSelectedEntry(null)}
                onEdit={() => {
                  setEditingEntry(selectedEntry);
                  setSelectedEntry(null);
                }}
              />
            )}

            {showSettings && (
              <Settings onClose={() => setShowSettings(false)} />
            )}

            {showAdminPanel && (
              <AdminPanel onClose={() => setShowAdminPanel(false)} />
            )}

            {/* Split logic */}
            {(() => {
              const pinnedEntries = entries.filter(e => e.is_sticky);
              const regularEntries = entries.filter(e => !e.is_sticky);
              const gridClass = viewMode === 'grid'
                ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 auto-rows-[200px]"
                : "flex flex-col gap-2";

              const renderEntryCard = (entry: Entry) => {
                const tileColor = getMetroColor(entry.id);
                return (
                  <div
                    key={entry.id}
                    className={`${tileColor} p-4 sm:p-5 flex flex-col justify-between text-white cursor-pointer hover:opacity-90 transition-opacity relative group overflow-hidden shadow-sm ${viewMode === 'list' ? 'min-h-[140px]' : ''}`}
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <div className="mb-2 z-10 w-full pr-10 sm:pr-12 break-words">
                      <h3 className="font-semibold text-base sm:text-lg leading-tight mb-2 line-clamp-2">
                        {entry.title}
                      </h3>
                      {entry.mood && (
                        <div className="mb-3">
                          <span className="text-xs bg-black/20 px-2.5 py-1 rounded-sm font-medium tracking-wide whitespace-nowrap inline-block">
                            {entry.mood}
                          </span>
                        </div>
                      )}
                      <p className="text-xs font-semibold tracking-wider opacity-75 mb-2">
                        {new Date(entry.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric'
                        }).toUpperCase()}
                      </p>
                      <p className="text-sm opacity-90 line-clamp-2 leading-snug font-light">
                        {new DOMParser().parseFromString(extractDisplayHtml(entry.content), 'text/html').body.textContent || ''}
                      </p>
                    </div>

                    <div className="absolute top-0 right-0 p-1 flex items-center opacity-0 group-hover:opacity-100 transition-all z-20">
                      <button
                        onClick={(e) => togglePin(e, entry)}
                        className={`p-2 pb-0 text-white hover:bg-black/20 ${entry.is_sticky ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                        title={entry.is_sticky ? "Unpin entry" : "Pin entry"}
                      >
                        📌
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(entry.id);
                        }}
                        className="p-3 pb-0 text-white/50 hover:text-white hover:bg-black/20"
                        title="Delete entry"
                      >
                        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <span className="absolute -bottom-4 -right-4 text-6xl opacity-10 pointer-events-none">📝</span>
                  </div>
                );
              };

              return (
                <div className="flex flex-col gap-6">
                  {pinnedEntries.length > 0 && (
                    <div className="mb-4">
                      <h2 className="text-sm font-bold text-zinc-500 tracking-widest mb-4 uppercase flex items-center gap-2">
                        <span>📌 Pinned</span>
                        <div className="h-px bg-zinc-800 flex-1 ml-4 mt-1"></div>
                      </h2>
                      <div className={gridClass}>
                        {pinnedEntries.map(entry => renderEntryCard(entry))}
                      </div>
                    </div>
                  )}

                  <div>
                    {pinnedEntries.length > 0 && (
                      <h2 className="text-sm font-bold text-zinc-500 tracking-widest mb-4 uppercase flex items-center gap-2">
                        <span>📝 All Entries</span>
                        <div className="h-px bg-zinc-800 flex-1 ml-4 mt-1"></div>
                      </h2>
                    )}
                    <div className={gridClass}>
                      <button
                        onClick={() => setShowCreate(true)}
                        className="bg-zinc-800 hover:bg-zinc-700 flex flex-col items-center justify-center p-6 text-white transition-colors relative group min-h-[200px]"
                      >
                        <div className="w-full h-full border-2 border-dashed border-zinc-600 group-hover:border-zinc-500 flex flex-col items-center justify-center p-4">
                          <span className="text-5xl font-light mb-2">+</span>
                          <span className="font-bold text-xs tracking-widest text-zinc-400 group-hover:text-zinc-300">NEW ENTRY</span>
                        </div>
                      </button>

                      {regularEntries.map(entry => renderEntryCard(entry))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </main>

      <Modal
        isOpen={deleteEntryId !== null}
        onClose={() => setDeleteEntryId(null)}
        onConfirm={confirmDelete}
        title="Delete Entry"
        message="Are you sure you want to delete this entry?"
        confirmText="DELETE"
        cancelText="CANCEL"
        type="danger"
      />

      <footer className="w-full text-center py-8 mt-auto text-zinc-600 font-bold tracking-widest text-xs uppercase select-none cursor-default">
        from aless with love.
      </footer>
    </div>
  );
};

export default Dashboard;
