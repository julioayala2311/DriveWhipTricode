import { Routes } from '@angular/router';

export default [
    {
        path: '',
        loadComponent: () => import('./home.component').then(c => c.HomeComponent),
    }
] as Routes;