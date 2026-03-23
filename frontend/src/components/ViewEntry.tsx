import { Entry } from '../types';
import DOMPurify from 'dompurify';
import { extractDisplayHtml } from './LexicalEditor';

const ViewEntry = ({ entry, onClose, onEdit }: { entry: Entry; onClose: () => void; onEdit?: () => void }) => {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-[#111] w-full max-w-4xl min-h-[80vh] flex flex-col my-8 animate-fade-in shadow-2xl relative border-2 border-zinc-800">
        <button
          onClick={onClose}
          className="absolute top-0 right-0 text-zinc-500 hover:text-white hover:bg-[#E81123] p-4 transition-colors"
          title="Close"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-12 md:p-16 flex-1 flex flex-col">
          <div className="mb-12">
            <h2 className="text-5xl font-light text-white break-words mb-4 leading-tight">{entry.title}</h2>
            
            {entry.mood && (
              <div className="mb-6 inline-flex text-white bg-zinc-800/80 px-4 py-1.5 rounded-full text-sm font-medium border border-zinc-700/50 items-center gap-2 shadow-sm">
                <span className="text-zinc-400 text-xs tracking-widest font-bold">MOOD:</span>
                <span className="text-base whitespace-nowrap">{entry.mood}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-6 text-sm font-semibold tracking-wider text-zinc-400 uppercase">
              <div>
                {new Date(entry.created_at).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit'
                })}
              </div>
              {entry.updated_at !== entry.created_at && (
                <div className="text-[#0078D7]">
                  UPDATED: {new Date(entry.updated_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1">
            <div 
              className="text-zinc-300 leading-snug"
              style={{ wordBreak: 'break-word' }}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(extractDisplayHtml(entry.content), { ADD_ATTR: ['style'] }) }}
            />
          </div>
        </div>

        <div className="p-8 bg-zinc-900 border-t border-zinc-800 flex justify-end gap-4">
          {onEdit && (
            <button
              onClick={onEdit}
              className="bg-[#0078D7] text-white px-8 py-4 hover:bg-[#005a9e] transition-colors font-bold tracking-widest uppercase text-sm"
            >
              EDIT ENTRY
            </button>
          )}
          <button
            onClick={onClose}
            className="bg-zinc-800 text-white px-8 py-4 hover:bg-zinc-700 transition-colors font-bold tracking-widest uppercase text-sm"
          >
            CLOSE READER
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewEntry;
