import { createContext, useContext, useState, ReactNode } from 'react';
import { api } from './api';
import { AuthContextType, User } from './types';
import { cryptoService } from './crypto';
import { keyStorage } from './keyStorage';

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(() => {
    const storedUser = localStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : null;
  });
  const [encryptionKey, setEncryptionKey] = useState<string | null>(() => {
    // Synchronous path: key already in sessionStorage (same tab or page refresh)
    return sessionStorage.getItem('encryptionKey');
  });
  const [loading] = useState<boolean>(false);

  // Async key handoff path is completely delegated to TabLock.tsx now.
  // TabLock catches the broadcasted key from the dying tab, places it into
  // sessionStorage, and then auto-reloads the page, so this component will
  // seamlessly pick it up on the next synchronous mount phase.

  const register = async (email: string, username: string, password: string, cfToken: string) => {
    try {
      const data = await api.auth.register(email, username, password, cfToken) as { success: boolean; token?: string; user: User; error?: string };
      // Do NOT call setUser here — doing so would cause React Router to immediately
      // navigate away from Register.tsx before the key display screen can be shown.
      // The caller (Register.tsx) stores the user object and commits it via setUser
      // only after the user has acknowledged and saved their encryption key.
      return { success: true, token: data.token, user: data.user };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const login = async (email: string, password: string, cfToken: string) => {
    try {
      const data = await api.auth.login(email, password, cfToken) as { success: boolean; token?: string; user: User; error?: string };
      // Tokens are now in httpOnly cookies (set by backend), no localStorage needed
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      return { success: true, token: data.token };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch {}
    await keyStorage.clear();
    // Clear frontend state
    localStorage.removeItem('user');
    localStorage.removeItem('keyFingerprint');
    sessionStorage.removeItem('encryptionKey');
    setUser(null);
    setEncryptionKey(null);
  };

  const storeEncryptionKey = async (key: string, password?: string) => {
    if (password) {
      await keyStorage.storeWrappedKey(key, password);
    }
    // Compute SHA-256 fingerprint and cache locally so api.ts can attach it as a header
    try {
      const fp = await cryptoService.fingerprint(key);
      localStorage.setItem('keyFingerprint', fp);
    } catch { /* ignore */ }
    sessionStorage.setItem('encryptionKey', key);
    setEncryptionKey(key);
  };

  const restoreWrappedEncryptionKey = async (password: string): Promise<string | null> => {
    const key = await keyStorage.unlockWrappedKey(password);
    if (!key) {
      return null;
    }

    await storeEncryptionKey(key);
    return key;
  };

  const clearEncryptionKey = async () => {
    await keyStorage.clear();
    localStorage.removeItem('keyFingerprint');
    sessionStorage.removeItem('encryptionKey');
    setEncryptionKey(null);
  };

  const clearSessionState = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('keyFingerprint');
    sessionStorage.removeItem('encryptionKey');
    setUser(null);
    setEncryptionKey(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        encryptionKey,
        loading,
        register,
        login,
        logout,
        storeEncryptionKey,
        restoreWrappedEncryptionKey,
        clearEncryptionKey,
        clearSessionState,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
