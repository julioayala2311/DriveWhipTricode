import { Injectable, signal } from '@angular/core';
import { CryptoService } from '../crypto/crypto.service';
import { AUTH_USER_STORAGE_KEY, AUTH_TOKEN_STORAGE_KEY, DriveWhipCoreService } from '../drivewhip-core/drivewhip-core.service';
import { UserAccountRecord } from '../../models/user-account.model';

/**
 * AuthSessionService
 * Centralizes access to the decrypted user profile stored in localStorage (dw.auth.user)
 * to avoid repeated decryption and provide a consistent signal-based API.
 *
 * Features:
 *  - Decrypts only once during construction (lazy if key absent)
 *  - Exposes a readonly signal for the current user
 *  - Listens for storage events to sync multiple tabs
 *  - Helpers for role checks and safe retrieval
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly currentUserSig = signal<UserAccountRecord | null>(null);
  /** Returns current user snapshot (or null) */
  get user(): UserAccountRecord | null { return this.currentUserSig(); }
  /** Readonly signal for templates */
  readonly userSignal = this.currentUserSig.asReadonly();

  constructor(private crypto: CryptoService, private core: DriveWhipCoreService) {
    this.loadFromStorage();
    this.bindStorageEvents();
  }

  /** Attempts to decrypt and load profile from localStorage */
  private loadFromStorage(): void {
    try {
      const encrypted = localStorage.getItem(AUTH_USER_STORAGE_KEY);
      if (!encrypted) { this.currentUserSig.set(null); return; }
      const profile = this.crypto.decrypt<UserAccountRecord>(encrypted);
      if (profile && typeof profile.user === 'string') {
        this.currentUserSig.set(profile);
      } else {
        this.currentUserSig.set(null);
      }
    } catch (err) {
      console.warn('[AuthSessionService] loadFromStorage error', err);
      this.currentUserSig.set(null);
    }
  }

  /** Updates profile in memory + encrypted persistence */
  updateUser(profile: UserAccountRecord): void {
    if (!profile) return;
    this.core.cacheUserProfile(profile); // reutiliza encrypt + storage central
    this.currentUserSig.set(profile);
  }

  /** Clears session (token + profile) */
  clear(): void {
    try {
      localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    } catch {}
    this.currentUserSig.set(null);
  }

  /** Active user flag (active === 1) */
  get isActive(): boolean { return !!this.user && this.user.active === 1; }
  /** Human-readable full name */
  get displayName(): string { return this.user ? `${this.user.firstname} ${this.user.lastname}`.trim() : ''; }
  /** Current role */
  get role(): string | null { return this.user?.role ?? null; }
  /** Role equality check (case insensitive) */
  hasRole(role: string): boolean { return (this.user?.role || '').toLowerCase() === role.toLowerCase(); }

  /** Ensures user exists (throws if null) */
  requireUser(): UserAccountRecord {
    const u = this.user;
    if (!u) throw new Error('No authenticated user loaded');
    return u;
  }

  /** Storage subscription to sync multiple tabs */
  private bindStorageEvents(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('storage', (ev) => {
      if (ev.key === AUTH_USER_STORAGE_KEY) {
        this.loadFromStorage();
      }
    });
  }
}
