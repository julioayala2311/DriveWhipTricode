// src/app/core/utils/jwt.ts
export interface JwtClaims {
  sub?: string;
  name?: string;
  email?: string;
  exp?: number; // epoch seconds
  iat?: number;
  aud?: string | string[];
  iss?: string;
  scope?: string;
  roles?: string[];               // a veces viene así
  [k: string]: any;               // otros claims custom
}

/** Decodifica Base64URL de forma segura (maneja padding y unicode) */
function b64urlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4 || 4)) % 4, '=');
  const bin = atob(padded);
  // manejar unicode
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Devuelve los claims del token o null si algo falla */
export function decodeJwt<T extends object = JwtClaims>(token: string | null | undefined): T | null {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const json = b64urlDecode(parts[1]);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Expirado (con tolerancia opcional en segundos) */
export function isJwtExpired(claims: JwtClaims | null, skewSec = 60): boolean {
  if (!claims?.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return now >= (claims.exp - skewSec);
}

/** Extrae roles sin importar el proveedor (Keycloak/Cognito/propio) */
export function getJwtRoles(claims: any): string[] {
  if (!claims) return [];
  if (Array.isArray(claims.roles)) return claims.roles;
  if (claims.realm_access?.roles) return claims.realm_access.roles;           // Keycloak
  if (Array.isArray(claims['cognito:groups'])) return claims['cognito:groups']; // AWS Cognito
  if (typeof claims.role === 'string') return [claims.role];
  if (typeof claims.scope === 'string') return claims.scope.split(' ');
  return [];
}
