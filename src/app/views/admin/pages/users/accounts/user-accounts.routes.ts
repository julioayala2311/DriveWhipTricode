import { Routes } from '@angular/router';

export default [
  {
    path: '',
    loadComponent: () => import('./user-accounts.component').then(c => c.UserAccountsComponent)
  }
] as Routes;
