import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { DriveWhipCoreService } from '../services/drivewhip-core/drivewhip-core.service';
import { DriveWhipAdminCommand } from '../db/procedures';
import { IDriveWhipCoreAPI, DriveWhipCommandResponse } from '../models/entities.model';
import { firstValueFrom, timeout, catchError, of } from 'rxjs';

/**
 * workflowGuard
 * Basic server-side existence check before allowing access to /workflows/edit/:id.
 * Hardens against casual URL tampering. If invalid or not found, redirect to /workflows.
 *
 * NOTE: For stronger authorization, the backend must also enforce per-user access.
 */
export const workflowGuard: CanActivateFn = async (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const router = inject(Router);
  const core = inject(DriveWhipCoreService);

  const rawId = route.paramMap.get('id');
  if (!rawId) {
    router.navigate(['/workflows']);
    return false;
  }
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) {
    router.navigate(['/workflows']);
    return false;
  }

  // Query minimal data; reuse existing SP and filter client-side (consider backend single fetch for efficiency).
  const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_workflows_list, parameters: [] };
  try {
    const res = await firstValueFrom(
      core.executeCommand<DriveWhipCommandResponse>(api).pipe(
        timeout({ each: 8000 }),
        catchError(() => of({ ok: false } as any))
      )
    );
    if (!res?.ok) {
      router.navigate(['/workflows']);
      return false;
    }
    let rows: any[] = [];
    if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : res.data as any[];
    const exists = rows.some(r => r?.id_workflow === id);
    if (!exists) {
      router.navigate(['/workflows']);
      return false;
    }
    return true;
  } catch {
    router.navigate(['/workflows']);
    return false;
  }
};
