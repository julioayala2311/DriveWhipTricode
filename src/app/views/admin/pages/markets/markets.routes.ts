import { Routes } from '@angular/router';

export default [
    {
        path: '',
        loadComponent: () => import('./markets.component').then(c => c.MarketsComponent),
    }
] as Routes;