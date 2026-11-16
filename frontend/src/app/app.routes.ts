import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
  {
    path: 'dashboard',
    component: DashboardComponent,
  },
  {
    path: 'dashboard/:tab',
    component: DashboardComponent,
  },
  // Shortcuts for existing tabs
  {
    path: 'watchers',
    redirectTo: 'dashboard/watchers',
    pathMatch: 'full',
  },
  {
    path: 'story',
    redirectTo: 'dashboard/story',
    pathMatch: 'full',
  },
  {
    path: 'raw-news',
    redirectTo: 'dashboard/raw-news',
    pathMatch: 'full',
  },
  {
    path: 'articles',
    redirectTo: 'dashboard/articles',
    pathMatch: 'full',
  },
  {
    path: 'pings',
    redirectTo: 'dashboard/pings',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
