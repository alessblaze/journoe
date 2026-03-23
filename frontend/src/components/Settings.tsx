import { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import { cryptoService } from '../crypto';
import PasswordInput from './PasswordInput';
import Modal from './Modal';
import { useToast } from '../ToastContext';
import { keyStorage } from '../keyStorage';
import { extractDisplayHtml } from './LexicalEditor';

const USERNAME_MAX = 64;
const PASSWORD_MAX = 72;

const Settings = ({ onClose, entries }: { onClose: () => void; entries?: any[] }) => {
  const [activeTab, setActiveTab] = useState('security');
  const [loading, setLoading] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [pendingKeyWrapPassword, setPendingKeyWrapPassword] = useState<string>('');
  const [keyCopied, setKeyCopied] = useState(false);
  const [showExistingKey, setShowExistingKey] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [showRegeneratePasswordModal, setShowRegeneratePasswordModal] = useState(false);
  const [showRevealPasswordModal, setShowRevealPasswordModal] = useState(false);
  const [showResetSettingsModal, setShowResetSettingsModal] = useState(false);
  const [regeneratePassword, setRegeneratePassword] = useState('');
  const [regeneratePasswordError, setRegeneratePasswordError] = useState('');
  const [verifyingRegeneratePassword, setVerifyingRegeneratePassword] = useState(false);
  const [revealPassword, setRevealPassword] = useState('');
  const [revealPasswordError, setRevealPasswordError] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealingKey, setRevealingKey] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { encryptionKey, storeEncryptionKey, clearEncryptionKey, user, setUser } = useAuth();
  const { showError, showSuccess } = useToast();

  // Account tab state
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profileUsername, setProfileUsername] = useState(user?.username || '');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    // Always fetch fresh profile from API so fields are populated even for legacy sessions
    api.user.getProfile().then((data: any) => {
      setProfileEmail(data.email || '');
      setProfileUsername(data.username || '');
      // Also update context if user object is missing
      if (!user && data) {
        const freshUser = {
          id: data.id,
          email: data.email,
          username: data.username,
          is_admin: data.is_admin ?? false,
        };
        localStorage.setItem('user', JSON.stringify(freshUser));
        setUser?.(freshUser);
      }
    }).catch(() => {
      // Fallback to whatever is in context
      setProfileEmail(user?.email || '');
      setProfileUsername(user?.username || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRegenerateKey = async () => {
    setShowRegenerateModal(true);
  };

  const performRegenerateKey = async (currentPasswordForWrap: string) => {
    setLoading(true);
    try {
      // Use the atomic server-side endpoint to delete all entries and clear fingerprint
      // in a single operation — prevents partial data loss if the browser disconnects mid-way.
      await api.user.resetAllEntriesAndKey();

      const key = await cryptoService.generateKey();

      const fp = await cryptoService.fingerprint(key);
      await api.user.updateKeyFingerprint(fp);

      setShowExistingKey(false);
      setRevealedKey(null);
      setRevealPassword('');
      setRevealPasswordError('');
      setKeyCopied(false);
      // Store the password for use when the user acknowledges the key.
      // We deliberately do NOT call storeEncryptionKey yet because it triggers
      // setEncryptionKey() in AuthContext, which causes Dashboard's SSE useEffect
      // to disconnect and reconnect. The reconnect races with the new JWT cookies
      // and can cause a spurious auth_revoked event that destroys this modal.
      setPendingKeyWrapPassword(currentPasswordForWrap);
      setNewKey(key);
    } catch (error: any) {
      showError('Failed to regenerate key: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmRegenerateIntent = () => {
    setShowRegenerateModal(false);
    setRegeneratePassword('');
    setRegeneratePasswordError('');
    setShowRegeneratePasswordModal(true);
  };

  const handleVerifyRegeneratePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegeneratePasswordError('');
    setVerifyingRegeneratePassword(true);

    try {
      const currentPasswordForWrap = regeneratePassword;
      await api.user.verifySensitiveAction(currentPasswordForWrap);
      setShowRegeneratePasswordModal(false);
      setRegeneratePassword('');
      await performRegenerateKey(currentPasswordForWrap);
    } catch (error: any) {
      setRegeneratePasswordError(error.message || 'Failed to verify password');
    } finally {
      setVerifyingRegeneratePassword(false);
    }
  };

  const handleCopyKey = async () => {
    try {
      if (newKey || encryptionKey) await navigator.clipboard.writeText(newKey || encryptionKey || '');
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      showError('Failed to copy key to clipboard');
    }
  };

  const handleResetSettings = () => {
    setShowResetSettingsModal(true);
  };

  const confirmResetSettings = async () => {
    setShowResetSettingsModal(false);
    await clearEncryptionKey();
    showSuccess('Settings reset. Please logout and login again to re-enter your encryption key.');
    onClose();
    window.location.reload();
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setSavingProfile(true);
    try {
      await api.user.updateProfile(profileEmail, profileUsername);
      const updatedUser = { ...user!, email: profileEmail, username: profileUsername };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setUser?.(updatedUser);
      setProfileSuccess('Profile updated successfully!');
    } catch (err: any) {
      setProfileError(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    setSavingPassword(true);
    try {
      if (!encryptionKey) {
        throw new Error('Encryption key is not loaded in this session. Re-enter your key before changing the account password.');
      }

      // Verify we can derive and use the new wrapping password locally before
      // changing the server password, but do not overwrite the stored record yet.
      await keyStorage.verifyPasswordWrap(encryptionKey, newPassword);

      await api.user.changePassword(currentPassword, newPassword);

      // Persist the wrapped key only after the server password change succeeds.
      await keyStorage.storeWrappedKey(encryptionKey, newPassword);
      const verifiedUnlockedKey = await keyStorage.unlockWrappedKey(newPassword);
      if (verifiedUnlockedKey !== encryptionKey) {
        throw new Error('Password changed, but the local recovery key could not be verified with the new password. Keep this session open and re-save your key.');
      }

      setCurrentPassword('');
      setNewPassword('');
      setPasswordSuccess('Password changed successfully!');
      setTimeout(() => setPasswordSuccess(''), 3000);
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRevealKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setRevealPasswordError('');
    setRevealingKey(true);

    try {
      const unlockedKey = await keyStorage.unlockWrappedKey(revealPassword);
      if (!unlockedKey) {
        setRevealPasswordError('Unable to unlock the stored key with this password.');
        return;
      }

      setRevealedKey(unlockedKey);
      setShowRevealPasswordModal(false);
      setRevealPassword('');
      setShowExistingKey(true);
    } finally {
      setRevealingKey(false);
    }
  };

  const extractPlainText = (rawContent: string): string => {
    const html = extractDisplayHtml(rawContent);
    return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  };

  const exportAsText = async () => {
    if (!entries || entries.length === 0) {
      showError('No entries to export');
      return;
    }

    setExporting(true);
    try {
      const lines: string[] = [];
      lines.push('='.repeat(80));
      lines.push(`JOURNAL EXPORT - ${new Date().toLocaleDateString()}`);
      lines.push(`Total Entries: ${entries.length}`);
      lines.push('='.repeat(80));
      lines.push('');

      const sortedEntries = [...entries].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      sortedEntries.forEach((entry, index) => {
        lines.push('-'.repeat(80));
        lines.push(`Entry #${index + 1}`);
        lines.push(`Title: ${entry.title}`);
        lines.push(`Date: ${new Date(entry.created_at).toLocaleString()}`);
        if (entry.mood) {
          lines.push(`Mood: ${entry.mood}`);
        }
        lines.push('-'.repeat(80));
        
        const plainText = extractPlainText(entry.content);
        lines.push(plainText);
        lines.push('');
        lines.push('');
      });

      const content = lines.join('\n');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `journal-export-${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showSuccess('Exported as text file successfully');
    } catch (error: any) {
      showError('Failed to export: ' + error.message);
    } finally {
      setExporting(false);
    }
  };

  const exportAsMarkdown = async () => {
    if (!entries || entries.length === 0) {
      showError('No entries to export');
      return;
    }

    setExporting(true);
    try {
      let markdown = `# Journal Export\n\n`;
      markdown += `**Export Date:** ${new Date().toLocaleString()}\n`;
      markdown += `**Total Entries:** ${entries.length}\n\n---\n\n`;

      const sortedEntries = [...entries].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      sortedEntries.forEach((entry) => {
        markdown += `## ${entry.title}\n\n`;
        markdown += `**Date:** ${new Date(entry.created_at).toLocaleString()}\n\n`;
        if (entry.mood) {
          markdown += `**Mood:** ${entry.mood}\n\n`;
        }
        markdown += `**Content:**\n\n`;
        
        const plainText = extractPlainText(entry.content);
        markdown += plainText + '\n\n';
        markdown += `---\n\n`;
      });

      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `journal-export-${new Date().toISOString().split('T')[0]}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showSuccess('Exported as Markdown file successfully');
    } catch (error: any) {
      showError('Failed to export: ' + error.message);
    } finally {
      setExporting(false);
    }
  };

  if (newKey) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
        <div className="bg-[#111] border-2 border-[#00A300] w-full max-w-2xl p-6 md:p-12 text-center shadow-2xl animate-fade-in relative">
          <div className="mb-6 md:mb-8">
            <h2 className="text-2xl md:text-4xl font-light text-white mb-2 md:mb-4">New Encryption Key Generated</h2>
            <p className="text-zinc-400 text-sm md:text-lg uppercase tracking-wider font-semibold">
              All previous entries have been deleted
            </p>
          </div>

          <div className="mb-6 md:mb-8">
            <label className="block text-zinc-500 mb-2 font-bold tracking-widest text-xs md:text-sm">
              YOUR NEW KEY
            </label>
            <div className="bg-black border border-zinc-800 p-4 md:p-6 text-sm md:text-xl font-mono text-[#00A300] break-all select-all">
              {newKey}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleCopyKey}
              className={`flex-1 py-4 font-bold tracking-widest uppercase text-sm md:text-base transition-colors ${keyCopied ? 'bg-[#0078D7] text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'
                }`}
            >
              {keyCopied ? 'COPIED!' : 'COPY KEY'}
            </button>

            <button
              onClick={async () => {
                try {
                  await storeEncryptionKey(newKey!, pendingKeyWrapPassword);
                  setPendingKeyWrapPassword('');
                  setNewKey(null);
                  setKeyCopied(false);
                  showSuccess('Encryption key regenerated successfully.');
                } catch (error: any) {
                  showError(error?.message || 'Failed to save the regenerated key locally. Keep this window open and try again.');
                }
              }}
              className="flex-1 bg-[#00A300] text-white py-4 font-bold tracking-widest uppercase text-sm md:text-base hover:bg-[#008a00] transition-colors"
            >
              I'VE SAVED IT
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#111] flex flex-col z-50 overflow-hidden animate-fade-in">
      <div className="flex justify-between items-center p-4 md:p-8 bg-zinc-900 border-b border-zinc-800">
        <h2 className="text-2xl md:text-4xl font-light text-white tracking-tight">Settings</h2>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-white hover:bg-[#E81123] p-2 md:p-4 transition-colors"
        >
          <svg className="w-6 h-6 md:w-8 md:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar */}
        <div className="w-full md:w-48 lg:w-64 bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-row md:flex-col pt-0 md:pt-8 overflow-x-auto shrink-0">
          <button
            onClick={() => setActiveTab('account')}
            className={`whitespace-nowrap flex-1 md:flex-none text-center md:text-left px-4 md:px-8 py-4 font-semibold tracking-wider uppercase text-xs md:text-sm transition-colors ${activeTab === 'account'
                ? 'bg-[#0078D7] text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
          >
            Account
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`whitespace-nowrap flex-1 md:flex-none text-center md:text-left px-4 md:px-8 py-4 font-semibold tracking-wider uppercase text-xs md:text-sm transition-colors ${activeTab === 'security'
                ? 'bg-[#0078D7] text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
          >
            Security &amp; Keys
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`whitespace-nowrap flex-1 md:flex-none text-center md:text-left px-4 md:px-8 py-4 font-semibold tracking-wider uppercase text-xs md:text-sm transition-colors ${activeTab === 'about'
                ? 'bg-[#0078D7] text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
          >
            System Info
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 md:p-12 overflow-y-auto bg-[#111]">
          {activeTab === 'account' ? (
            <div className="max-w-2xl space-y-12">
              {/* Export Journal */}
              <div>
                <h3 className="text-2xl font-light text-white mb-6">Export Journal</h3>
                <p className="text-zinc-400 mb-6 text-sm">
                  Download all your journal entries as a text or markdown file.
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={exportAsText}
                    disabled={exporting || !entries || entries.length === 0}
                    className="flex-1 bg-zinc-800 text-white px-6 py-3 font-bold tracking-widest uppercase text-sm hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                  >
                    {exporting ? 'EXPORTING...' : 'EXPORT AS TEXT'}
                  </button>
                  <button
                    onClick={exportAsMarkdown}
                    disabled={exporting || !entries || entries.length === 0}
                    className="flex-1 bg-[#0078D7] text-white px-6 py-3 font-bold tracking-widest uppercase text-sm hover:bg-[#005a9e] disabled:opacity-50 transition-colors"
                  >
                    {exporting ? 'EXPORTING...' : 'EXPORT AS MARKDOWN'}
                  </button>
                </div>
              </div>
              {/* Profile */}
              <form onSubmit={handleUpdateProfile}>
                <h3 className="text-2xl font-light text-white mb-6">Profile</h3>
                {profileSuccess && <p className="mb-4 text-[#00A300] font-bold tracking-widest uppercase text-xs">{profileSuccess}</p>}
                {profileError && <p className="mb-4 text-[#E81123] font-bold tracking-widest uppercase text-xs">{profileError}</p>}
                <div className="space-y-6 mb-8">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-zinc-500 text-xs font-bold tracking-widest uppercase">Username</label>
                      <span className="text-xs text-zinc-500 font-mono">{profileUsername.length}/{USERNAME_MAX}</span>
                    </div>
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={USERNAME_MAX}
                      value={profileUsername}
                      onChange={(e) => setProfileUsername(e.target.value)}
                      className="w-full bg-transparent text-white text-lg placeholder-zinc-600 border-b-2 border-zinc-700 focus:border-[#0078D7] pb-2 outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-500 text-xs font-bold tracking-widest uppercase mb-2">Email Address</label>
                    <input
                      type="email"
                      required
                      maxLength={320}
                      value={profileEmail}
                      onChange={(e) => setProfileEmail(e.target.value)}
                      className="w-full bg-transparent text-white text-lg placeholder-zinc-600 border-b-2 border-zinc-700 focus:border-[#0078D7] pb-2 outline-none transition-colors"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="bg-[#0078D7] text-white px-8 py-3 font-bold tracking-widest uppercase text-sm hover:bg-[#005a9e] disabled:opacity-50 transition-colors"
                >
                  {savingProfile ? 'SAVING...' : 'SAVE PROFILE'}
                </button>
              </form>

              {/* Change Password */}
              <form onSubmit={handleChangePassword} className="pt-8 border-t border-zinc-800">
                <h3 className="text-2xl font-light text-white mb-6">Change Password</h3>
                {passwordSuccess && <p className="mb-4 text-[#00A300] font-bold tracking-widest uppercase text-xs">{passwordSuccess}</p>}
                {passwordError && <p className="mb-4 text-[#E81123] font-bold tracking-widest uppercase text-xs">{passwordError}</p>}
                <div className="space-y-6 mb-8">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-zinc-500 text-xs font-bold tracking-widest uppercase">Current Password</label>
                      <span className="text-xs text-zinc-500 font-mono">{currentPassword.length}/{PASSWORD_MAX}</span>
                    </div>
                    <PasswordInput
                      required
                      maxLength={PASSWORD_MAX}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Current password"
                      className="w-full bg-transparent text-white text-lg placeholder-zinc-600 border-b-2 border-zinc-700 focus:border-[#0078D7] pb-2 outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-zinc-500 text-xs font-bold tracking-widest uppercase">New Password</label>
                      <span className="text-xs text-zinc-500 font-mono">{newPassword.length}/{PASSWORD_MAX}</span>
                    </div>
                    <PasswordInput
                      required
                      minLength={8}
                      maxLength={PASSWORD_MAX}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password (8-72 chars)"
                      className="w-full bg-transparent text-white text-lg placeholder-zinc-600 border-b-2 border-zinc-700 focus:border-[#0078D7] pb-2 outline-none transition-colors"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="bg-zinc-800 text-white px-8 py-3 font-bold tracking-widest uppercase text-sm hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                >
                  {savingPassword ? 'CHANGING...' : 'CHANGE PASSWORD'}
                </button>
              </form>
            </div>
          ) : activeTab === 'security' ? (
            <div className="max-w-3xl space-y-10 md:space-y-12">
              <div>
                <h3 className="text-xl md:text-2xl font-light text-white mb-2 md:mb-4">Encryption Status</h3>
                {encryptionKey ? (
                  <p className="text-[#00CC6A] font-bold tracking-widest uppercase text-xs md:text-sm">
                    SYSTEM SECURED. ENCRYPTION KEY IS ACTIVE.
                  </p>
                ) : (
                  <p className="text-[#E81123] font-bold tracking-widest uppercase text-xs md:text-sm">
                    WARNING. ENCRYPTION KEY IS MISSING.
                  </p>
                )}
                <p className="text-zinc-400 mt-2 text-sm md:text-base">
                  Your encryption key never leaves this browser. It's used for AES-256-GCM client-side encryption.
                </p>
              </div>

              {encryptionKey && (
                <div>
                  <h3 className="text-lg md:text-xl font-light text-white mb-2 md:mb-4">Backup Key</h3>
                  {showExistingKey ? (
                    <div className="space-y-4">
                      <div className="bg-black border border-zinc-800 p-3 md:p-4 text-xs md:text-sm font-mono text-zinc-300 break-all select-all">
                        {revealedKey}
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(revealedKey || '');
                              setKeyCopied(true);
                              setTimeout(() => setKeyCopied(false), 2000);
                            } catch {
                              showError('Failed to copy key to clipboard');
                            }
                          }}
                          className={`w-full sm:w-auto px-6 md:px-8 py-3 font-bold tracking-wider uppercase text-xs md:text-sm transition-colors ${keyCopied ? 'bg-[#0078D7] text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'
                            }`}
                        >
                          {keyCopied ? 'COPIED TO CLIPBOARD' : 'COPY KEY'}
                        </button>
                        <button
                          onClick={() => {
                            setShowExistingKey(false);
                            setRevealedKey(null);
                          }}
                          className="w-full sm:w-auto px-6 md:px-8 py-3 bg-zinc-800 text-white font-bold tracking-wider uppercase text-xs md:text-sm hover:bg-zinc-700 transition-colors"
                        >
                          HIDE
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setRevealPassword('');
                        setRevealPasswordError('');
                        setShowRevealPasswordModal(true);
                      }}
                      className="w-full sm:w-auto bg-zinc-800 text-white px-6 md:px-8 py-3 font-bold tracking-wider uppercase text-xs md:text-sm hover:bg-zinc-700 transition-colors"
                    >
                      REVEAL KEY
                    </button>
                  )}
                </div>
              )}

              <div className="pt-6 md:pt-8 border-t border-zinc-800">
                <h3 className="text-lg md:text-xl font-light text-[#E81123] mb-2 md:mb-4">Danger Zone</h3>
                <div className="space-y-4">
                  <button
                    onClick={handleRegenerateKey}
                    disabled={loading}
                    className="w-full sm:w-auto bg-[#E81123] text-white px-6 md:px-8 py-3 font-bold tracking-wider uppercase text-xs md:text-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'PROCESSING...' : 'REGENERATE KEY (DELETES DATA)'}
                  </button>
                  <p className="text-zinc-500 text-xs md:text-sm">
                    Replaces your key entirely. Previous data will become undecryptable and will be purged.
                  </p>
                </div>
              </div>

              <div className="pt-6 md:pt-8 border-t border-zinc-800">
                <h3 className="text-lg md:text-xl font-light text-zinc-300 mb-2 md:mb-4">Reset Device</h3>
                <button
                  onClick={handleResetSettings}
                  className="w-full sm:w-auto bg-zinc-800 text-white px-6 md:px-8 py-3 font-bold tracking-wider uppercase text-xs md:text-sm hover:bg-zinc-700 transition-colors"
                >
                  CLEAR LOCAL STORAGE
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl space-y-10 md:space-y-12">
              <div>
                <h3 className="text-2xl md:text-4xl font-light text-white mb-2">Secure Journal</h3>
                <p className="text-zinc-400 text-base md:text-lg">Version 1.0.0 — Metro Edition</p>
                <p className="text-zinc-500 text-sm mt-2 font-mono tracking-wider uppercase">Powered by Vodka</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8">
                <div className="bg-[#0078D7] p-6 md:p-8 text-white">
                  <h4 className="font-bold tracking-widest uppercase text-xs mb-2 opacity-80">Frontend</h4>
                  <ul className="space-y-1 font-semibold text-sm md:text-base">
                    <li>React 18</li>
                    <li>Vite</li>
                    <li>Tailwind CSS</li>
                    <li>Web Crypto API</li>
                  </ul>
                </div>
                <div className="bg-[#8C0095] p-6 md:p-8 text-white">
                  <h4 className="font-bold tracking-widest uppercase text-xs mb-2 opacity-80">Backend</h4>
                  <ul className="space-y-1 font-semibold text-sm md:text-base">
                    <li>Go + Gin</li>
                    <li>PostgreSQL</li>
                    <li>GORM</li>
                    <li>JWT</li>
                  </ul>
                </div>
              </div>

              <div>
                <h3 className="text-lg md:text-xl font-light text-white mb-2 md:mb-4">Encryption Profile</h3>
                <p className="text-zinc-300 leading-relaxed max-w-2xl text-sm md:text-base">
                  Client-side zero-knowledge encryption model utilizing <strong>AES-256-GCM</strong>.
                  The server only ever handles encrypted blobs and is blind to your journal content.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={showRegenerateModal}
        onClose={() => setShowRegenerateModal(false)}
        onConfirm={handleConfirmRegenerateIntent}
        title="⚠️ Regenerate Key Warning"
        message="This will PERMANENTLY DELETE ALL your journal entries. A new encryption key will be generated and shown to you. This action cannot be undone. Are you sure you want to continue?"
        confirmText="REGENERATE & DESTROY ALL DATA"
        cancelText="CANCEL"
        type="danger"
      />

      {showRegeneratePasswordModal && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-[60] font-sans">
          <div className="w-full max-w-xl border-2 border-zinc-800 bg-[#111] shadow-2xl animate-fade-in">
            <div className="h-2 w-full bg-[#FFB900]"></div>
            <div className="p-8 md:p-12">
              <p className="mb-3 text-xs font-bold tracking-[0.28em] uppercase text-[#FFB900]">KEY ROTATION</p>
              <h3 className="text-3xl font-light text-white mb-2">Confirm Current Password</h3>
              <p className="text-zinc-400 mb-8 font-semibold tracking-wide">
                Re-enter your password to authorize changing the encryption key fingerprint.
              </p>
              <form onSubmit={handleVerifyRegeneratePassword} className="space-y-6">
                {regeneratePasswordError && (
                  <div className="text-[#E81123] font-bold tracking-widest uppercase text-xs">
                    {regeneratePasswordError}
                  </div>
                )}
                <PasswordInput
                  required
                  maxLength={PASSWORD_MAX}
                  value={regeneratePassword}
                  onChange={(e) => setRegeneratePassword(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                  className="w-full bg-transparent text-white text-xl placeholder-zinc-600 border-b-2 border-zinc-700 focus:border-[#FFB900] pb-2 outline-none transition-colors"
                />
                <div className="flex justify-end gap-4 mt-8">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRegeneratePasswordModal(false);
                      setRegeneratePassword('');
                      setRegeneratePasswordError('');
                    }}
                    className="px-8 py-3 text-zinc-400 hover:text-white font-bold tracking-widest uppercase text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={verifyingRegeneratePassword}
                    className="bg-[#FFB900] text-black px-8 py-3 font-bold tracking-[0.22em] uppercase text-sm hover:bg-[#e5a600] disabled:opacity-50 transition-colors"
                  >
                    {verifyingRegeneratePassword ? 'VERIFYING...' : 'VERIFY & CONTINUE'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showRevealPasswordModal && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-[60] font-sans">
          <div className="w-full max-w-xl border-2 border-zinc-800 bg-[#111] shadow-2xl animate-fade-in">
            <div className="h-2 w-full bg-[#0078D7]"></div>
            <div className="p-8 md:p-12">
              <p className="mb-3 text-xs font-bold tracking-[0.28em] uppercase text-[#0078D7]">BACKUP KEY ACCESS</p>
              <h3 className="text-3xl font-light text-white mb-2">Unlock Stored Key</h3>
              <p className="text-zinc-400 mb-8 font-semibold tracking-wide">
                Re-enter your current password to decrypt and display the stored backup key.
              </p>
              <form onSubmit={handleRevealKey} className="space-y-6">
                {revealPasswordError && (
                  <div className="text-[#E81123] font-bold tracking-widest uppercase text-xs">
                    {revealPasswordError}
                  </div>
                )}
                <PasswordInput
                  required
                  maxLength={PASSWORD_MAX}
                  value={revealPassword}
                  onChange={(e) => setRevealPassword(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                  className="w-full bg-transparent text-white text-xl placeholder-zinc-600 border-b-2 border-zinc-700 focus:border-[#0078D7] pb-2 outline-none transition-colors"
                />
                <div className="flex justify-end gap-4 mt-8">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRevealPasswordModal(false);
                      setRevealPassword('');
                      setRevealPasswordError('');
                    }}
                    className="px-8 py-3 text-zinc-400 hover:text-white font-bold tracking-widest uppercase text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={revealingKey}
                    className="bg-[#0078D7] text-white px-8 py-3 font-bold tracking-[0.22em] uppercase text-sm hover:bg-[#005a9e] disabled:opacity-50 transition-colors"
                  >
                    {revealingKey ? 'UNLOCKING...' : 'UNLOCK KEY'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={showResetSettingsModal}
        onClose={() => setShowResetSettingsModal(false)}
        onConfirm={confirmResetSettings}
        title="Reset Settings"
        message="Are you sure you want to reset all settings? This won't delete your journal entries."
        confirmText="RESET"
        cancelText="CANCEL"
        type="warning"
      />
    </div>
  );
};

export default Settings;
