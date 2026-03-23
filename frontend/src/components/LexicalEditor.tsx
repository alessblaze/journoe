import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $getRoot, $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND, EditorState } from 'lexical';
import { $patchStyleText, $getSelectionStyleValueForProperty } from '@lexical/selection';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { LexicalEditor as LexicalEditorInstance } from 'lexical';

const theme = {
  text: {
    bold: 'font-bold font-semibold text-white',
    italic: 'italic font-serif',
    underline: 'underline decoration-zinc-500 underline-offset-4',
  },
  paragraph: 'mb-1.5',
};

/** 
 * Dual payload format:
 * When saving we store BOTH the Lexical JSON state (for editor restoration)
 * AND the rendered HTML (for ViewEntry display).
 * 
 * Format: {"v":2,"state":"<lexical-json>","html":"<rendered-html>","spacing":"leading-snug"}
 * Legacy format (v1): raw HTML string, possibly wrapped in a journal-spacing/journal-wrapper div.
 */

type Payload = {
  v: 2;
  state: string;  // Lexical EditorState JSON
  html: string;   // Rendered HTML for ViewEntry
  spacing: string;
};

const isPayloadV2 = (raw: string): boolean => {
  try {
    const obj = JSON.parse(raw);
    return obj && obj.v === 2;
  } catch {
    return false;
  }
};

const parsePayload = (raw: string): Payload | null => {
  try {
    return JSON.parse(raw) as Payload;
  } catch {
    return null;
  }
};

// For legacy HTML-only entries: extract inner HTML from the wrapper div
const extractLegacyHtml = (rawHtml: string): string => {
  let clean = rawHtml;
  if (rawHtml.startsWith('<div class="journal-wrapper')) {
    clean = rawHtml.replace(/^<div class="journal-wrapper[^>]+>/, '').replace(/<\/div>$/, '');
  } else if (rawHtml.startsWith('<div class="journal-spacing')) {
    clean = rawHtml.replace(/^<div class="journal-spacing[^>]+>/, '').replace(/<\/div>$/, '');
  }
  return clean;
};

const extractSpacingFromLegacy = (raw: string): string => {
  const match = raw.match(/data-spacing="([^"]+)"/) || raw.match(/^<div class="journal-spacing ([^"]+)">/);
  return match?.[1] || 'leading-snug';
};

// Build the serialized payload to encrypt and store
const buildPayload = (editorState: EditorState, editor: LexicalEditorInstance, spacing: string): string => {
  const html = editorState.read(() => $generateHtmlFromNodes(editor, null));
  const state = JSON.stringify(editorState.toJSON());
  const payload: Payload = { v: 2, state, html, spacing };
  return JSON.stringify(payload);
};

// ──────────────────────────────────────────────────────────────
// Helper to extract JUST the html string for ViewEntry rendering.
// Exported so ViewEntry can call it instead of rendering raw content.
// ──────────────────────────────────────────────────────────────
export const extractDisplayHtml = (raw: string): string => {
  if (!raw) return '';
  if (isPayloadV2(raw)) {
    const p = parsePayload(raw);
    return p?.html ?? '';
  }
  // Legacy: the raw string IS html
  return raw;
};

export const extractDisplaySpacing = (raw: string): string => {
  if (!raw) return 'leading-snug';
  if (isPayloadV2(raw)) {
    const p = parsePayload(raw);
    return p?.spacing ?? 'leading-snug';
  }
  return extractSpacingFromLegacy(raw);
};

// ──────────────────────────────────────────────────────────────
// Plugins
// ──────────────────────────────────────────────────────────────

function EditorSyncPlugin({
  onChange,
  spacing,
  externalStateJson,
}: {
  onChange: (payload: string) => void;
  spacing: string;
  externalStateJson?: string;
}) {
  const [editor] = useLexicalComposerContext();

  // Broadcast full dual-payload on every edit
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      editorState.read(() => {
        const text = $getRoot().getTextContent().trim();
        if (text !== '') {
          onChange(buildPayload(editorState, editor, spacing));
        } else {
          onChange('');
        }
      });
    });
  }, [editor, onChange, spacing]);

  // Re-broadcast when spacing changes (toolbar-only change)
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    editor.getEditorState().read(() => {
      const text = $getRoot().getTextContent().trim();
      if (text) onChange(buildPayload(editor.getEditorState(), editor, spacing));
    });
  }, [spacing, editor, onChange]);

  // Remote-tab SSE sync: push a fresh JSON state from the other tab
  const prevExternalRef = useRef(externalStateJson);
  useEffect(() => {
    if (!externalStateJson || externalStateJson === prevExternalRef.current) return;
    prevExternalRef.current = externalStateJson;
    try {
      const newState = editor.parseEditorState(externalStateJson);
      const currentJson = JSON.stringify(editor.getEditorState().toJSON());
      const incomingJson = JSON.stringify(newState.toJSON());
      if (incomingJson !== currentJson) {
        editor.setEditorState(newState);
      }
    } catch {
      // Ignore malformed state
    }
  }, [externalStateJson, editor]);

  return null;
}

