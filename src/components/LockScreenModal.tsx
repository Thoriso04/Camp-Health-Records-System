import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

interface LockScreenModalProps {
  isLocked: boolean;
  onUnlock: () => void;
}

export const LockScreenModal: React.FC<LockScreenModalProps> = ({ isLocked, onUnlock }) => {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!isLocked) return null;

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'password123') {
      setPassword('');
      setError('');
      onUnlock();
    } else {
      setError('Invalid password to unlock session');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-sm w-full p-6 text-center">
        <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-3 font-bold text-lg">
          ??
        </div>
        <h2 className="text-lg font-bold text-slate-800">Session Locked</h2>
        <p className="text-xs text-slate-500 mb-4">
          Inactivity detected. Enter password for <strong>{user?.username}</strong> to continue.
        </p>

        <form onSubmit={handleUnlock} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full border border-slate-300 rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
          <button
            type="submit"
            className="w-full bg-indigo-600 text-white text-sm font-semibold py-2 rounded hover:bg-indigo-700 transition"
          >
            Unlock Application
          </button>
        </form>
      </div>
    </div>
  );
};
