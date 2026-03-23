import { createContext, useContext, useState, ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
  showError: (message: string, duration?: number) => void;
  showWarning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const showToast = (message: string, type: ToastType = 'info', duration: number = 3000) => {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Date.now().toString() + Math.random().toString(36).slice(2);
    const newToast: Toast = { id, type, message, duration };
    setToasts((prev) => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  };

  const showSuccess = (message: string, duration?: number) => showToast(message, 'success', duration);
  const showError = (message: string, duration?: number) => showToast(message, 'error', duration);
  const showWarning = (message: string, duration?: number) => showToast(message, 'warning', duration);

  const typeStyles = {
    success: {
      accent: 'bg-[#107C10]',
      label: 'SUCCESS',
      iconColor: 'text-[#107C10]',
    },
    error: {
      accent: 'bg-[#E81123]',
      label: 'ERROR',
      iconColor: 'text-[#E81123]',
    },
    warning: {
      accent: 'bg-[#FFB900]',
      label: 'WARNING',
      iconColor: 'text-[#FFB900]',
    },
    info: {
      accent: 'bg-[#0078D7]',
      label: 'NOTICE',
      iconColor: 'text-[#0078D7]',
    },
  };

  const typeIcons = {
    success: <svg className={`w-6 h-6 ${typeStyles.success.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
    error: <svg className={`w-6 h-6 ${typeStyles.error.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
    warning: <svg className={`w-6 h-6 ${typeStyles.warning.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
    info: <svg className={`w-6 h-6 ${typeStyles.info.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  };

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning }}>
      {children}
      <div className="fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-3 md:right-6 md:top-6">
        {toasts.map((toast) => (
          <div key={toast.id} className="animate-fade-in border-2 border-zinc-800 bg-[#111] shadow-2xl">
            <div className={`h-1.5 w-full ${typeStyles[toast.type].accent}`}></div>
            <div className="flex items-start gap-3 p-4">
              <div className="mt-0.5 flex-shrink-0">
                {typeIcons[toast.type]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[11px] font-bold tracking-[0.24em] uppercase text-zinc-500">
                  {typeStyles[toast.type].label}
                </p>
                <p className="text-sm font-medium leading-relaxed text-white">{toast.message}</p>
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="flex-shrink-0 p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
