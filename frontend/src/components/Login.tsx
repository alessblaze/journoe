import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { cryptoService } from '../crypto';
import PasswordInput from './PasswordInput';
import Turnstile, { TurnstileHandle } from './Turnstile';
import Modal from './Modal';
import { useToast } from '../ToastContext';
import { keyStorage } from '../keyStorage';

const PASSWORD_MAX = 72;
const ENCRYPTION_KEY_LENGTH = 64;

const Login = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [encryptionKey, setEncryptionKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [cfToken, setCfToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const [needKey, setNeedKey] = useState(false);
  const [resettingKey, setResettingKey] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetPasswordError, setResetPasswordError] = useState('');
  const [hasLocalWrappedKey, setHasLocalWrappedKey] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showRawKeyInput, setShowRawKeyInput] = useState(false);
  const [checkingSessionUnlock, setCheckingSessionUnlock] = useState(false);

  const { user, login, storeEncryptionKey, restoreWrappedEncryptionKey, clearEncryptionKey, encryptionKey: authEncryptionKey } = useAuth();
  const { showError } = useToast();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!cfToken) {
      setError('Please complete the turnstile challenge first.');
      setLoading(false);
      return;
    }

    const result = await login(formData.email, formData.password, cfToken);

    if (result.success) {
      const restoredKey = await restoreWrappedEncryptionKey(formData.password);
      if (restoredKey) {
        try {
          const restoredFP = await cryptoService.fingerprint(restoredKey);
          const { key_fingerprint: storedFP } = await api.user.getKeyFingerprint();

          if (storedFP && restoredFP !== storedFP) {
            await clearEncryptionKey();
            setNeedKey(true);
            setError('Your saved device key is no longer valid for this account. Enter the new encryption key or use reset if you no longer have it.');
            setLoading(false);
            return;
          }
        } catch (error: any) {
          setNeedKey(true);
          setError(error.message || 'Failed to verify the saved device key. Your local recovery key has been preserved.');
          setLoading(false);
          return;
        }

        navigate('/');
        return;
      }

      if (authEncryptionKey) {
        await storeEncryptionKey(authEncryptionKey, formData.password);
        navigate('/');
        return;
      }

      const hasWrappedKey = await keyStorage.hasWrappedKey();
      if (!hasWrappedKey) {
        setNeedKey(true);
      } else {
        setNeedKey(true);
        setError('Stored device key could not be unlocked with this password. Re-enter your encryption key or reset it if needed.');
      }
      setLoading(false);
    } else {
      setError(result.error || 'An unknown error occurred');
      setLoading(false);
      
      // Reset turnstile on failure so user can try again
      setCfToken(null);
      turnstileRef.current?.reset();
    }
  };

  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (encryptionKey.length !== ENCRYPTION_KEY_LENGTH) {
      setError(`Invalid encryption key format (must be ${ENCRYPTION_KEY_LENGTH} characters)`);
      return;
    }
    setLoading(true);
    setError('');

    // Compute fingerprint before any network calls
    const enteredFP = await cryptoService.fingerprint(encryptionKey);

    // Check fingerprint against server — catches wrong keys before accepting
    const { key_fingerprint: storedFP } = await api.user.getKeyFingerprint();

    if (storedFP && enteredFP !== storedFP) {
      setError('This key does not match your account. Check your saved key and try again.');
      setLoading(false);
      return;
    }

    // If no fingerprint was stored yet, push this key's fingerprint now so future requests are enforced
    if (!storedFP) {
      await api.user.updateKeyFingerprint(enteredFP);
    }

    await storeEncryptionKey(encryptionKey, formData.password);
    setLoading(false);
  };

  const handleResetKey = async (currentPasswordForReset: string) => {
    await api.user.verifySensitiveAction(currentPasswordForReset);
    await api.user.resetAllEntriesAndKey();
    const key = await cryptoService.generateKey();
    const fp = await cryptoService.fingerprint(key);
    await api.user.updateKeyFingerprint(fp);
    setNewKey(key);
    await storeEncryptionKey(key, currentPasswordForReset);
  };

  const handleConfirmResetWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetPasswordError('');
    setError('');
    setResettingKey(true);

    try {
      await handleResetKey(resetPassword);
      setShowResetPasswordModal(false);
      setResetPassword('');
    } catch (error: any) {
      setResetPasswordError(error.message || 'Failed to verify password and reset key.');
      setResettingKey(false);
    }
  };

  const handleCopyNewKey = async () => {
    try {
      if (newKey) await navigator.clipboard.writeText(newKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      showError('Failed to copy key to clipboard');
    }
  };

  const handleContinueAfterReset = () => {
    setNewKey(null);
    setResettingKey(false);
    setResetPassword('');
    setResetPasswordError('');
    navigate('/');
  };

  const handleUnlockWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const restoredKey = await restoreWrappedEncryptionKey(unlockPassword);
    if (restoredKey) {
      try {
        const restoredFP = await cryptoService.fingerprint(restoredKey);
        const { key_fingerprint: storedFP } = await api.user.getKeyFingerprint();

        if (storedFP && restoredFP !== storedFP) {
          await clearEncryptionKey();
          setError('This password unlocked an old device key that is no longer valid. Enter the new encryption key.');
          setShowRawKeyInput(true);
          setLoading(false);
          return;
        }
      } catch (error: any) {
        setError(error.message || 'Failed to verify unlocked key fingerprint.');
        setLoading(false);
        return;
      }
      
      if (formData.password && formData.password !== unlockPassword) {
        await storeEncryptionKey(restoredKey, formData.password);
      }
      
      navigate('/');
    } else {
      setError('Incorrect password. Could not unlock the saved local key.');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user || authEncryptionKey) {
      setCheckingSessionUnlock(false);
      return;
    }

    let cancelled = false;
    setCheckingSessionUnlock(true);

    const verifySession = async () => {
      try {
        await api.user.getProfile();
        if (cancelled) return;
        
        const hasWrapped = await keyStorage.hasWrappedKey();
        if (cancelled) return;
        
        if (hasWrapped) {
          setHasLocalWrappedKey(true);
        } else {
          setShowRawKeyInput(true);
        }
        
        setNeedKey(true);
        setError('');
      } catch {
        if (cancelled) return;
        setNeedKey(false);
      } finally {
        if (!cancelled) {
          setCheckingSessionUnlock(false);
        }
      }
    };

    verifySession();

    return () => {
      cancelled = true;
    };
  }, [user, authEncryptionKey]);

  // Monitor authEncryptionKey from AuthContext and navigate when both are present
  useEffect(() => {
    if (authEncryptionKey && needKey && !newKey) {
      navigate('/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authEncryptionKey, needKey, newKey]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#111] p-4 font-sans relative pb-20">
      <div className="bg-zinc-900 p-12 w-full max-w-xl border-2 border-zinc-800 shadow-2xl animate-fade-in text-white">
        {checkingSessionUnlock ? (
          <>
            <div className="mb-12">
              <h1 className="text-5xl font-light text-white mb-2 tracking-tight">Journal</h1>
              <p className="text-[#0078D7] font-bold tracking-widest text-sm uppercase">Restoring Session</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-4 w-4 bg-[#0078D7] animate-pulse"></div>
              <div className="h-4 w-4 bg-[#0078D7] animate-pulse" style={{ animationDelay: '0.15s' }}></div>
              <div className="h-4 w-4 bg-[#0078D7] animate-pulse" style={{ animationDelay: '0.3s' }}></div>
              <span className="ml-2 text-sm font-bold tracking-[0.22em] uppercase text-zinc-400">
                Checking active authentication state
              </span>
            </div>
          </>
        ) : !needKey ? (
          <>
            <div className="mb-12">
              <h1 className="text-5xl font-light text-white mb-2 tracking-tight">Journal</h1>
              <p className="text-zinc-500 font-bold tracking-widest text-sm uppercase">Enter Credentials</p>
            </div>
            
            {error && (
              <div className="bg-[#E81123] text-white p-4 mb-8 font-semibold tracking-wider text-sm flex items-center gap-3">
                <span className="text-xl">⚠️</span>
                <span className="uppercase">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">
              <div>
                <label className="block text-zinc-400 text-sm font-bold tracking-wider mb-2 uppercase">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  maxLength={320}
                  className="w-full px-4 py-3 bg-zinc-800 text-white border-b-2 border-zinc-600 focus:outline-none focus:border-[#0078D7] focus:bg-zinc-700 transition-colors text-lg"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-zinc-400 text-sm font-bold tracking-wider uppercase">
                    Password
                  </label>
                  <span className="text-xs text-zinc-500 font-mono">
                    {formData.password.length}/{PASSWORD_MAX}
                  </span>
                </div>
                <PasswordInput
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  required
                  minLength={8}
                  maxLength={PASSWORD_MAX}
                  name="password"
                  autoComplete="current-password"
                  className="w-full px-4 py-3 bg-zinc-800 text-white border-b-2 border-zinc-600 focus:outline-none focus:border-[#0078D7] focus:bg-zinc-700 transition-colors text-lg"
                />
              </div>

              <div className="flex justify-center my-4">
                {/* @ts-ignore */}
                <Turnstile
                  ref={turnstileRef}
                  siteKey={(import.meta as any).env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'}
                  onSuccess={(token) => {
                    setCfToken(token);
                    setError('');
                  }}
                  onError={() => setError('Turnstile verification failed.')}
                  onExpire={() => {
                    setCfToken(null);
                    setError('Turnstile expired. Please try again.');
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !cfToken}
                className="w-full bg-[#0078D7] text-white py-4 hover:bg-[#005a9e] disabled:opacity-50 transition-colors font-bold tracking-widest uppercase text-sm mt-4"
              >
                {loading ? 'AUTHENTICATING...' : 'LOGIN'}
              </button>
            </form>

            <div className="mt-8 text-zinc-400 font-bold tracking-widest text-xs uppercase flex items-center gap-2">
              <span>NEW USER?</span>
              <Link to="/register" className="text-[#0078D7] hover:text-[#00B7C3] transition-colors">
                REGISTER DEVICE
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="mb-12">
              <h1 className="text-5xl font-light text-white mb-2 tracking-tight">Journal</h1>
              <p className="text-[#00CC6A] font-bold tracking-widest text-sm uppercase">IDENTITY VERIFIED</p>
            </div>
            
            {error && (
              <div className="bg-[#E81123] text-white p-4 mb-8 font-semibold tracking-wider text-sm flex items-center gap-3">
                <span className="text-xl">⚠️</span>
                <span className="uppercase">{error}</span>
              </div>
            )}

            {hasLocalWrappedKey && !showRawKeyInput ? (
              <form onSubmit={handleUnlockWithPassword} className="space-y-8">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-zinc-400 text-sm font-bold tracking-wider uppercase">
                      Unlock local device key
                    </label>
                  </div>
                  <PasswordInput
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    placeholder="Enter your login password"
                    required
                    maxLength={PASSWORD_MAX}
                    name="unlockPassword"
                    autoComplete="current-password"
                    className="w-full px-4 py-3 bg-zinc-800 text-white border-b-2 border-zinc-600 focus:outline-none focus:border-[#0078D7] focus:bg-zinc-700 transition-colors text-lg"
                  />
                  {formData.password ? (
                    <div className="mt-4 p-3 bg-[#FFB900]/10 border border-[#FFB900]/30 rounded">
                      <p className="text-xs text-[#FFB900] uppercase tracking-wider font-semibold leading-relaxed">
                        ⚠️ It looks like your account password was recently changed.
                        <br /><br />
                        Please enter your <strong className="text-white bg-black/50 px-1.5 py-0.5 rounded mx-1">OLD PASSWORD</strong> below to securely unlock this device's saved decryption key, and we'll automatically update it.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500 mt-3 uppercase tracking-wider font-semibold">
                      Enter your account password to securely unlock this device's saved decryption key
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-4">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#00A300] text-white py-4 hover:bg-[#008a00] transition-colors font-bold tracking-widest uppercase text-sm disabled:opacity-50"
                  >
                    {loading ? 'UNLOCKING...' : 'UNLOCK & CONTINUE'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setShowRawKeyInput(true);
                    }}
                    disabled={loading}
                    className="w-full border-2 border-zinc-500 text-zinc-400 py-4 hover:bg-zinc-800 hover:text-white transition-colors font-bold tracking-widest uppercase text-sm disabled:opacity-50"
                  >
                    ENTER RAW KEY INSTEAD
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleKeySubmit} className="space-y-8">
                <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-zinc-400 text-sm font-bold tracking-wider uppercase">
                    Decryption Key
                  </label>
                  <span className={`text-xs font-mono ${encryptionKey.length === ENCRYPTION_KEY_LENGTH ? 'text-[#00CC6A]' : 'text-zinc-500'}`}>
                    {encryptionKey.length}/{ENCRYPTION_KEY_LENGTH}
                  </span>
                </div>
                <input
                  type="text"
                  value={encryptionKey}
                  onChange={(e) => setEncryptionKey(e.target.value)}
                  required
                  maxLength={ENCRYPTION_KEY_LENGTH}
                  placeholder={`Enter your ${ENCRYPTION_KEY_LENGTH}-character encryption key`}
                  className="w-full px-4 py-3 bg-zinc-800 text-white border-b-2 border-zinc-600 focus:outline-none focus:border-[#0078D7] focus:bg-zinc-700 transition-colors font-mono text-sm"
                />
                <p className="text-xs text-zinc-500 mt-3 uppercase tracking-wider font-semibold">
                  Required to complete client-side decryption for this authenticated session
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <button
                  type="submit"
                  className="w-full bg-[#00A300] text-white py-4 hover:bg-[#008a00] transition-colors font-bold tracking-widest uppercase text-sm"
                >
                  DECRYPT & CONTINUE
                </button>

                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  disabled={resettingKey}
                  className="w-full border-2 border-[#E81123] text-[#E81123] py-4 hover:bg-[#E81123] hover:text-white transition-colors font-bold tracking-widest uppercase text-sm"
                >
                  {resettingKey ? 'PROCESSING...' : 'LOST KEY (FACTORY RESET)'}
                </button>
              </div>
            </form>
            )}

            <div className="mt-8 text-zinc-500 text-xs uppercase tracking-widest font-semibold">
              <p className="mb-2">
                <span className="text-[#E81123]">WARNING:</span> FACTORY RESET WILL DESTROY ALL EXISTING ENCRYPTED DATA.
              </p>
            </div>
          </>
        )}
      
        {newKey && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50">
            <div className="bg-[#111] border-2 border-[#E81123] w-full max-w-2xl p-12 text-center shadow-2xl animate-fade-in relative text-white">
              <div className="mb-8">
                <h2 className="text-4xl font-light text-white mb-4">Device Reset Complete</h2>
                <p className="text-zinc-400 text-lg uppercase tracking-wider font-semibold">
                  All previous local entries have been wiped
                </p>
              </div>

              <div className="mb-8">
                <label className="block text-zinc-500 mb-2 font-bold tracking-widest text-sm text-left">
                  NEW SYSTEM KEY
                </label>
                <div className="bg-black border border-zinc-800 p-6 text-xl font-mono text-[#E81123] break-all select-all text-left">
                  {newKey}
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={handleCopyNewKey}
                  className={`flex-1 py-4 font-bold tracking-widest uppercase transition-colors ${
                    keyCopied ? 'bg-[#0078D7] text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'
                  }`}
                >
                  {keyCopied ? 'COPIED!' : 'COPY KEY'}
                </button>

                <button
                  onClick={handleContinueAfterReset}
                  className="flex-1 bg-[#00A300] text-white py-4 font-bold tracking-widest uppercase hover:bg-[#008a00] transition-colors"
                >
                  INITIALIZE
                </button>
              </div>
            </div>
          </div>
        )}

        <Modal
          isOpen={showResetModal}
          onClose={() => setShowResetModal(false)}
          onConfirm={() => {
            setShowResetModal(false);
            setResetPassword('');
            setResetPasswordError('');
            setShowResetPasswordModal(true);
          }}
          title="⚠️ Factory Reset Warning"
          message="This will PERMANENTLY DELETE ALL your journal entries. A new encryption key will be generated and shown to you. This action cannot be undone. Are you sure you want to continue?"
          confirmText="RESET & DESTROY ALL DATA"
          cancelText="CANCEL"
          type="danger"
        />

        {showResetPasswordModal && (
          <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-[60] font-sans">
            <div className="w-full max-w-xl border-2 border-zinc-800 bg-[#111] text-white shadow-2xl animate-fade-in">
              <div className="h-2 w-full bg-[#FFB900]"></div>
              <div className="p-8 md:p-12">
                <p className="mb-3 text-xs font-bold tracking-[0.28em] uppercase text-[#FFB900]">DESTRUCTIVE RECOVERY</p>
                <h3 className="text-3xl font-light mb-2">Confirm Current Password</h3>
                <p className="text-zinc-400 mb-8 font-semibold tracking-wide">
                  Re-enter your current password to authorize deleting all encrypted data and generating a new key.
                </p>
                <form onSubmit={handleConfirmResetWithPassword} className="space-y-6">
                  {resetPasswordError && (
                    <div className="text-[#E81123] font-bold tracking-widest uppercase text-xs">
                      {resetPasswordError}
                    </div>
                  )}
                  <PasswordInput
                    required
                    maxLength={PASSWORD_MAX}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Current password"
                    autoComplete="current-password"
                    className="w-full bg-transparent text-white text-xl placeholder-zinc-600 border-b-2 border-zinc-700 focus:border-[#FFB900] pb-2 outline-none transition-colors"
                  />
                  <div className="flex justify-end gap-4 mt-8">
                    <button
                      type="button"
                      onClick={() => {
                        if (resettingKey) return;
                        setShowResetPasswordModal(false);
                        setResetPassword('');
                        setResetPasswordError('');
                      }}
                      className="px-8 py-3 text-zinc-400 hover:text-white font-bold tracking-widest uppercase text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={resettingKey}
                      className="bg-[#FFB900] text-black px-8 py-3 font-bold tracking-[0.22em] uppercase text-sm hover:bg-[#e5a600] disabled:opacity-50 transition-colors"
                    >
                      {resettingKey ? 'VERIFYING...' : 'VERIFY & RESET'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-6 w-full text-center text-zinc-600 font-bold tracking-widest text-xs uppercase select-none cursor-default pointer-events-none">
        from aless with love.
      </div>
    </div>
  );
};

export default Login;
