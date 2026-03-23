import { useState, useEffect, useRef } from 'react';
import LexicalEditor from './LexicalEditor';

interface CreateEntryProps {
  onClose: () => void;
  onSave: (title: string, content: string, mood?: string, isAutoSave?: boolean) => Promise<void>;
  isLoading: boolean;
  initialTitle?: string;
  initialContent?: string;
  initialMood?: string;
}

const CreateEntry = ({ onClose, onSave, isLoading, initialTitle = '', initialContent = '', initialMood = '' }: CreateEntryProps) => {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [mood, setMood] = useState(initialMood);
  const isEditing = !!initialContent;

  const previousInitialContent = useRef(initialContent);

  useEffect(() => {
      if (initialContent !== previousInitialContent.current) {
          // A remote tab sent an SSE autosave burst, overriding our local content props
          previousInitialContent.current = initialContent;
          setContent(initialContent);
          setTitle(initialTitle || 'Draft');
          setMood(initialMood);
      }
  }, [initialContent, initialTitle, initialMood]);

  const lastSavedContentLength = useRef(0);
  const typingTimer = useRef<NodeJS.Timeout | null>(null);
  const plainTextLengthCache = useRef<{ raw: string; length: number } | null>(null);
  const saveInFlightRef = useRef(false);
  const autosaveQueuedRef = useRef(false);
  const lastSavedSnapshotRef = useRef<string>('');
  const latestDraftRef = useRef({ title: initialTitle, content: initialContent, mood: initialMood });

  // Extract the actual text content regardless of whether it's v2 JSON or raw html.
  // Result is cached by raw content string to avoid a full HTML parse on every render.
  const getPlainTextLength = (raw: string): number => {
    if (!raw) return 0;
    if (plainTextLengthCache.current && plainTextLengthCache.current.raw === raw) {
      return plainTextLengthCache.current.length;
    }
    let length: number;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.v === 2 && parsed?.html) {
        length = new DOMParser().parseFromString(parsed.html, 'text/html').body.textContent?.length ?? 0;
      } else {
        length = new DOMParser().parseFromString(raw, 'text/html').body.textContent?.length ?? raw.length;
      }
    } catch {
      length = new DOMParser().parseFromString(raw, 'text/html').body.textContent?.length ?? raw.length;
    }
    plainTextLengthCache.current = { raw, length };
    return length;
  };


  useEffect(() => {
    latestDraftRef.current = { title, content, mood };
  }, [title, content, mood]);

  const saveDraft = async (isAutoSave: boolean) => {
    const draft = latestDraftRef.current;
    const safeTitle = draft.title.trim() || 'Draft';
    const snapshot = JSON.stringify({ title: safeTitle, content: draft.content, mood: draft.mood ?? '' });

    if (!draft.content.trim()) {
      return;
    }

    if (isAutoSave && lastSavedSnapshotRef.current === snapshot) {
      return;
    }

    if (saveInFlightRef.current) {
      if (isAutoSave) {
        autosaveQueuedRef.current = true;
      }
      return;
    }

    saveInFlightRef.current = true;
    try {
      await onSave(safeTitle, draft.content, draft.mood, isAutoSave);
      lastSavedSnapshotRef.current = snapshot;
      lastSavedContentLength.current = getPlainTextLength(draft.content);
      if (!draft.title.trim()) {
        setTitle('Draft');
      }
    } finally {
      saveInFlightRef.current = false;
      if (autosaveQueuedRef.current) {
        // A successful manual save supersedes any autosave that queued while it was in flight.
        // Replaying that queued autosave can resend a stale version after the editor closes.
        if (isAutoSave) {
          autosaveQueuedRef.current = false;
          void saveDraft(true);
        } else {
          autosaveQueuedRef.current = false;
        }
      }
    }
  };

  useEffect(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);

    if (content.trim()) {
      typingTimer.current = setTimeout(() => {
        if (!isLoading) {
          saveDraft(true).catch(console.error);
        }
      }, 60000); // 1 minute of inactivity
    }

    // Only trigger on real text changes, NOT formatting/font/size changes
    const currentTextLength = getPlainTextLength(content);
    const delta = Math.abs(currentTextLength - lastSavedContentLength.current);
    if (delta >= 20 && !isLoading) {
      saveDraft(true).catch(console.error);
    }

    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, mood, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    await saveDraft(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-[#111] w-full max-w-2xl max-h-[95vh] overflow-y-auto border-2 border-zinc-800 animate-fade-in shadow-2xl">
        <div className="flex justify-between items-start p-6 pb-4 md:p-8 md:pb-4">
          <h2 className="text-2xl md:text-4xl font-light text-white tracking-tight">
            {isEditing ? 'Edit Entry' : 'New Entry'}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white hover:bg-[#E81123] p-2 transition-colors ml-2"
          >
            <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-6 md:p-8 md:pt-4">
          <div>
            <label className="block text-zinc-400 text-xs md:text-sm font-semibold tracking-wider mb-2 uppercase">
              Title <span className="text-[#E81123]">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={4096}
              className="w-full px-4 py-3 bg-zinc-900 text-white border-2 border-transparent border-b-zinc-700 focus:outline-none focus:border-b-[#0078D7] focus:bg-zinc-800 transition-colors text-base md:text-lg"
              placeholder="Enter a title for your entry"
            />
          </div>

          <div>
            <label className="block text-zinc-400 text-xs md:text-sm font-semibold tracking-wider mb-2 uppercase">
              Content <span className="text-[#E81123]">*</span>
            </label>
            <LexicalEditor content={initialContent} externalContent={initialContent} onChange={(val) => setContent(val)} />
            <p className="text-xs text-zinc-500 mt-2 font-mono">
              ENCRYPTED LOCALLY VIA AES-256-GCM
            </p>
          </div>

          <div>
            <label className="block text-zinc-400 text-xs md:text-sm font-semibold tracking-wider mb-2 uppercase">
              Mood <span className="opacity-50">(Optional)</span>
            </label>
            <select
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              className="w-full px-4 py-3 bg-zinc-900 text-white border-2 border-transparent border-b-zinc-700 focus:outline-none focus:border-b-[#0078D7] focus:bg-zinc-800 transition-colors text-base md:text-lg appearance-none cursor-pointer"
            >
              <option value="">-- No Mood Selected --</option>
              <option value="Happy 😊">Happy 😊</option>
              <option value="Sad 😢">Sad 😢</option>
              <option value="Angry 😠">Angry 😠</option>
              <option value="Anxious 😰">Anxious 😰</option>
              <option value="Calm 😌">Calm 😌</option>
              <option value="Grateful 🙏">Grateful 🙏</option>
              <option value="Neutral 😐">Neutral 😐</option>
            </select>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 pt-6">
            <button
              type="submit"
              disabled={!content.trim() || isLoading}
              className="flex-1 bg-[#0078D7] text-white py-4 hover:bg-[#005a9e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold tracking-widest uppercase text-xs md:text-sm"
            >
              <span className="flex items-center justify-center gap-3">
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 bg-white animate-bounce"></div>
                    <span>SAVING...</span>
                  </>
                ) : (
                  <span>SAVE ENTRY</span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-zinc-800 text-white py-4 hover:bg-zinc-700 transition-colors font-bold tracking-widest uppercase text-xs md:text-sm"
            >
              CANCEL
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateEntry;
