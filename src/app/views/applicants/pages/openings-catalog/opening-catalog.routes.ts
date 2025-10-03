import { Routes } from '@angular/router';

export default [
    {
        path: '',
        loadComponent: () => import('./openings-catalog.component').then(c => c.OpeningsCatalogComponent),
    }
] as Routes;