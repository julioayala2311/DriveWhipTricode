import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, CellClickedEvent } from 'ag-grid-community';
import { DriveWhipCoreService } from '../../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipAdminCommand } from '../../../../../core/db/procedures';
import { IDriveWhipCoreAPI, DriveWhipCommandResponse } from '../../../../../core/models/entities.model';
import { UserAccountRecord } from '../../../../../core/models/user-account.model';
import { RoleRecord } from '../../../../../core/models/role.model';
import { Utilities } from '../../../../../Utilities/Utilities';
import { FormsModule } from '@angular/forms';
import { AccountDialogComponent, AccountDialogResult } from './account-dialog.component';
import { RoutePermissionAction, RoutePermissionService } from '../../../../../core/services/auth/route-permission.service';
import { switchMap } from 'rxjs/operators';

@Component({
  selector: 'dw-user-accounts',
  standalone: true,
  imports: [CommonModule, AgGridAngular, FormsModule, AccountDialogComponent],
  templateUrl: './user-accounts.component.html'
})
export class UserAccountsComponent implements OnInit {
  // Signals
  private readonly _loading = signal(false);
  private readonly _records = signal<UserAccountRecord[]>([]);
  private readonly _error = signal<string | null>(null);
  private readonly _dialogOpen = signal(false);
  private readonly _dialogMode = signal<'create' | 'edit'>('create');
  private readonly _editing = signal<UserAccountRecord | null>(null);
  private readonly _saving = signal(false);
  private readonly _roles = signal<RoleRecord[]>([]); // active roles with Id
  private gridApi?: GridApi;
  private readonly permissions = inject(RoutePermissionService);

  private readonly ADMIN_ROLES = new Set([
    'ADMIN'
  ]);

  // Derived lists
  readonly usernames = computed(() => this._records().map(r => r.user.toLowerCase()));

  // Computed
  readonly loading = computed(() => this._loading());
  readonly error = computed(() => this._error());
  readonly records = computed(() => this._records());
  readonly showDialog = computed(() => this._dialogOpen());
  readonly dialogMode = computed(() => this._dialogMode());
  readonly saving = computed(() => this._saving());
  readonly editingRecord = computed(() => this._editing());
  readonly roles = computed(() => this._roles());

