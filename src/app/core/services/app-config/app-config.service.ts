import { Injectable } from '@angular/core';

// New simplified model (Option B): single environments map.
export interface EnvironmentEntry {
  apiBaseUrl: string;
  driveWhipCoreServiceUser: string;
  driveWhipCoreServicePassword: string;
  googleClientId: string;
  token_environment: string;
  smsDefaultFromNumber?: string;
  commonSettingsFromPhone?: string;
  [key: string]: any;
}

export interface RuntimeAppConfig {
  env: string; // Active environment name (DEV | QA | PROD)
  environments: Record<string, EnvironmentEntry>;
}

export interface GoogleAuthProviderConfig {
  domain: string;
  clientId: string;
  label?: string;
  hostedDomain?: string;
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
  get googleClientId(): string {
    const providers = this.googleAuthProviders;
    if (providers.length) {
      const configuredDefault = ((this.active as any)?.googleAuth?.defaultDomain || providers[0].domain || '').toLowerCase();
      const preferred = providers.find(p => p.domain === configuredDefault) || providers[0];
      if (preferred?.clientId) {
        return preferred.clientId;
      }
    }
    return this.active.googleClientId || '';
  }
  get token_environment(): string { return this.active.token_environment || ''; }
  get googleEnv(): string { return this.environment; } // Backward compatibility name
  get smsDefaultFromNumber(): string {
    const value = (this.active.smsDefaultFromNumber || "").toString().trim();
    return value || "";
  }

  /**
   * Code to pass into the common_settings stored procedure
   * to retrieve the default SMS "from" phone number.
   * Defaults to "NotificationFromPhone" if not configured.
   */
  get commonSettingsFromPhone(): string {
    const val = (this.active.commonSettingsFromPhone || "NotificationFromPhone").toString().trim();
    return val || "NotificationFromPhone";
  }

  get googleAuthProviders(): GoogleAuthProviderConfig[] {
    const entry: any = (this.active as any)?.googleAuth;
    const fallbackId = this.active.googleClientId || '';
    if (!entry) {
      if (!fallbackId) return [];
      return [{ domain: 'drivewhip.com', clientId: fallbackId, label: 'drivewhip.com', hostedDomain: 'drivewhip.com' }];
    }
    const providersRaw: any[] = Array.isArray(entry.providers) ? entry.providers : [];
    const mapped = providersRaw
      .map((raw) => {
        const domain = (raw?.domain || '').toString().toLowerCase();
        const clientId = (raw?.clientId || fallbackId || '').toString();
        if (!domain || !clientId) return null;
        return {
          domain,
          clientId,
          label: raw?.label || raw?.displayName || domain,
          hostedDomain: (raw?.hostedDomain ?? domain)
        } as GoogleAuthProviderConfig;
      })
      .filter(Boolean) as GoogleAuthProviderConfig[];

    if (!mapped.length && fallbackId) {
      const defaultDomain = (entry.defaultDomain || 'drivewhip.com').toString().toLowerCase();
      mapped.push({ domain: defaultDomain, clientId: fallbackId, label: defaultDomain, hostedDomain: defaultDomain });
    }

    return mapped;
  }

  get googleAllowedDomains(): string[] {
    if (!this.googleEnforceDomainRestriction) {
      return [];
    }
    return this.googleAuthProviders.map(p => p.domain.toLowerCase());
  }

  get googleEnforceDomainRestriction(): boolean {
    const entry: any = (this.active as any)?.googleAuth;
    if (entry && typeof entry.enforceDomainRestriction === 'boolean') {
      return entry.enforceDomainRestriction;
    }
    // Default to true when provider metadata exists to avoid accidentally relaxing prod
    return true;
  }

  resolveGoogleClientId(domain?: string): string {
    if (!domain) {
      return this.googleClientId;
    }
    const normalized = domain.toLowerCase();
    const match = this.googleAuthProviders.find(p => p.domain === normalized);
    return match?.clientId || this.googleClientId;
  }
}