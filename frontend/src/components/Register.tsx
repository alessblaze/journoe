import { useState, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import { cryptoService } from '../crypto';
import { Link, useNavigate } from 'react-router-dom';
import PasswordInput from './PasswordInput';
import Turnstile, { TurnstileHandle } from './Turnstile';

const USERNAME_MAX = 64;
const PASSWORD_MAX = 72;

const Register = () => {
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [pendingUser, setPendingUser] = useState<any>(null);
  
  const [cfToken, setCfToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const { register, storeEncryptionKey, setUser } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!cfToken) {
      setError('Please complete the turnstile challenge first.');
      setLoading(false);
      return;
    }

    const result = await register(formData.email, formData.username, formData.password, cfToken);

    if (result.success) {
      try {
        const key = await cryptoService.generateKey();
        const fp = await cryptoService.fingerprint(key);
        await api.user.updateKeyFingerprint(fp);
        await storeEncryptionKey(key, formData.password);
        // Store the user for committing after the key is acknowledged
        if (result.user) {
          localStorage.setItem('user', JSON.stringify(result.user));
          setPendingUser(result.user);
        }
        setEncryptionKey(key);
      } catch (error: any) {
        setError(error.message || 'Failed to initialize encryption key');
      } finally {
        setLoading(false);
      }
    } else {
      setError(result.error || 'Registration failed');
      setLoading(false);
      // Reset turnstile on failure so user can try again
      setCfToken(null);
      turnstileRef.current?.reset();
    }
  };

  const handleCopyKey = () => {
    if (encryptionKey) navigator.clipboard.writeText(encryptionKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const handleProceedToLogin = () => {
    // Commit the user to React AuthContext state now that the key screen is done.
    // Doing it here (not during registration) prevents React Router from
    // immediately unmounting this component before the key can be displayed.
    if (pendingUser && setUser) setUser(pendingUser);
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#111] p-4 font-sans relative pb-20">
      <div className="bg-zinc-900 p-12 w-full max-w-xl border-2 border-zinc-800 shadow-2xl animate-fade-in text-white">
        {!encryptionKey ? (
          <>
            <div className="mb-12">
              <h1 className="text-5xl font-light text-white mb-2 tracking-tight">Journal</h1>
              <p className="text-zinc-500 font-bold tracking-widest text-sm uppercase">Device Initialization</p>
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
                    Username
                  </label>
                  <span className="text-xs text-zinc-500 font-mono">
                    {formData.username.length}/{USERNAME_MAX}
                  </span>
                </div>
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  required
                  minLength={3}
                  maxLength={USERNAME_MAX}
                  className="w-full px-4 py-3 bg-zinc-800 text-white border-b-2 border-zinc-600 focus:outline-none focus:border-[#0078D7] focus:bg-zinc-700 transition-colors text-lg"
                  placeholder="Choose an alias"
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
                  placeholder="Enter system password"
                  required
                  minLength={8}
                  maxLength={PASSWORD_MAX}
                  name="password"
                  autoComplete="new-password"
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
                {loading ? 'INITIALIZING...' : 'REGISTER DEVICE'}
              </button>
            </form>

            <div className="mt-8 text-zinc-400 font-bold tracking-widest text-xs uppercase flex items-center gap-2">
              <span>MEMBER?</span>
              <Link to="/login" className="text-[#0078D7] hover:text-[#00B7C3] transition-colors">
                LOGIN TO SYSTEM
              </Link>
            </div>
          </>
        ) : (
          <div className="text-left">
            <div className="mb-12">
              <h1 className="text-4xl font-light text-white mb-2 tracking-tight">System Secured</h1>
              <p className="text-[#00A300] font-bold tracking-widest text-sm uppercase">Generate Decryption Key</p>
            </div>

            <p className="text-zinc-400 mb-8 uppercase font-semibold text-sm tracking-wider leading-relaxed">
              This master key uniquely encrypts your data locally. If you lose this key, you lose your data.
            </p>

            <div className="mb-8">
              <label className="block text-zinc-500 mb-2 font-bold tracking-widest text-sm">
                YOUR UNIQUE KEY
              </label>
              <div className="bg-black border border-zinc-800 p-6 text-xl font-mono text-[#00A300] break-all select-all">
                {encryptionKey}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <button
                onClick={handleCopyKey}
                className={`w-full py-4 font-bold tracking-widest uppercase transition-colors ${
                  keyCopied ? 'bg-[#0078D7] text-white' : 'bg-zinc-800 text-white hover:bg-zinc-700'
                }`}
              >
                {keyCopied ? 'COPIED TO CLIPBOARD' : 'COPY KEY'}
              </button>

              <button
                onClick={() => { void handleProceedToLogin(); }}
                className="w-full bg-[#00A300] text-white py-4 font-bold tracking-widest uppercase hover:bg-[#008a00] transition-colors"
              >
                LAUNCH SYSTEM
              </button>
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

export default Register;
