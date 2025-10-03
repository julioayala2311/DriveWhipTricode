import { Component, OnInit, signal, computed } from '@angular/core';
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
  private readonly _roles = signal<string[]>([]); // active role names
  private gridApi?: GridApi;

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
    { headerName: 'First Name', field: 'firstname', minWidth: 140, sortable: true, filter: true },
    { headerName: 'Last Name', field: 'lastname', minWidth: 140, sortable: true, filter: true },
    { headerName: 'Role', field: 'role', minWidth: 130, sortable: true, filter: true },
    { headerName: 'Active', field: 'active', minWidth: 110, cellRenderer: (p:any)=> this.activeBadge(p.value), sortable: true, filter: true },
    { headerName: 'Actions', field: 'actions', minWidth: 150, pinned: 'right', sortable:false, filter:false, cellRenderer: (p: any) => this.actionButtons(p.data), cellClass:'dw-actions-cell' }
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
    e.api.sizeColumnsToFit();
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
      commandName: DriveWhipAdminCommand.auth_roles_crud,
      parameters: ['R', null, null, null]
    };
    this.core.executeCommand<DriveWhipCommandResponse<RoleRecord>>(api).subscribe({
      next: res => {
        if (!res.ok) return; // silencioso
        let raw: any = [];
        if (Array.isArray(res.data)) {
          const top = res.data as any[];
            if (top.length > 0 && Array.isArray(top[0])) raw = top[0]; else raw = top;
        }
        const list: RoleRecord[] = Array.isArray(raw) ? raw : [];
        const active = list.filter(r => r && r.role && r.isactive === 1).map(r => r.role.trim());
        // quitar duplicados
        const uniq = Array.from(new Set(active.map(r => r.toLowerCase())));
        // mantener casing original del primero encontrado
        const finalRoles: string[] = [];
        uniq.forEach(lower => {
          const original = active.find(r => r.toLowerCase() === lower);
          if (original) finalRoles.push(original);
        });
        this._roles.set(finalRoles.sort((a,b)=> a.localeCompare(b)));
      },
      error: () => { /* ignorar error de roles para no romper UI cuentas */ }
    });
  }

  // Dialog
  openCreate(): void {
    this._dialogMode.set('create');
    this._editing.set(null);
    this._dialogOpen.set(true);
  }

  openEdit(rec: UserAccountRecord): void {
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
    this._saving.set(true);
    this.mutate(action, {
      user: result.user,
      token: '',
      firstname: result.firstname,
      lastname: result.lastname,
      role: result.role,
      active: result.active ? 1 : 0
    });
  }

  delete(rec: UserAccountRecord): void {
    Utilities.confirm({
      title: 'Disable account',
      text: `The user \"${rec.user}\" will be disabled. Continue?`,
      confirmButtonText: 'Disable'
    }).then(c => {
      if (!c) return;
      this.mutate('D', rec);
    });
  }

  private mutate(action: 'C'|'U'|'D', rec: UserAccountRecord) {
    this._loading.set(true);
    const sessionToken = this.core.getCachedToken();
    const params: any[] = [
      action,
      rec.user,
      sessionToken || null,
      rec.firstname,
      rec.lastname,
      rec.role,
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
    return `
      <div class="d-flex gap-1">
        <button class="btn btn-xs btn-outline-secondary" type="button" data-action="edit">Edit</button>
        <button class="btn btn-xs btn-outline-danger" type="button" data-action="delete" ${disabled ? 'disabled' : ''}>Disable</button>
      </div>`;
  }

  private activeBadge(value: any): string {
    const active = value === 1 || value === true;
    const cls = active
      ? 'badge text-bg-success bg-success-subtle text-success fw-medium px-2 py-1'
      : 'badge text-bg-danger bg-danger-subtle text-danger fw-medium px-2 py-1';
    return `<span class="${cls}" style="font-size:11px; letter-spacing:.5px;">${active ? 'Active' : 'Inactive'}</span>`;
  }
}
