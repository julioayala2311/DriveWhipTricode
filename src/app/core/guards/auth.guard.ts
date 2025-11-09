import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { RoutePermissionService } from '../services/auth/route-permission.service';

export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const router = inject(Router);
  const permissions = inject(RoutePermissionService);

  if (localStorage.getItem('dw.auth.session')) {
    const targetUrl = state.url?.split('?')[0] ?? '/';
    const canRead = permissions.can(targetUrl, 'Read');
    if (!canRead) {
      router.navigate(['/error/403']);
      return false;
    }
    return true;
  }

  // If the user is not logged in, clear any stale session and redirect to the login page with the return URL
  // localStorage.removeItem('dw.auth.session');
  // localStorage.removeItem('dw.menu');
  // localStorage.removeItem('dw.routes');
  // localStorage.removeItem('dw.auth.user');
  // localStorage.removeItem('google_picture');
  // router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url.split('?')[0] } });
  // return false;

  router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url.split('?')[0] } });
  return false;
  
};
