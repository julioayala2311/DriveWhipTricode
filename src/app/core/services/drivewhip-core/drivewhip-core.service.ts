import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppConfigService } from '../app-config/app-config.service';
import { CryptoService } from '../crypto/crypto.service';
import { Utilities } from '../../../Utilities/Utilities';

export const AUTH_TOKEN_STORAGE_KEY = 'dw.auth.session';
export const AUTH_USER_STORAGE_KEY = 'dw.auth.user';

/**
 * DriveWhipCoreService
 * Abstraction to interact with DriveWhipCoreAPI using the /api/v1/execute endpoint.
 */
@Injectable({ providedIn: 'root' })
export class DriveWhipCoreService {
  private http = inject(HttpClient);
  private appConfig = inject(AppConfigService);
  private crypto = inject(CryptoService);
  private router = inject(Router);

  // Flag to avoid multiple parallel logout redirects
  private handlingUnauthorized = false;

  private get baseUrl() { return this.appConfig.apiBaseUrl; }

  get serviceUser(): string { return this.appConfig.driveWhipCoreServiceUser; }
  get servicePassword(): string { return this.appConfig.driveWhipCoreServicePassword; }

  getCachedToken(): string | null {
    const encrypted = this.readFromStorage(AUTH_TOKEN_STORAGE_KEY);
    if (!encrypted) return null;
    return this.crypto.decrypt<string>(encrypted);
  }

  cacheToken(token: string): void {
    const encrypted = this.crypto.encrypt(token);
    this.writeToStorage(AUTH_TOKEN_STORAGE_KEY, encrypted);
  }

  cacheUserProfile(payload: unknown): void {
    const encrypted = this.crypto.encrypt(payload);
    this.writeToStorage(AUTH_USER_STORAGE_KEY, encrypted);
  }

  /** Build common headers */
  private buildHeaders(extra?: Record<string,string>): HttpHeaders {
    let headers = new HttpHeaders({
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    });

    const storedToken = this.getCachedToken();
    if (storedToken) {
      headers = headers.set('Authorization', `Bearer ${storedToken}`);
    }
   
    if (extra) Object.entries(extra).forEach(([k,v]) => headers = headers.set(k, v));
    return headers;
  }

  /** Generic command execution request */
  executeCommand<T = any>(object: any): Observable<T> {
    const url = this.baseUrl + 'execute';
    return this.http.post<T>(url, object, { headers: this.buildHeaders() }).pipe(
      catchError(err => this.handleError(err))
    );
  }

  login(email: string, password: string): Observable<any> {
    const url = this.baseUrl + 'auth/login';
    const body = { email, password };
    const headers = new HttpHeaders({
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    });
    return this.http.post(url, body, { headers }).pipe(
      catchError(err => this.handleError(err))
    );
  }

  clearCachedAuth(): void {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  }

  /** Centralized error handling */
  private handleError(error: HttpErrorResponse) {
    const status = error.status;
    const message = error.error?.message || error.statusText || 'Unknown error';
    console.error('[DriveWhipCoreService] API error:', error);

    if (status === 401) {
      // Session expired / unauthorized: clear local auth and redirect to login
      if (!this.handlingUnauthorized) {
        this.handlingUnauthorized = true;
        try { this.clearCachedAuth(); } catch {}
  // Show unified toast and redirect (small delay to let user notice it)
        Utilities.showToast('Session expired. Please sign in again.', 'warning', { timer: 4000 });
        setTimeout(() => {
          this.router.navigate(['/auth/login']).finally(() => {
            this.handlingUnauthorized = false;
          });
        }, 800);
      }
    }

    return throwError(() => ({ message, status, raw: error }));
  }

  private readFromStorage(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch (err) {
      console.warn(`[DriveWhipCoreService] Unable to read ${key} from storage`, err);
      return null;
    }
  }

  private writeToStorage(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.warn(`[DriveWhipCoreService] Unable to write ${key} to storage`, err);
    }
  }
}