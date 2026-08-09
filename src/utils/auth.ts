export interface DecodedToken {
  userId: string;
  username: string;
  role: string;
  exp: number;
}

const base64UrlDecode = (base64Url: string): string => {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
  const decoded = atob(padded);
  return decodeURIComponent(
    decoded
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
};

const decodeJwt = <T>(token: string): T => {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid JWT token');
  }
  return JSON.parse(base64UrlDecode(parts[1])) as T;
};

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
    return decodeJwt<DecodedToken>(token);
  } catch {
    return null;
  }
};
