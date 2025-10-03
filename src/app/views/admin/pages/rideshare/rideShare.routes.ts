import { Routes } from '@angular/router';

export default [
    {
        path: '',
        loadComponent: () => import('./rideShare.component').then(c => c.RideShareComponent),
    }
] as Routes;