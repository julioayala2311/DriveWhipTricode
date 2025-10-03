import { Routes } from "@angular/router";

export default [
  { path: '', redirectTo: 'feather', pathMatch: 'full' },
  {
    path: 'feather-icons',
    loadComponent: () => import('./feather/feather.component').then(c => c.FeatherComponent)
  },
] as Routes;