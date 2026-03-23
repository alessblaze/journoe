import { Entry } from './types';

// @ts-ignore: import.meta.env is injected by Vite
const API_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:8080/api';

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

export const refreshToken = async (): Promise<boolean> => {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }
  isRefreshing = true;
  refreshPromise = fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-COOKIE-AUTH': 'true' },
  })
    .then(res => res.ok)
    .catch(() => false)
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });
  return refreshPromise;
};

export const api = {
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_URL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-COOKIE-AUTH': 'true',
      ...(options.headers as Record<string, string>),
    };

    // For web: cookies are sent automatically by browser
    // For mobile: can still use Authorization header in options.headers explicitly
    // Don't automatically add Authorization header from localStorage - cookies handle it

    // Attach key fingerprint so backend can validate session key is still valid
    const keyFP = localStorage.getItem('keyFingerprint');
    if (keyFP) {
      headers['X-Key-Fingerprint'] = keyFP;
    }

    let response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include', // Important: allows cookies to be sent/received
      ...options,
      headers,
    });

    if (response.status === 401 && !endpoint.includes('/auth/')) {
      const refreshed = await refreshToken();
      if (refreshed) {
        response = await fetch(url, {
          cache: 'no-store',
          credentials: 'include',
          ...options,
          headers,
        });
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  },

  auth: {
    async register(email: string, username: string, password: string, cfToken: string) {
      return api.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, username, password, cf_token: cfToken }),
      });
    },

    async login(email: string, password: string, cfToken: string) {
      return api.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, cf_token: cfToken }),
      });
    },

    async logout() {
      return api.request('/auth/logout', {
        method: 'POST',
      });
    },
  },

  entries: {
    async list(): Promise<Entry[]> {
      return api.request('/entries/');
    },

    async get(id: string | number): Promise<Entry> {
      return api.request(`/entries/${id}`);
    },

    async create(title: string, content: string, mood?: string, is_sticky?: boolean): Promise<Entry> {
      return api.request('/entries/', {
        method: 'POST',
        body: JSON.stringify({ title, content, mood, is_sticky }),
      });
    },

    async update(id: string | number, title: string, content: string, version: number, mood?: string, is_sticky?: boolean): Promise<Entry> {
      return api.request(`/entries/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, content, version, mood, is_sticky }),
      });
    },

    async delete(id: string | number) {
      return api.request(`/entries/${id}`, {
        method: 'DELETE',
      });
    },
  },

  admin: {
    async getUsers(): Promise<any[]> {
      return api.request('/admin/users');
    },
    async deleteUser(id: string | number) {
      return api.request(`/admin/users/${id}`, { method: 'DELETE' });
    },
    async updatePassword(id: string | number, new_password: string) {
      return api.request(`/admin/users/${id}/password`, {
        method: 'PUT',
        body: JSON.stringify({ new_password }),
      });
    },
    async getConfig(): Promise<Record<string, string>> {
      return api.request('/admin/config');
    },
    async updateConfig(config: Record<string, string>) {
      return api.request('/admin/config', {
        method: 'PUT',
        body: JSON.stringify(config),
      });
    },
  },

  user: {
    async getProfile() {
      return api.request('/user/profile');
    },
    async updateProfile(email: string, username: string) {
      return api.request('/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ email, username }),
      });
    },
    async changePassword(current_password: string, new_password: string) {
      return api.request('/user/password', {
        method: 'PUT',
        body: JSON.stringify({ current_password, new_password }),
      });
    },
    async verifySensitiveAction(current_password: string) {
      return api.request('/user/verify-sensitive-action', {
        method: 'POST',
        body: JSON.stringify({ current_password }),
      });
    },
    async getKeyFingerprint(): Promise<{ key_fingerprint: string }> {
      return api.request('/user/key-fingerprint');
    },
    async updateKeyFingerprint(fingerprint: string) {
      return api.request('/user/key-fingerprint', {
        method: 'PUT',
        body: JSON.stringify({ fingerprint }),
      });
    },
    async resetAllEntriesAndKey(): Promise<{ deleted_count: number }> {
      return api.request('/user/reset-entries-and-key', {
        method: 'POST',
      });
    },
  },
};
