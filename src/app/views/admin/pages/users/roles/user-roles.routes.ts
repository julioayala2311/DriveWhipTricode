import { Routes } from '@angular/router';

export default [
  {
    path: '',
    loadComponent: () => import('./user-roles.component').then(c => c.UserRolesComponent)
  }
] as Routes;
