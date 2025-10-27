import { Routes } from '@angular/router';

export default [
  {
    path: '',
    loadComponent: () => import('./messenger.component').then((c) => c.MessengerComponent)
  }
] as Routes;
