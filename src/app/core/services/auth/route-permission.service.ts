import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

export type RoutePermissionAction = 'Create' | 'Read' | 'Update' | 'Delete';

export interface StoredRoutePermission {
  path: string;
  Create?: number | boolean;
  Read?: number | boolean;
  Update?: number | boolean;
  Delete?: number | boolean;
  [key: string]: unknown;
}

const STORAGE_KEY = 'dw.routes';

@Injectable({ providedIn: 'root' })
export class RoutePermissionService {
  constructor(private router: Router) {}

  /** Snapshot of permissions parsed from localStorage */
  private get permissions(): StoredRoutePermission[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({ ...item })) as StoredRoutePermission[];
    } catch (err) {
      console.warn('[RoutePermissionService] Failed to parse dw.routes', err);
      return [];
    }
  }

  /** Returns true when any stored permission allows the action for the provided path */
  can(pathOrUrl: string, action: RoutePermissionAction): boolean {
    const normalized = this.normalizePath(pathOrUrl);
    const perms = this.permissions;
    if (!perms.length) return false;
    const matches = this.findBestMatch(normalized, perms);
    if (!matches) return false;
    return this.valueToBool(matches[action]);
  }

  /** Equivalent to can(current router.url, action) */
  canCurrent(action: RoutePermissionAction): boolean {
    const url = this.router.url;
    return this.can(url, action);
  }

  ensure(pathOrUrl: string, action: RoutePermissionAction): boolean {
    const allowed = this.can(pathOrUrl, action);
    if (!allowed) {
      console.warn('[RoutePermissionService] Missing permission', { pathOrUrl, action });
    }
    return allowed;
  }

  ensureCurrent(action: RoutePermissionAction): boolean {
    return this.ensure(this.router.url, action);
  }

  private findBestMatch(path: string, permissions: StoredRoutePermission[]): StoredRoutePermission | null {
    if (!path) return null;
    // Try exact match first
    let current = permissions.find((perm) => this.normalizePath(perm.path) === path);
    if (current) return current;

    // Walk up the segments removing the last one until a match is found
    const segments = path.split('/').filter(Boolean);
    while (segments.length > 0) {
      segments.pop();
      const partial = '/' + segments.join('/');
      current = permissions.find((perm) => this.normalizePath(perm.path) === partial);
      if (current) return current;
    }

    // Final fallback: look for root path '/'
    const rootMatch = permissions.find((perm) => this.normalizePath(perm.path) === '/');
    return rootMatch ?? null;
  }

  private normalizePath(path: unknown): string {
    if (typeof path !== 'string') return '';
    try {
      const [clean] = path.split('?');
      return clean.replace(/\/+$/, '').trim() || '/';
    } catch {
      return '';
    }
  }

  private valueToBool(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
    return false;
  }
}
