import type { Role } from '../types/auth';

/**
 * FIX: the previous version tried require('jwt-decode') first, then
 * fell back to Node's Buffer if that failed. Neither works in an
 * Electron renderer with nodeIntegration: false / contextIsolation:
 * true (correctly set in main.js) — there is no `require` and no
 * `Buffer` global in that context. Both attempts were throwing, and
 * because getDecodedToken() catches everything silently, login was
 * failing with zero visible error: the backend would report success,
 * but the token could never be decoded, so `user` stayed null forever.
 *
 * atob() is a standard browser global, always available in the
 * renderer, so this doesn't need any Node API or extra package.
 */
function decodeJwt(token: string): DecodedToken {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(jsonPayload);
}

export interface DecodedToken {
  userId: string;
  username: string;
  role: Role;
  exp: number;
}

export const setAuthToken = (token: string): void => {
  localStorage.setItem('chrs_jwt_token', token);
};

export const getAuthToken = (): string | null => {
  return localStorage.getItem('chrs_jwt_token');
};

export const removeAuthToken = (): void => {
  localStorage.removeItem('chrs_jwt_token');
};

export const getDecodedToken = (): DecodedToken | null => {
  const token = getAuthToken();
  if (!token) return null;
  try {
    return decodeJwt(token);
  } catch {
    return null;
  }
};