function ToolbarPlugin({ spacing, setSpacing }: { spacing: string; setSpacing: (s: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [fontFamily, setFontFamily] = useState('sans-serif');
  const [fontSize, setFontSize] = useState('18px');

  const fontMap: Record<string, string> = {
    'sans-serif': 'ui-sans-serif, system-ui, sans-serif',
    'serif': 'ui-serif, Georgia, serif',
    'monospace': 'ui-monospace, SFMono-Regular, monospace',
  };

  const reverseFontMap = Object.fromEntries(Object.entries(fontMap).map(([k, v]) => [v, k]));

  const updateToolbar = useCallback(() => {
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      setIsBold(sel.hasFormat('bold'));
      setIsItalic(sel.hasFormat('italic'));
      setIsUnderline(sel.hasFormat('underline'));
      const rawFont = $getSelectionStyleValueForProperty(sel, 'font-family', 'ui-sans-serif, system-ui, sans-serif');
      setFontFamily(reverseFontMap[rawFont] ?? 'sans-serif');
      setFontSize($getSelectionStyleValueForProperty(sel, 'font-size', '18px'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => editor.registerUpdateListener(({ editorState }) => editorState.read(updateToolbar)), [editor, updateToolbar]);

  const applyStyle = useCallback((styles: Record<string, string>) => {
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) $patchStyleText(sel, styles);
    });
  }, [editor]);

  return (
    <div className="flex flex-wrap gap-4 mb-4 pb-4 border-b-2 border-zinc-800 items-center justify-between">
      <div className="flex gap-2">
        {[
          { label: 'Bold', cmd: 'bold' as const, active: isBold, cls: 'font-bold' },
          { label: 'Italic', cmd: 'italic' as const, active: isItalic, cls: 'italic' },
          { label: 'Underline', cmd: 'underline' as const, active: isUnderline, cls: 'underline' },
        ].map(({ label, cmd, active, cls }) => (
          <button
            key={cmd}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { editor.focus(); editor.dispatchCommand(FORMAT_TEXT_COMMAND, cmd); }}
            className={`px-4 py-2 text-white tracking-widest uppercase transition-colors text-xs ${cls} ${active ? 'bg-[#0078D7]' : 'bg-zinc-800 hover:bg-zinc-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={fontFamily}
          onChange={(e) => { setFontFamily(e.target.value); applyStyle({ 'font-family': fontMap[e.target.value] }); }}
          className="bg-zinc-800 text-zinc-300 px-3 py-2 text-xs font-bold tracking-wider uppercase outline-none focus:ring-1 focus:ring-[#0078D7] cursor-pointer"
        >
          <option value="sans-serif">Sans Serif</option>
          <option value="serif">Serif</option>
          <option value="monospace">Monospace</option>
        </select>

        <select
          value={fontSize}
          onChange={(e) => { setFontSize(e.target.value); applyStyle({ 'font-size': e.target.value }); }}
          className="bg-zinc-800 text-zinc-300 px-3 py-2 text-xs font-bold tracking-wider uppercase outline-none focus:ring-1 focus:ring-[#0078D7] cursor-pointer"
        >
          <option value="14px">Small</option>
          <option value="18px">Normal</option>
          <option value="24px">Large</option>
          <option value="32px">X-Large</option>
        </select>

        <select
          value={spacing}
          onChange={(e) => setSpacing(e.target.value)}
          className="bg-zinc-800 text-zinc-300 px-3 py-2 text-xs font-bold tracking-wider uppercase outline-none focus:ring-1 focus:ring-[#0078D7] cursor-pointer"
        >
          <option value="leading-none">No Space</option>
          <option value="leading-tight">Tight</option>
          <option value="leading-snug">Snug</option>
          <option value="leading-normal">Normal</option>
        </select>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main export
// ──────────────────────────────────────────────────────────────

export default function LexicalEditor({
  content,
  externalContent,
  onChange,
}: {
  content?: string;
  externalContent?: string;
  onChange: (val: string) => void;
}) {
  const [spacing, setSpacing] = useState(() => extractDisplaySpacing(content ?? ''));

  // Extract the Lexical JSON state from externalContent to pass to EditorSyncPlugin
  const externalStateJson = (() => {
    if (!externalContent) return undefined;
    if (isPayloadV2(externalContent)) return parsePayload(externalContent)?.state;
    return undefined;
  })();

  const initialConfig = {
    namespace: 'JournalEditor',
    theme,
    onError: (error: Error) => console.error('Lexical Error:', error),
    editorState: content
      ? (editor: LexicalEditorInstance) => {
          if (isPayloadV2(content)) {
            // V2: restore from stored Lexical JSON state — perfect round-trip
            const p = parsePayload(content)!;
            const restoredState = editor.parseEditorState(p.state);
            editor.setEditorState(restoredState);
          } else {
            // Legacy v1: fall back to HTML parsing
            const cleanHtml = extractLegacyHtml(content);
            const parser = new DOMParser();
            const dom = parser.parseFromString(cleanHtml, 'text/html');
            const nodes = $generateNodesFromDOM(editor, dom);
            $getRoot().clear().append(...nodes);
          }
        }
      : undefined,
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative w-full bg-zinc-900 border-2 border-transparent border-b-zinc-700 focus-within:border-b-[#0078D7] transition-colors flex flex-col p-4 md:p-6 min-h-[300px]">
        <ToolbarPlugin spacing={spacing} setSpacing={setSpacing} />
        <div className={`relative flex-1 ${spacing}`}>
          <RichTextPlugin
            contentEditable={<ContentEditable className="outline-none h-full min-h-[200px] text-white relative z-10 text-[18px]" />}
            placeholder={<div className="absolute top-0 left-0 text-zinc-600 pointer-events-none text-[18px]">Write your encrypted journal entry here...</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <EditorSyncPlugin onChange={onChange} spacing={spacing} externalStateJson={externalStateJson} />
      </div>
    </LexicalComposer>
  );
}
