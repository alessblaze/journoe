import { useEffect, useState } from 'react';
import tabLockService from '../tabLock';
import { sessionHandoff } from '../sessionHandoff';

interface TabLockProps {
  children: React.ReactNode;
}

const TabLock: React.FC<TabLockProps> = ({ children }) => {
  const [isDuplicateTab, setIsDuplicateTab] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Check if another tab is already open
    const hasExistingTab = tabLockService.checkExistingTab();

    if (hasExistingTab) {
      setIsDuplicateTab(true);
      setIsChecking(false);
      return;
    }

    // Try to acquire the lock
    const lockAcquired = tabLockService.acquireLock();

    if (!lockAcquired) {
      setIsDuplicateTab(true);
      setIsChecking(false);
      return;
    }

    setIsChecking(false);

    // Set up handler for when another tab steals the lock
    tabLockService.setDuplicateTabHandler(() => {
      setIsDuplicateTab(true);
    });

    // Cleanup when component unmounts
    return () => {
      if (tabLockService.isTabActive()) {
        tabLockService.releaseLock();
      }
    };
  }, []);

  // Handle page unload to properly release lock
  useEffect(() => {
    if (isDuplicateTab) {
      tabLockService.announceWaitingTab();
      // Keep announcing we are waiting so the active tab doesn't think we gave up
      const interval = setInterval(() => {
        tabLockService.announceWaitingTab();
      }, 2000);

      // Listen for the active tab to broadcast the key as it dies
      const unsubscribe = sessionHandoff.listenForKeyPush((key) => {
        sessionStorage.setItem('encryptionKey', key);
        window.location.reload(); // Automatically refresh and take over!
      });

      return () => {
        clearInterval(interval);
        tabLockService.clearWaitingTabAnnouncement();
        unsubscribe();
      };
    }

    tabLockService.clearWaitingTabAnnouncement();
    return undefined;
  }, [isDuplicateTab]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (tabLockService.isTabActive()) {
        const encryptionKey = sessionStorage.getItem('encryptionKey');
        if (encryptionKey && tabLockService.hasRecentWaitingTab()) {
          sessionHandoff.broadcastEncryptionKeyHandoff(encryptionKey);
        }
        tabLockService.releaseLock();
      }
    };

    const handleVisibilityChange = () => {
      // If tab is hidden, check if another tab has taken over
      if (document.hidden && tabLockService.isTabActive()) {
        setTimeout(() => {
          const lockData = localStorage.getItem('journal_tab_lock');
          if (lockData) {
            const lock = JSON.parse(lockData);
            if (lock.tabId !== tabLockService.getTabId()) {
              setIsDuplicateTab(true);
            }
          }
        }, 1000);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  if (isChecking) {
    return (
      <div className="min-h-screen bg-[#111] flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-lg border-2 border-zinc-800 bg-zinc-900 p-10 text-center shadow-2xl animate-fade-in">
          <p className="mb-3 text-xs font-bold tracking-[0.28em] uppercase text-[#0078D7]">SESSION CHECK</p>
          <h1 className="mb-8 text-4xl font-light tracking-tight text-white">Verifying active device</h1>
          <div className="mb-8 flex items-center justify-center gap-3">
            <div className="h-4 w-4 bg-[#0078D7] animate-pulse"></div>
            <div className="h-4 w-4 bg-[#0078D7] animate-pulse" style={{ animationDelay: '0.15s' }}></div>
            <div className="h-4 w-4 bg-[#0078D7] animate-pulse" style={{ animationDelay: '0.3s' }}></div>
            <div className="h-4 w-4 bg-[#0078D7] animate-pulse" style={{ animationDelay: '0.45s' }}></div>
          </div>
          <p className="text-sm font-semibold tracking-[0.22em] uppercase text-zinc-400">
            Checking if this browser already owns the journal session.
          </p>
        </div>
      </div>
    );
  }

  if (isDuplicateTab) {
    return (
      <div className="min-h-screen bg-[#111] flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-3xl border-2 border-zinc-800 bg-zinc-900 shadow-2xl animate-fade-in">
          <div className="grid gap-0 md:grid-cols-[1.2fr_0.8fr]">
            <div className="border-b border-zinc-800 p-8 md:border-b-0 md:border-r md:p-10">
              <p className="mb-3 text-xs font-bold tracking-[0.28em] uppercase text-[#E81123]">SECURITY LOCK</p>
              <h1 className="mb-4 text-3xl md:text-5xl font-light tracking-tight text-white">
                Multiple tabs are blocked
              </h1>
              <p className="mb-8 max-w-xl text-base leading-relaxed text-zinc-300">
                This journal permits one active tab at a time so encrypted state, live updates, and recovery-key handling stay consistent.
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="border border-zinc-800 bg-[#161616] p-5">
                  <p className="mb-2 text-[11px] font-bold tracking-[0.24em] uppercase text-[#E81123]">Reason 01</p>
                  <p className="text-sm leading-relaxed text-zinc-300">Prevents conflicting writes across multiple journal views.</p>
                </div>
                <div className="border border-zinc-800 bg-[#161616] p-5">
                  <p className="mb-2 text-[11px] font-bold tracking-[0.24em] uppercase text-[#E81123]">Reason 02</p>
                  <p className="text-sm leading-relaxed text-zinc-300">Keeps the active encryption key and fingerprint in sync.</p>
                </div>
                <div className="border border-zinc-800 bg-[#161616] p-5">
                  <p className="mb-2 text-[11px] font-bold tracking-[0.24em] uppercase text-[#E81123]">Reason 03</p>
                  <p className="text-sm leading-relaxed text-zinc-300">Reduces the chance of stale sessions being used accidentally.</p>
                </div>
              </div>
            </div>

            <div className="bg-[#0b0b0b] p-8 md:p-10">
              <p className="mb-4 text-xs font-bold tracking-[0.28em] uppercase text-[#0078D7]">NEXT STEPS</p>
              <div className="space-y-4">
                <div className="border border-zinc-800 bg-[#111] p-4">
                  <p className="mb-1 text-[11px] font-bold tracking-[0.24em] uppercase text-[#0078D7]">Step 01</p>
                  <p className="text-sm text-zinc-300">Close any other open journal tab or window.</p>
                </div>
                <div className="border border-zinc-800 bg-[#111] p-4">
                  <p className="mb-1 text-[11px] font-bold tracking-[0.24em] uppercase text-[#0078D7]">Step 02</p>
                  <p className="text-sm text-zinc-300">Return here and refresh this page once the other tab is closed.</p>
                </div>
                <div className="border border-zinc-800 bg-[#111] p-4">
                  <p className="mb-1 text-[11px] font-bold tracking-[0.24em] uppercase text-[#0078D7]">Step 03</p>
                  <p className="text-sm text-zinc-300">The journal will reclaim this session and continue normally.</p>
                </div>
              </div>

              <button
                onClick={() => window.location.reload()}
                className="mt-8 w-full bg-[#E81123] px-6 py-3.5 text-sm font-bold tracking-[0.22em] uppercase text-white transition-colors hover:bg-[#c50f1f]"
              >
                Refresh This Page
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default TabLock;
