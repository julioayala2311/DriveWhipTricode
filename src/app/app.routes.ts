import { Routes } from '@angular/router';
import { BaseComponent } from './views/layout/base/base.component';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: 'auth', loadChildren: () => import('./views/admin/pages/auth/auth.routes')},
   // Opening outside BaseComponent (no menu shell)
  {
    path: 'opening', // <-- corrige el typo si quieres (antes: 'openning')
    loadChildren: () => import('./views/applicants/pages/opening/opening.routes')
   // canActivate: [authGuard]
  },
 
  // Openings catalog (no menu shell)
  {
    path: 'openings/catalog',
    loadChildren: () =>
      import('./views/applicants/pages/openings-catalog/opening-catalog.routes')
  // canActivate: [authGuard] // optional
  },
  {
    path: '',
    component: BaseComponent,
    canActivateChild: [authGuard],
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      {
        path: 'locations',
        loadChildren: () => import('./views/admin/pages/locations/locations.routes')
      },
      {
        path: 'home',
        loadChildren: () => import('./views/admin/pages/home/home.routes')
      },
      {
        path: 'workflows',
        loadChildren: () => import('./views/admin/pages/workflows/workflows.routes')
      },
      {
        path: 'messenger',
        loadChildren: () => import('./views/admin/pages/messenger/messenger.routes')
      },
      {
        path: 'configuration/templates',
        loadChildren: () => import('./views/admin/pages/templates/templates.routes')
      },
      {
        path: 'applicants',
        loadChildren: () => import('./views/admin/pages/applicants/applicants.routes')
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
