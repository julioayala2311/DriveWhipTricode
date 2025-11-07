import { Routes } from '@angular/router';

export default [
    {
        path: '',
        loadComponent: () => import('./homeconfig.component').then(c => c.HomeConfigComponent),
    }
] as Routes;
