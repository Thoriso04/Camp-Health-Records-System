import type { Role } from '../types/auth';

declare const require: any;
let jwtDecode: any;
try {
  const jwtDecodeModule = typeof require === 'function' ? require('jwt-decode') : undefined;
  jwtDecode = jwtDecodeModule?.jwtDecode || jwtDecodeModule;
  if (!jwtDecode) throw new Error('jwt-decode not available');
} catch {
  jwtDecode = (token: string) => {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString());
  };
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
    return jwtDecode(token);
  } catch {
    return null;
  }
};