  // Columns
  columnDefs: ColDef[] = [
    { headerName: 'User', field: 'user', minWidth: 170, flex: 1, sortable: true, filter: true },
    { headerName: 'First Name', field: 'firstname', minWidth: 140, flex: .9, sortable: true, filter: true },
    { headerName: 'Last Name', field: 'lastname', minWidth: 140, flex: .9, sortable: true, filter: true },
    { headerName: 'Role', field: 'role', minWidth: 130, flex: .7, sortable: true, filter: true },
    { headerName: 'Active', field: 'active', minWidth: 110, flex: .55, cellRenderer: (p:any)=> this.activeBadge(p.value), sortable: true, filter: true },
    { headerName: 'Actions', field: 'actions', minWidth: 140, maxWidth: 180, pinned: 'right', sortable:false, filter:false, cellRenderer: (p: any) => this.actionButtons(p.data), cellClass:'dw-actions-cell' }
  ];

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    floatingFilter: true,
    resizable: true,
    wrapHeaderText: true,
    autoHeaderHeight: true,
    suppressHeaderMenuButton: true
  };

  pageSize = 25;
  pageSizeOptions = [10,25,50,100];

  constructor(private core: DriveWhipCoreService) {}

  ngOnInit(): void {
    this.load();
    this.loadRoles();
  }

  onGridReady(e: GridReadyEvent) {
    this.gridApi = e.api;
  // With flex columns we avoid sizeColumnsToFit to allow proportional distribution.
  }

  onGridCellKeyDown(event: any): void {
    const key = (event.event as KeyboardEvent)?.key?.toLowerCase?.() || '';
    const ctrl = (event.event as KeyboardEvent)?.ctrlKey || (event.event as KeyboardEvent)?.metaKey;
    if (ctrl && key === 'c') {
      const api = event.api;
      const ranges = (api as any).getCellRanges?.() || [];
      if (ranges && ranges.length && (api as any).copySelectedRangeToClipboard) {
        try { (api as any).copySelectedRangeToClipboard({ includeHeaders: true }); return; } catch {}
      }
      const selectedRows = api.getSelectedRows?.() || [];
      if (selectedRows.length) {
        try { api.copySelectedRowsToClipboard({ includeHeaders: true }); return; } catch {}
      }
      const value = (event.value ?? '').toString();
      if (value) navigator.clipboard?.writeText(value).catch(() => {});
    }
  }

  load(): void {
    this._loading.set(true);
    this._error.set(null);
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.auth_users_crud,
      // Read all -> pass null for username and null for optional fields
      parameters: ['R', null, null, null, null, null, null]
    };
    this.core.executeCommand<DriveWhipCommandResponse<UserAccountRecord>>(api).subscribe({
      next: res => {
        if (!res.ok) {
          const msg = String(res.error || 'Failed to load accounts');
          this._error.set(msg);
          Utilities.showToast(msg, 'error');
          this._loading.set(false);
          return;
        }
        let raw: any = [];
        if (res.ok && Array.isArray(res.data)) {
          const top = res.data as any[];
          if (top.length > 0 && Array.isArray(top[0])) raw = top[0]; else raw = top;
        }
        const list: UserAccountRecord[] = Array.isArray(raw) ? raw : [];
        const cleaned = list.filter(r => r && r.user); // basic filter
        this._records.set(cleaned);
      },
      error: err => {
        console.error('[UserAccountsComponent] load error', err);
        const msg = 'Failed to load accounts';
        this._error.set(msg);
        Utilities.showToast(msg, 'error');
      },
      complete: () => this._loading.set(false)
    });
  }

  private loadRoles(): void {
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.auth_roles_crud_v2,
      // v2 signature: (action, id_role, role, description, active)
      parameters: ['R', null, null, null, null]
    };
    this.core.executeCommand<DriveWhipCommandResponse<RoleRecord>>(api).subscribe({
      next: res => {
        if (!res.ok) return; // silencioso
        let raw: any = [];
        if (Array.isArray(res.data)) {
          const top = res.data as any[];
            if (top.length > 0 && Array.isArray(top[0])) raw = top[0]; else raw = top;
        }
        const list: RoleRecord[] = (Array.isArray(raw) ? raw : []) as RoleRecord[];
        const activeRoles = list.filter(r => r && r.role && ((r as any).isactive === 1 || (r as any).isactive === true || String((r as any).isactive).toLowerCase() === 'true'));
        // sort by role name for UX
        activeRoles.sort((a,b)=> (a.role || '').localeCompare(b.role || ''));
        this._roles.set(activeRoles);
      },
  error: () => { /* ignore roles load error to avoid breaking accounts UI */ }
    });
  }

  private getRoleIdByName(name: string | undefined | null): number | null {
    const n = (name || '').trim().toLowerCase();
    if (!n) return null;
    const found = this._roles().find(r => (r.role || '').trim().toLowerCase() === n);
    return found?.Id ?? null;
  }

  // Dialog
  openCreate(): void {
    if (!this.hasPermission('Create')) {
      Utilities.showToast('You do not have permission to create accounts.', 'warning');
      return;
    }
    this._dialogMode.set('create');
    this._editing.set(null);
    this._dialogOpen.set(true);
  }

  openEdit(rec: UserAccountRecord): void {
    if (!this.hasPermission('Update')) {
      Utilities.showToast('You do not have permission to edit accounts.', 'warning');
      return;
    }
    this._dialogMode.set('edit');
    this._editing.set(rec);
    this._dialogOpen.set(true);
  }

  closeDialog(): void {
    if (this._saving()) return;
    this._dialogOpen.set(false);
  }

  handleDialogSave(result: AccountDialogResult) {
    if (this._saving()) return;
    const mode = this._dialogMode();
    const action: 'C'|'U' = mode === 'create' ? 'C' : 'U';
    if ((action === 'C' && !this.hasPermission('Create')) || (action === 'U' && !this.hasPermission('Update'))) {
      Utilities.showToast('You do not have permission to perform this action.', 'warning');
      return;
    }
    this._saving.set(true);
    this.mutate(action, {
      user: result.user,
      token: '',
      // firstname: result.firstname,
      // lastname: result.lastname,
      firstname: '',
      lastname: '',
      roleId: result.roleId,
      role: result.role || '',
      active: result.active ? 1 : 0
    });
  }

  private isAdminRole(rec: UserAccountRecord): boolean {
    const role = (rec?.role ?? '').toString().trim().toUpperCase();
    return this.ADMIN_ROLES.has(role);
  }

  delete(rec: UserAccountRecord): void {

    // Bloquear deshabilitar a cuentas administrador
    if (this.isAdminRole(rec)) {
      Utilities.showToast('Administrator accounts cannot be disabled.', 'warning');
      return;
    }

    if (!this.hasPermission('Delete')) {
      Utilities.showToast('You do not have permission to disable accounts.', 'warning');
      return;
    }

    Utilities.confirm({
      title: 'Disable account',
      text: `The user \"${rec.user}\" will be disabled. Continue?`,
      confirmButtonText: 'Disable',
      allowOutsideClick: false,
    }).then(c => {
      if (!c) return;
      this.mutate('D', rec);
    });
  }

  private mutate(action: 'C'|'U'|'D', rec: any) {
    const required: Record<'C'|'U'|'D', RoutePermissionAction> = { C: 'Create', U: 'Update', D: 'Delete' };
    const needed = required[action];
    if (!this.hasPermission(needed)) {
      Utilities.showToast('You do not have permission to perform this action.', 'warning');
      this._saving.set(false);
      this._loading.set(false);
      return;
    }
    this._loading.set(true);
    const sessionToken = this.core.getCachedToken();
    const roleIdToSend: number | null = (rec.roleId != null ? Number(rec.roleId) : this.getRoleIdByName(rec.role)) ?? null;
    const params: any[] = [
      action,
      rec.user,
      action === 'C' ? null : rec.token,
      rec.firstname,
      rec.lastname,
      roleIdToSend?.toString() || null,
      action === 'D' ? null : rec.active
    ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.auth_users_crud, parameters: params };
    this.core.executeCommand<DriveWhipCommandResponse<UserAccountRecord>>(api).subscribe({
      next: res => {
        if (!res.ok) {
          const msg = String(res.error || 'Action failed');
          this._error.set(msg);
          Utilities.showToast(msg, 'error');
          this._loading.set(false);
          this._saving.set(false);
          return;
        }
        Utilities.showToast(action === 'C' ? 'Account created' : action === 'U' ? 'Account updated' : 'Account disabled', 'success');
        this._saving.set(false);
        this.closeDialog();
        this.load();

        if (action === 'C') {
          const siteUrl = this.core.siteBaseUrl || '';
          const templateId = this.core.accountCreatedTemplateId || '';
          const title = 'Your DriveWhip account is ready';
          const message = `<p>Hello,</p><p>We have created your DriveWhip account. You can now sign in and get started.</p><p><br><a href="${siteUrl}" style="display:inline-block;padding:10px 16px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:6px;font-weight:600" target="_blank" rel="noopener noreferrer">Go to DriveWhip</a><br></p><p>If the button doesn’t work, copy and paste this link into your browser:<br><span style="color:#1a73e8">${siteUrl}</span></p><p>Welcome aboard!</p>`;
          this.core
            .prepareNotificationMessage('email', null, message)
            .pipe(
              switchMap((prepared) => {
                const finalMessage = (prepared && prepared.trim()) ? prepared : message;
                return this.core.sendTemplateEmail({
                  title,
                  message: finalMessage,
                  templateId,
                  to: [rec.user]
                });
              })
            )
            .subscribe({
              next: () => Utilities.showToast('Welcome email sent', 'success'),
              error: (err) => {
                console.error('[UserAccountsComponent] welcome email error', err);
                Utilities.showToast('Failed to send welcome email', 'error');
              }
            });
        }
      },
      error: err => {
        console.error('[UserAccountsComponent] mutate error', err);
        const msg = 'Action failed';
        this._error.set(msg);
        Utilities.showToast(msg, 'error');
        this._saving.set(false);
        this._loading.set(false);
      }
    });
  }

  onCellClicked(e: CellClickedEvent) {
    if (e.colDef.field !== 'actions') return;
    if (!e.event) return;
    const target = (e.event.target as HTMLElement | null);
    if (!target) return;
    const btn = target.closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const rec = e.data as UserAccountRecord;
    if (!rec) return;
    if (action === 'edit') this.openEdit(rec);
    else if (action === 'delete') this.delete(rec);
  }

  private actionButtons(rec: UserAccountRecord) {
    if (!rec) return '';
    const disabled = rec.active === 0;
    const canEdit = this.hasPermission('Update');
    const canDelete = this.hasPermission('Delete');
    return `
      <div class="d-flex gap-1">
        <button class="btn btn-xs btn-outline-secondary" type="button" data-action="edit" ${canEdit ? '' : 'disabled'}>Edit</button>
        <button class="btn btn-xs btn-outline-danger" type="button" data-action="delete" ${(!canDelete || disabled) ? 'disabled' : ''}>Disable</button>
      </div>`;
  }

  hasPermission(action: RoutePermissionAction): boolean {
    return this.permissions.canCurrent(action);
  }

  private activeBadge(value: any): string {
    const active = value === 1 || value === true;
    const cls = active
      ? 'badge text-bg-success bg-success-subtle text-success fw-medium px-2 py-1'
      : 'badge text-bg-danger bg-danger-subtle text-danger fw-medium px-2 py-1';
    return `<span class="${cls}" style="font-size:11px; letter-spacing:.5px;">${active ? 'Active' : 'Inactive'}</span>`;
  }
}
