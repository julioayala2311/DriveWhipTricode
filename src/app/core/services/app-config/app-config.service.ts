import { Injectable } from '@angular/core';

// New simplified model (Option B): single environments map.
export interface EnvironmentEntry {
  apiBaseUrl: string;
  driveWhipCoreServiceUser: string;
  driveWhipCoreServicePassword: string;
  googleClientId: string;
  token_environment: string;
  [key: string]: any;
}

export interface RuntimeAppConfig {
  env: string; // Active environment name (DEV | QA | PROD)
  environments: Record<string, EnvironmentEntry>;
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private config: RuntimeAppConfig | null = null;
  private activeEnv: string = 'DEV';

  load(): Promise<void> {
    return fetch('app-config.json', { cache: 'no-cache' })
      .then(async r => {
        if (!r.ok) throw new Error('Failed to load app-config.json');
        const json = await r.json();
        this.config = json as RuntimeAppConfig;

        // Query param override (?env=QA)
        try {
          const qpEnv = new URL(window.location.href).searchParams.get('env');
          if (qpEnv) this.config.env = qpEnv.toUpperCase();
        } catch { /* ignore */ }

        this.activeEnv = (this.config.env || 'DEV').toUpperCase();
        if (!this.config.environments?.[this.activeEnv]) {
          console.warn('[AppConfigService] Active environment entry missing:', this.activeEnv);
        }
      });
  }

  // Accessors for the active environment entry
  private get active(): EnvironmentEntry {
    if (!this.config) return {} as any;
    return this.config.environments?.[this.activeEnv] || ({} as any);
  }

  /**
   * Generic accessor preserved for backward compatibility.
   * Looks up a property in the active environment entry and returns a fallback if missing.
   */
  get<T = any>(key: string, fallback?: T): T {
    const value = (this.active as any)[key];
    return (value !== undefined && value !== null) ? value as T : (fallback as T);
  }

  get environment(): string { return this.activeEnv; }

  get apiBaseUrl(): string {
    let url = this.active.apiBaseUrl || '';
    if (url && !url.endsWith('/')) url += '/';
    return url;
  }

  get driveWhipCoreServiceUser(): string { return this.active.driveWhipCoreServiceUser || ''; }
  get driveWhipCoreServicePassword(): string { return this.active.driveWhipCoreServicePassword || ''; }
  get googleClientId(): string { return this.active.googleClientId || ''; }
  get token_environment(): string { return this.active.token_environment || ''; }
  get googleEnv(): string { return this.environment; } // Backward compatibility name
}