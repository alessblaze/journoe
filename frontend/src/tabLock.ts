// @ts-ignore: import.meta.env is injected by Vite
const TAB_ID_KEY = 'journal_tab_id';
const TAB_HEARTBEAT_KEY = 'journal_heartbeat';
const TAB_LOCK_KEY = 'journal_tab_lock';
const TAB_WAITING_KEY = 'journal_waiting_tab';
const WAITING_TTL_MS = 15000;

type TabLockHandler = () => void;

class TabLockService {
  private tabId: string;
  private heartbeatInterval: number | null = null;
  private storageListener: ((event: StorageEvent) => void) | null = null;
  private onDuplicateTabDetected: TabLockHandler | null = null;
  private isLocked: boolean = false;

  constructor() {
    this.tabId = this.generateTabId();
  }

  private generateTabId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  setDuplicateTabHandler(handler: TabLockHandler): void {
    this.onDuplicateTabDetected = handler;
  }

  acquireLock(): boolean {
    // Check if there's an existing active tab
    const existingLock = localStorage.getItem(TAB_LOCK_KEY);
    const existingHeartbeat = localStorage.getItem(TAB_HEARTBEAT_KEY);

    if (existingLock && existingHeartbeat) {
      const heartbeatTime = parseInt(existingHeartbeat);
      const now = Date.now();
      
      // If heartbeat is within 5 seconds, another tab is active
      if (now - heartbeatTime < 5000) {
        return false;
      }
    }

    // Try to acquire the lock
    const lockData = {
      tabId: this.tabId,
      timestamp: Date.now()
    };

    try {
      localStorage.setItem(TAB_LOCK_KEY, JSON.stringify(lockData));
      localStorage.setItem(TAB_HEARTBEAT_KEY, Date.now().toString());
      localStorage.setItem(TAB_ID_KEY, this.tabId);
      
      this.isLocked = true;
      
      // Start heartbeat
      this.startHeartbeat();
      
      // Listen for storage changes (other tabs setting lock)
      this.setupStorageListener();
      
      return true;
    } catch {
      return false;
    }
  }

  releaseLock(): void {
    try {
      const currentLock = localStorage.getItem(TAB_LOCK_KEY);
      if (currentLock) {
        const lock = JSON.parse(currentLock);
        if (lock.tabId === this.tabId) {
          localStorage.removeItem(TAB_LOCK_KEY);
          localStorage.removeItem(TAB_HEARTBEAT_KEY);
          localStorage.removeItem(TAB_ID_KEY);
        }
      }
    } catch {}

    this.stopHeartbeat();
    this.cleanupStorageListener();
    this.isLocked = false;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat(); // Clear any existing heartbeat
    
    this.heartbeatInterval = window.setInterval(() => {
      try {
        localStorage.setItem(TAB_HEARTBEAT_KEY, Date.now().toString());
        
        // Periodically verify we still hold the lock
        const lockData = localStorage.getItem(TAB_LOCK_KEY);
        if (lockData) {
          const lock = JSON.parse(lockData);
          if (lock.tabId !== this.tabId) {
            this.handleDuplicateTab();
          }
        }
      } catch {}
    }, 2000); // Update every 2 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private setupStorageListener(): void {
    const listener = (event: StorageEvent): void => {
      if (event.key === TAB_LOCK_KEY) {
        try {
          const newLock = event.newValue;
          if (newLock) {
            const lock = JSON.parse(newLock);
            if (lock.tabId !== this.tabId) {
              this.handleDuplicateTab();
            }
          }
        } catch {}
      }
    };

    this.storageListener = listener;
    window.addEventListener('storage', listener);
  }

  private cleanupStorageListener(): void {
    if (this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
      this.storageListener = null;
    }
  }

  private handleDuplicateTab(): void {
    if (this.onDuplicateTabDetected && this.isLocked) {
      this.onDuplicateTabDetected();
    }
  }

  isTabActive(): boolean {
    return this.isLocked;
  }

  getTabId(): string {
    return this.tabId;
  }

  checkExistingTab(): boolean {
    const existingHeartbeat = localStorage.getItem(TAB_HEARTBEAT_KEY);
    if (existingHeartbeat) {
      const heartbeatTime = parseInt(existingHeartbeat);
      const now = Date.now();
      
      // Check if heartbeat is within the last 5 seconds
      return now - heartbeatTime < 5000;
    }
    return false;
  }

  announceWaitingTab(): void {
    try {
      localStorage.setItem(TAB_WAITING_KEY, JSON.stringify({
        tabId: this.tabId,
        timestamp: Date.now(),
      }));
    } catch {}
  }

  clearWaitingTabAnnouncement(): void {
    try {
      const waiting = localStorage.getItem(TAB_WAITING_KEY);
      if (!waiting) {
        return;
      }

      const parsed = JSON.parse(waiting);
      if (parsed.tabId === this.tabId || Date.now() - parsed.timestamp >= WAITING_TTL_MS) {
        localStorage.removeItem(TAB_WAITING_KEY);
      }
    } catch {
      localStorage.removeItem(TAB_WAITING_KEY);
    }
  }

  hasRecentWaitingTab(): boolean {
    try {
      const waiting = localStorage.getItem(TAB_WAITING_KEY);
      if (!waiting) {
        return false;
      }

      const parsed = JSON.parse(waiting);
      if (typeof parsed.timestamp !== 'number') {
        localStorage.removeItem(TAB_WAITING_KEY);
        return false;
      }

      if (Date.now() - parsed.timestamp >= WAITING_TTL_MS) {
        localStorage.removeItem(TAB_WAITING_KEY);
        return false;
      }

      return parsed.tabId !== this.tabId;
    } catch {
      localStorage.removeItem(TAB_WAITING_KEY);
      return false;
    }
  }
}

export const tabLockService = new TabLockService();
export default tabLockService;
