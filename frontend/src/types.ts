export interface Entry {
  id: string | number;
  title: string;
  content: string;
  mood?: string;
  is_sticky?: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string | number;
  email: string;
  username: string;
  is_admin: boolean;
}

export interface AuthContextType {
  user: User | null;
  encryptionKey: string | null;
  loading: boolean;
  register: (email: string, username: string, password: string, cfToken: string) => Promise<{ success: boolean; token?: string; user?: User; error?: string }>;
  login: (email: string, password: string, cfToken: string) => Promise<{ success: boolean; token?: string; error?: string }>;
  logout: () => Promise<void>;
  storeEncryptionKey: (key: string, password?: string) => Promise<void>;
  restoreWrappedEncryptionKey: (password: string) => Promise<string | null>;
  clearEncryptionKey: () => Promise<void>;
  clearSessionState: () => void;
  setUser?: (user: User | null) => void;
}
