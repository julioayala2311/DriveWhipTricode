import { Routes } from '@angular/router';

export default [
    {
        path: '',
        loadComponent: () => import('./locations.component').then(c => c.LocationsComponent),
    }
] as Routes;