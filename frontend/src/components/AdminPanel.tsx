import { useState, useEffect } from 'react';
import { api } from '../api';
import { User } from '../types';
import PasswordInput from './PasswordInput';
import Modal from './Modal';

const PASSWORD_MAX = 72;

const AdminPanel = ({ onClose }: { onClose: () => void }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [regEnabled, setRegEnabled] = useState(true);

  // Password reset state
  const [resetUserId, setResetUserId] = useState<string | number | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // Delete confirmation state
  const [deleteUserId, setDeleteUserId] = useState<string | number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [usersData, configData] = await Promise.all([
        api.admin.getUsers(),
        api.admin.getConfig()
      ]);
      setUsers(usersData);
      if (configData.registration_enabled) {
        setRegEnabled(configData.registration_enabled === 'true');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const toggleRegistration = async () => {
    try {
      const newValue = !regEnabled;
      await api.admin.updateConfig({ registration_enabled: newValue.toString() });
      setRegEnabled(newValue);
      showSuccess(`Registration ${newValue ? 'Enabled' : 'Disabled'}`);
    } catch (err: any) {
      setError('Failed to update registration status: ' + err.message);
    }
  };

  const handleDeleteUser = async (id: string | number) => {
    setDeleteUserId(id);
  };

  const confirmDeleteUser = async () => {
    if (!deleteUserId) return;
    try {
      await api.admin.deleteUser(deleteUserId);
      setUsers(users.filter(u => u.id !== deleteUserId));
      showSuccess('User deleted successfully');
      setDeleteUserId(null);
    } catch (err: any) {
      setError('Failed to delete user: ' + err.message);
      setDeleteUserId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUserId || !newPassword) return;
    try {
      await api.admin.updatePassword(resetUserId, newPassword);
      setResetUserId(null);
      setNewPassword('');
      showSuccess('Password reset successfully');
    } catch (err: any) {
      setError('Password reset failed: ' + err.message);
    }
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 3000);
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex overflow-hidden font-sans animate-fade-in">
      {/* Sidebar Navigation (Metro Settings styled) */}
      <div className="w-64 border-r border-zinc-800 bg-[#111] flex flex-col pt-12">
        <div className="px-8 mb-12">
          <h2 className="text-3xl font-light text-white tracking-tight">System</h2>
        </div>
        <div className="flex flex-col">
          <button className="px-8 py-4 text-left font-bold text-[#0078D7] border-l-4 border-[#0078D7] bg-white/5 tracking-widest uppercase text-sm">
            Users & Config
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-12 bg-zinc-950 relative">
        <button
          onClick={onClose}
          className="absolute top-0 right-0 p-8 text-zinc-500 hover:text-white transition-colors"
          title="Return to Dashboard"
        >
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="max-w-4xl">
          <h1 className="text-5xl font-light tracking-tight text-white mb-12">Admin Panel</h1>

          {error && (
            <div className="mb-8 p-6 bg-[#E81123] text-white font-bold tracking-wide">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-8 p-6 bg-[#00A300] text-white font-bold tracking-wide animate-fade-in">
              {success}
            </div>
          )}

          {/* Master Registration Switch */}
          <div className="mb-16">
            <h3 className="text-xl font-light text-white mb-6">Global Access</h3>
            <div className="bg-[#111] p-8 border border-zinc-800 flex items-center justify-between">
              <div>
                <h4 className="text-lg font-bold text-white tracking-wide">New Account Registration</h4>
                <p className="text-zinc-400 text-sm mt-1">Allow anonymous users to sign up for new accounts.</p>
              </div>
              <button
                onClick={toggleRegistration}
                className={`px-8 py-3 font-bold tracking-widest uppercase text-sm transition-colors ${
                  regEnabled ? 'bg-[#0078D7] text-white hover:bg-[#005a9e]' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                {regEnabled ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>
          </div>

          {/* User Roster */}
          <div>
            <h3 className="text-xl font-light text-white mb-6">User Roster</h3>
            
            {loading ? (
              <div className="text-zinc-500 font-semibold tracking-widest uppercase">Fetching Records...</div>
            ) : (
              <div className="grid gap-2">
                {users.map(user => (
                  <div key={user.id} className="bg-[#111] border border-zinc-800 p-6 flex items-center justify-between group hover:border-zinc-600 transition-colors">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="text-white font-bold text-lg">{user.username}</span>
                        {user.is_admin && <span className="bg-[#0078D7] text-white text-xs px-2 py-0.5 font-bold tracking-wider">ADMIN</span>}
                      </div>
                      <span className="text-zinc-400 text-sm">{user.email}</span>
                    </div>

                    <div className="flex gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setResetUserId(user.id)}
                        className="text-white hover:text-[#FFB900] font-bold text-sm tracking-widest uppercase transition-colors"
                      >
                        Reset PW
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        disabled={user.is_admin} // Prevents deleting other admins through the UI
                        className={`font-bold text-sm tracking-widest uppercase transition-colors ${
                          user.is_admin ? 'text-zinc-600 cursor-not-allowed' : 'text-[#E81123] hover:text-[#ff3b4b]'
                        }`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Password Reset Modal Overlay */}
          {resetUserId && (
            <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-[60] font-sans">
              <div className="w-full max-w-xl border-2 border-zinc-800 bg-[#111] shadow-2xl animate-fade-in">
                <div className="h-2 w-full bg-[#FFB900]"></div>
                <div className="p-8 md:p-12">
                  <p className="mb-3 text-xs font-bold tracking-[0.28em] uppercase text-[#FFB900]">ADMIN OVERRIDE</p>
                  <h3 className="text-3xl font-light text-white mb-2">Override Password</h3>
                  <p className="text-zinc-400 mb-8 font-semibold tracking-wide">Forcibly change the credentials for this user.</p>
                  <form onSubmit={handleResetPassword} className="space-y-8">
                    <div className="flex items-center justify-between -mb-4">
                      <span className="text-xs text-zinc-500 font-mono">{newPassword.length}/{PASSWORD_MAX}</span>
                    </div>
                    <PasswordInput
                      required
                      minLength={8}
                      maxLength={PASSWORD_MAX}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New Password (8-72 chars)"
                      className="w-full bg-transparent text-white text-xl placeholder-zinc-600 border-b-2 border-zinc-700 focus:border-[#FFB900] pb-2 outline-none transition-colors"
                    />
                    <div className="flex justify-end gap-4 mt-8">
                      <button
                        type="button"
                        onClick={() => { setResetUserId(null); setNewPassword(''); }}
                        className="px-8 py-3 text-zinc-400 hover:text-white font-bold tracking-widest uppercase text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="bg-[#FFB900] text-black px-8 py-3 font-bold tracking-[0.22em] uppercase text-sm hover:bg-[#e5a600] transition-colors"
                      >
                        Enforce Change
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}

          <Modal
            isOpen={deleteUserId !== null}
            onClose={() => setDeleteUserId(null)}
            onConfirm={confirmDeleteUser}
            title="Delete User"
            message="WARNING: This will permanently delete this user and ALL their journal entries. Proceed?"
            confirmText="DELETE USER"
            cancelText="CANCEL"
            type="danger"
          />
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
