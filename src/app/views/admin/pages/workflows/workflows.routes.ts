import { Routes } from '@angular/router';

export default [
    {
        path: '',
        loadComponent: () => import('./workflows.component').then(c => c.WorkFlowsComponent),
    }
] as Routes;