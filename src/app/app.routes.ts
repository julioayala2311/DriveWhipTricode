import { Routes } from '@angular/router';
import { BaseComponent } from './views/layout/base/base.component';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: 'auth', loadChildren: () => import('./views/admin/pages/auth/auth.routes')},
   // 🔹 Opening fuera del BaseComponent (sin menú)
  {
    path: 'opening', // <-- corrige el typo si quieres (antes: 'openning')
    loadChildren: () => import('./views/applicants/pages/opening/opening.routes')
   // canActivate: [authGuard]
  },
 
  // 🔹 Openings catalog (SIN menú)
  {
    path: 'openings/catalog',
    loadChildren: () =>
      import('./views/applicants/pages/openings-catalog/opening-catalog.routes')
    // canActivate: [authGuard] // opcional
  },
  {
    path: '',
    component: BaseComponent,
    canActivateChild: [authGuard],
    children: [
      { path: '', redirectTo: 'rideshare', pathMatch: 'full' },
      {
        path: 'rideshare',
        loadChildren: () => import('./views/admin/pages/rideshare/rideShare.routes')
      },
      {
        path: 'icons',
        loadChildren: () => import('./views/icons/icons.routes')
      },
      {
        path: 'users/accounts',
        loadChildren: () => import('./views/admin/pages/users/accounts/user-accounts.routes')
      },
      {
        path: 'users/roles',
        loadChildren: () => import('./views/admin/pages/users/roles/user-roles.routes')
      },
    ]
  },
  {
    path: 'error',
    loadComponent: () => import('./views/error/error.component').then(c => c.ErrorComponent),
  },
  {
    path: 'error/:type',
    loadComponent: () => import('./views/error/error.component').then(c => c.ErrorComponent)
  },
  { path: '**', redirectTo: 'error/404', pathMatch: 'full' }
];
