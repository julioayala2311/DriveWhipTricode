import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, CellClickedEvent } from 'ag-grid-community';
import { DriveWhipCoreService } from '../../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipAdminCommand } from '../../../../../core/db/procedures';
import { IDriveWhipCoreAPI, DriveWhipCommandResponse } from '../../../../../core/models/entities.model';
import { RoleRecord } from '../../../../../core/models/role.model';
import { RoleDialogComponent, RoleDialogResult } from './index';
import { Observable, tap, catchError, finalize, map, of } from 'rxjs';
import { Utilities } from '../../../../../Utilities/Utilities';

// User Roles management grid (ag-Grid integration)

@Component({
  selector: 'dw-user-roles',
  standalone: true,
  imports: [CommonModule, AgGridAngular, RoleDialogComponent],
  templateUrl: './user-roles.component.html',
  styleUrls: ['./user-roles.component.scss']
})
export class UserRolesComponent implements OnInit, OnDestroy {
  // Signals (Angular 16+) for reactive state
  private readonly _loading = signal(false);
  private readonly _roles = signal<RoleRecord[]>([]);
  private readonly _error = signal<string | null>(null);
  private readonly _dialogOpen = signal(false);
  private readonly _dialogMode = signal<'create' | 'edit'>('create');
  private readonly _editingRecord = signal<RoleRecord | null>(null);
  private readonly _saving = signal(false);
  private readonly _compactActions = signal(false); // viewport-based
  private pendingActionColWidth: number | null = null;

  // Exposed (if needed later)
  readonly compactActions = computed(() => this._compactActions());

  // Exposed computed signals
  readonly loading = computed(() => this._loading());
  readonly roles = computed(() => this._roles());
  readonly error = computed(() => this._error());
  readonly showDialog = computed(() => this._dialogOpen());
  readonly dialogMode = computed(() => this._dialogMode());
  readonly editingRecord = computed(() => this._editingRecord());
  readonly saving = computed(() => this._saving());
  readonly roleNames = computed(() => this._roles().map(r => r.role.toLowerCase()));

  // ag-Grid column definitions
  columnDefs: ColDef[] = [
    { headerName: 'Role', field: 'role', minWidth: 160, flex: 1, sortable: true, filter: true },
    { headerName: 'Description', field: 'description', minWidth: 240, flex: 1.4, sortable: true, filter: true },
    { headerName: 'Created', field: 'createdat', minWidth: 160, flex: .9, valueFormatter: p => this.formatDate(p.value), sortable: true },
	  { headerName: 'Active', field: 'isactive', minWidth: 120, flex: .6, sortable: true, filter: true, cellRenderer: (p:any)=> this.renderActiveBadge(p.value) },
    { headerName: 'Actions', field: 'actions', minWidth: 140, maxWidth: 180, pinned: 'right', sortable:false, filter:false, cellRenderer: (p: any) => this.actionButtons(p.data), cellClass: 'dw-actions-cell' }
  ];

  // Align default column behavior with applicants grid (sortable/filterable/floating filters, responsive headers)
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
  private gridApi?: GridApi;

  constructor(private core: DriveWhipCoreService) {}

