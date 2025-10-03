import { Routes } from '@angular/router';

export default [
    {
        path: '',
        loadComponent: () => import('./opening.component').then(c => c.OpeningComponent),
    }
] as Routes;