import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';

export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const router = inject(Router);

  if (localStorage.getItem('dw.auth.session')) {
    // If the user has session, also validate route permission from stored routes
    try {
      const raw = localStorage.getItem('dw.routes');
      if (!raw) return true; // no ACL stored yet, allow
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows)) return true;
      const requested = state.url.split('?')[0];
      // Build allowed paths: include top-level and composed parent+child
      const all = rows.map((r: any) => ({
        id_route: Number(r.id_route),
        parent_id: r.parent_id != null ? Number(r.parent_id) : null,
        path: String(r.path || ''),
        is_active: r.is_active === 1 || r.is_active === '1' || r.is_active === true,
        is_menu: r.is_menu === 1 || r.is_menu === '1' || r.is_menu === true,
        // New: respect assignment flag (default true if missing for backward compatibility)
        is_assigned: (r.is_assigned === 0 || r.is_assigned === '0' || r.is_assigned === false) ? false : true
      }));
      const activeAssigned = all.filter(r => r.is_active && r.is_assigned);
      // Parent lookup should use all rows to be able to compose full paths even if parent is not assigned
      const byId = new Map<number, any>();
      all.forEach(r => byId.set(r.id_route, r));
      const allowed = new Set<string>();
      for (const r of activeAssigned) {
        if (!r.parent_id) {
          allowed.add(r.path);
        } else {
          const parent = byId.get(r.parent_id);
          if (parent) {
            const full = (parent.path.endsWith('/') || r.path.startsWith('/')) ? (parent.path + r.path) : (parent.path + r.path);
            allowed.add(full);
          } else {
            // fallback to child path if parent missing
            allowed.add(r.path);
          }
        }
      }
      if (allowed.has(requested)) {
        return true;
      }
      // Not allowed, clear session and redirect to login
      localStorage.removeItem('dw.auth.session');
      localStorage.removeItem('dw.menu');
      localStorage.removeItem('dw.routes');
      localStorage.removeItem('dw.auth.user');
      localStorage.removeItem('google_picture');
      router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url.split('?')[0] } });
      return false;
    } catch {
      return true; // on parsing error, do not block
    }
  }

  // If the user is not logged in, clear any stale session and redirect to the login page with the return URL
  localStorage.removeItem('dw.auth.session');
  localStorage.removeItem('dw.menu');
  localStorage.removeItem('dw.routes');
  localStorage.removeItem('dw.auth.user');
  localStorage.removeItem('google_picture');
  router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url.split('?')[0] } });
  return false;
  
};