  ngOnInit(): void {
    this.loadRoles();
    this.evaluateViewport();
    window.addEventListener('resize', this._onResize, { passive: true });
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this._onResize as any);
  }

  private _onResize = () => {
    this.evaluateViewport();
  };

  private evaluateViewport(): void {
    const compact = window.innerWidth < 640; // breakpoint ~sm
    const prev = this._compactActions();
    if (prev !== compact) {
      this._compactActions.set(compact);
      this.adjustActionsColumnWidth();
    } else if (!this.gridApi) {
      // store desired width until grid ready
      this.pendingActionColWidth = compact ? 90 : 160;
    }
  }

  private adjustActionsColumnWidth(): void {
    const width = this._compactActions() ? 90 : 160;
    if (!this.gridApi) { this.pendingActionColWidth = width; return; }
    const col = this.gridApi.getColumn('actions');
    if (col) {
      this.gridApi.setColumnWidth(col, width);
    }
  }

  loadRoles(): void {
    this._loading.set(true);
    this._error.set(null);
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.auth_roles_crud,
      // IMPORTANT: pass null (NOT empty string) for p_role so SP enters ELSE branch and returns all
      // Also p_active not used on R, send null to avoid confusion
      parameters: ['R', null, null, null]
    };
    this.core.executeCommand<DriveWhipCommandResponse<RoleRecord>>(api).subscribe({
      next: res => {
        if (!res.ok) {
          const msg: string = (res.error as any) ? String(res.error) : 'Failed to load roles';
          this._error.set(msg);
          Utilities.showToast(msg, 'error');
          this._loading.set(false);
          return;
        }
        let raw: any = [];
        if (res.ok && Array.isArray(res.data)) {
          // Some backends (e.g. mysql2 / stored procedure calls) return: [ [ rows ], fields ] or simply [ [ rows ] ]
          // Our API seems to already strip fields but still wraps rows in an extra array.
            const top = res.data as any[];
            if (top.length > 0 && Array.isArray(top[0])) {
              raw = top[0];
            } else {
              raw = top; // fallback if already flat
            }
        }
        const list: RoleRecord[] = Array.isArray(raw) ? raw : [];
        // Filter out potential empty placeholder objects
        const cleaned = list.filter(r => r && Object.values(r).some(v => v !== null && v !== undefined && String(v).trim() !== ''));
        this._roles.set(cleaned as RoleRecord[]);
      },
      error: err => {
        console.error('[UserRolesComponent] loadRoles error', err);
        const msg = 'Failed to load roles';
        this._error.set(msg);
        Utilities.showToast(msg, 'error');
      },
      complete: () => this._loading.set(false)
    });
  }

  onGridReady(e: GridReadyEvent) {
    this.gridApi = e.api;
  // With flex columns we no longer need sizeColumnsToFit; allow natural dynamic sizing
    if (this.pendingActionColWidth) {
      const col = this.gridApi.getColumn('actions');
      if (col) this.gridApi.setColumnWidth(col, this.pendingActionColWidth);
      this.pendingActionColWidth = null;
    } else {
      this.adjustActionsColumnWidth();
    }
  }

  // CRUD placeholders
  onCreate(): void {
    this._dialogMode.set('create');
    this._editingRecord.set(null);
    this._dialogOpen.set(true);
  }

  onEdit(record: RoleRecord): void {
    this._dialogMode.set('edit');
    this._editingRecord.set(record);
    this._dialogOpen.set(true);
  }

  onDelete(record: RoleRecord): void {
    if (!record) return;
    if (record.isactive !== 1) return; // already inactive, button will be disabled too
    Utilities.confirm({
      title: 'Disable role',
      text: `The role "${record.role}" will be disabled. Continue?`,
      confirmButtonText: 'Disable',
      icon: 'warning'
    }).then(ok => {
      if (!ok) return;
      this.mutate('D', record.role).subscribe({
        next: success => { if (success) Utilities.showToast('Role disabled', 'success'); },
        error: err => {
          console.error('[UserRolesComponent] delete error', err);
          const msg = 'Failed to disable role';
          this._error.set(msg);
          Utilities.showToast(msg, 'error');
        }
      });
    });
  }

  closeDialog(): void {
    if (this._saving()) return; // avoid closing while saving
    this._dialogOpen.set(false);
  }

  handleDialogSave(result: RoleDialogResult): void {
    if (this._saving()) return;
    const mode = this._dialogMode();
    const isCreate = mode === 'create';
    const action: 'C'|'U' = isCreate ? 'C' : 'U';
    this._saving.set(true);
    this.mutate(action, result.role, result.description, result.isActive ? 1 : 0)
      .pipe(finalize(() => this._saving.set(false)))
      .subscribe({
        next: success => {
          if (success) {
            // liberar estado de guardado antes de cerrar para que el guard no bloquee
            this._saving.set(false);
            this.closeDialog();
            Utilities.showToast(isCreate ? 'Role created' : 'Role updated', 'success');
          }
        },
        error: err => {
          console.error('[UserRolesComponent] save error', err);
          const msg = 'Failed to save role';
          this._error.set(msg);
          Utilities.showToast(msg, 'error');
        }
      });
  }

  private mutate(action: 'C'|'U'|'D', role: string, description: string = '', isActive: number | null = null): Observable<boolean> {
    this._loading.set(true);
    const effectiveIsActive = action === 'D' ? null : isActive;
    const params: any[] = [action, role, description, effectiveIsActive];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.auth_roles_crud, parameters: params };
    return this.core.executeCommand<DriveWhipCommandResponse<RoleRecord>>(api).pipe(
      tap(res => {
        if (!res.ok) {
          const msg: string = (res.error as any) ? String(res.error) : 'Action failed';
          this._error.set(msg);
          Utilities.showToast(msg, 'error');
          this._loading.set(false);
          return;
        }
        this.loadRoles();
      }),
      map(res => !!res.ok),
      catchError(err => {
        console.error('[UserRolesComponent] mutate error', err);
        const msg = 'Action failed';
        this._loading.set(false);
        this._error.set(msg);
        Utilities.showToast(msg, 'error');
        return of(false);
      })
    );
  }

  onCellClicked(e: CellClickedEvent) {
    if (e.colDef.field !== 'actions') return;
    if (!e.event) return;
    const target = (e.event.target as HTMLElement | null);
    if (!target) return;
    const button = target.closest('button[data-action]') as HTMLButtonElement | null;
    if (!button) return;
    const action = button.getAttribute('data-action');
    const record = e.data as RoleRecord;
    if (!record) return;
    if (action === 'edit') this.onEdit(record);
    else if (action === 'delete') this.onDelete(record);
  }

  private actionButtons(record: RoleRecord) {
    if (!record) return '';
    const compact = this._compactActions();
    const inactive = record.isactive !== 1;
    if (compact) {
      return `
        <div class="d-flex gap-1 justify-content-end">
          <button class="btn btn-xs btn-outline-secondary dw-icon-btn" type="button" data-action="edit" title="Edit ${record.role}" aria-label="Edit ${record.role}">
            <i class="feather icon-edit"></i>
          </button>
          <button class="btn btn-xs btn-outline-danger dw-icon-btn" type="button" data-action="delete" title="${inactive ? 'Already inactive' : 'Disable ' + record.role}" aria-label="Disable ${record.role}" ${inactive ? 'disabled' : ''}>
            <i class="feather icon-slash"></i>
          </button>
        </div>`;
    }
    return `
      <div class="d-flex gap-1 justify-content-end">
        <button class="btn btn-xs btn-outline-secondary" type="button" data-action="edit" data-role="${record.role}">Edit</button>
        <button class="btn btn-xs btn-outline-danger" type="button" data-action="delete" data-role="${record.role}" ${inactive ? 'disabled' : ''}>Disable</button>
      </div>`;
  }

  private renderActiveBadge(value: any): string {
    const active = value === 1 || value === true;
    const cls = active
      ? 'badge text-bg-success bg-success-subtle text-success fw-medium px-2 py-1'
      : 'badge text-bg-danger bg-danger-subtle text-danger fw-medium px-2 py-1';
    const label = active ? 'Active' : 'Inactive';
    return `<span class="${cls}" style="font-size:11px; letter-spacing:.5px;">${label}</span>`;
  }

  private formatDate(raw: string): string {
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toISOString().slice(0,16).replace('T',' ');
  }
}
