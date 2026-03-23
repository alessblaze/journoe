interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

const Modal = ({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', cancelText = 'Cancel', type = 'info' }: ModalProps) => {
  if (!isOpen) return null;

  const typeStyles = {
    danger: {
      accent: 'bg-[#E81123]',
      label: 'CRITICAL ACTION',
      confirm: 'bg-[#E81123] hover:bg-[#c50f1f] text-white',
      labelText: 'text-[#E81123]',
    },
    warning: {
      accent: 'bg-[#FFB900]',
      label: 'ATTENTION REQUIRED',
      confirm: 'bg-[#FFB900] hover:bg-[#e5a600] text-black',
      labelText: 'text-[#FFB900]',
    },
    info: {
      accent: 'bg-[#0078D7]',
      label: 'SYSTEM PROMPT',
      confirm: 'bg-[#0078D7] hover:bg-[#005a9e] text-white',
      labelText: 'text-[#0078D7]',
    },
  };
  const activeStyle = typeStyles[type];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 font-sans">
      <div className="w-full max-w-xl border-2 border-zinc-800 bg-[#111] shadow-2xl animate-fade-in">
        <div className={`h-2 w-full ${activeStyle.accent}`}></div>
        <div className="p-6 md:p-8">
          <p className={`mb-3 text-xs font-bold tracking-[0.28em] uppercase ${activeStyle.labelText}`}>
            {activeStyle.label}
          </p>
          <h3 className="mb-4 text-2xl md:text-3xl font-light tracking-tight text-white">{title}</h3>
          <p className="mb-8 text-base md:text-lg leading-relaxed text-zinc-300">{message}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={onConfirm}
              className={`flex-1 px-4 py-3.5 text-sm font-bold tracking-[0.22em] uppercase transition-colors ${activeStyle.confirm}`}
            >
              {confirmText}
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-zinc-800 px-4 py-3.5 text-sm font-bold tracking-[0.22em] uppercase text-white transition-colors hover:bg-zinc-700"
            >
              {cancelText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
