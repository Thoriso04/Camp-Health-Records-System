import { jwtDecode } from 'jwt-decode';

export interface DecodedToken {
  userId: string;
  username: string;
  role: string;
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
    return jwtDecode<DecodedToken>(token);
  } catch {
    return null;
  }
};
