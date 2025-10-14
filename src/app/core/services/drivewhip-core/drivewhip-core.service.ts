import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
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
  // Simple dedupe for repeated error toasts
  private lastErrorToast: { message: string | null; ts: number } = { message: null, ts: 0 };

  private get baseUrl() { return this.appConfig.apiBaseUrl; }

  get serviceUser(): string { return this.appConfig.driveWhipCoreServiceUser; }
  get servicePassword(): string { return this.appConfig.driveWhipCoreServicePassword; }
  get siteBaseUrl(): string { return this.appConfig.get<string>('siteBaseUrl', ''); }
  get accountCreatedTemplateId(): string { return this.appConfig.get<string>('accountCreatedTemplateId', ''); }

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
      map(res => {
        // Detect wrapped stored procedure error pattern: any nested object containing throwMessageTricode
        let toastShown = false;
        const msg = this.extractTricodeError(res as any);
        if (msg) {
          const clean = msg.replace(/^Error:\s*/i, '').trim();
          this.safeShowErrorToast(clean || 'Unexpected error');
          toastShown = true;
          try { (res as any).ok = false; (res as any).error = clean || msg; } catch { /* ignore */ }
        }
        // If backend already flags ok=false with an error string, surface it.
        const r: any = res as any;
        if (!toastShown && r && r.ok === false && typeof r.error === 'string' && r.error.trim()) {
          this.safeShowErrorToast(r.error.trim());
          toastShown = true;
        }
        return res;
      }),
      catchError(err => this.handleError(err))
    );
  }

  login(user: string, secret: string): Observable<any> {
    const url = this.baseUrl + 'auth/login';
    const body = { user, secret };
    const headers = new HttpHeaders({
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    });
    return this.http.post(url, body, { headers }).pipe(
      catchError(err => this.handleError(err))
    );
  }

  /**
   * Build absolute URL to fetch a file from S3 via API gateway
   * Example result: {baseUrl}Files/{folder}/{fileName}
   */
  getFileUrl(folder: string, fileName: string): string {
    const safeFolder = encodeURIComponent(folder || '');
    const safeName = encodeURIComponent(fileName || '');
    return `${this.baseUrl}Files/${safeFolder}/${safeName}`;
  }

  /**
   * Fetch a file as Blob from the Files endpoint. Useful for previews or downloads.
   */
  fetchFile<T = any>(folder: string, fileName: string): Observable<T> {
    const url = this.getFileUrl(folder, fileName);
    return this.http.get<T>(url, { headers: this.buildHeaders() }).pipe(
      map(res => {
        // Detect wrapped stored procedure error pattern: any nested object containing throwMessageTricode
        let toastShown = false;
        const msg = this.extractTricodeError(res as any);
        if (msg) {
          const clean = msg.replace(/^Error:\s*/i, '').trim();
          this.safeShowErrorToast(clean || 'Unexpected error');
          toastShown = true;
          try { (res as any).ok = false; (res as any).error = clean || msg; } catch { /* ignore */ }
        }
        // If backend already flags ok=false with an error string, surface it.
        const r: any = res as any;
        if (!toastShown && r && r.ok === false && typeof r.error === 'string' && r.error.trim()) {
          this.safeShowErrorToast(r.error.trim());
          toastShown = true;
        }
        return res;
      }),
    );
  }

  /**
   * Send an email using a server-side template
   * POST {baseUrl}Email/send-template
   * Body: { title, message, templateId, to: string[] }
   */
  sendTemplateEmail(params: { title: string; message: string; templateId: string; to: string[] }): Observable<any> {
    const url = this.baseUrl + 'Email/send-template';
    // Basic validation to avoid obvious 400s
    const payload = {
      title: params.title ?? '',
      message: params.message ?? '',
      templateId: params.templateId ?? '',
      to: Array.isArray(params.to) ? params.to : []
    };
    return this.http.post(url, payload, { headers: this.buildHeaders() }).pipe(
      map(res => res),
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
            localStorage.removeItem('dw.auth.session');
            localStorage.removeItem('dw.menu');
            localStorage.removeItem('dw.routes');
            localStorage.removeItem('dw.auth.user');
            localStorage.removeItem('google_picture');
            this.handlingUnauthorized = false;
          });
        }, 800);
      }
    }

    return throwError(() => ({ message, status, raw: error }));
  }

  /** Recursively search response payload for throwMessageTricode field */
  private extractTricodeError(payload: any): string | null {
    if (!payload) return null;
    const visited = new Set<any>();
    const stack: any[] = [payload];
    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (visited.has(current)) continue;
      visited.add(current);
      if (Object.prototype.hasOwnProperty.call(current, 'throwMessageTricode')) {
        const val = current['throwMessageTricode'];
        if (typeof val === 'string' && val.trim()) return val;
      }
      // Traverse arrays & plain objects
      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
      } else {
        for (const key of Object.keys(current)) {
          stack.push(current[key]);
        }
      }
    }
    return null;
  }

  /** Show error toast with basic throttling to prevent spam of the same message */
  private safeShowErrorToast(message: string) {
    const now = Date.now();
    if (this.lastErrorToast.message === message && (now - this.lastErrorToast.ts) < 1500) {
      return; // skip duplicate within 1.5s
    }
    this.lastErrorToast = { message, ts: now };
    Utilities.showToast(message, 'error');
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