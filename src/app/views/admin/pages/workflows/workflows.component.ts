import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';

import { WorkflowsGridComponent } from './workflows-grid.component';

import { CryptoService } from '../../../../core/services/crypto/crypto.service';
import { DriveWhipCoreService, AUTH_USER_STORAGE_KEY } from '../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';
import { WorkflowsDialogComponent, WorkflowDialogResult, WorkflowRecord } from './workflows-dialog.component';
import { Utilities } from '../../../../Utilities/Utilities';
import { AuthSessionService } from '../../../../core/services/auth/auth-session.service';
import { RoutePermissionAction, RoutePermissionService } from '../../../../core/services/auth/route-permission.service';

@Component({
  selector: 'app-workflow',
  standalone: true,
  imports: [CommonModule, NgbDropdownModule, FormsModule, WorkflowsGridComponent, WorkflowsDialogComponent],
  templateUrl: './workflows.component.html',
  styleUrl: './workflows.component.scss'
})
export class WorkFlowsComponent implements OnInit, AfterViewInit, OnDestroy {

  workflowsRows: WorkflowRecord[] = [];  
  rowsForGrid: WorkflowRecord[] = [];
  
  
  filterMode: 'all' | 'active' | 'inactive' = 'active';

  /** UI state */
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _dialogOpen = signal(false);
  private readonly _dialogMode = signal<'create' | 'edit'>('create');
  private readonly _editing = signal<WorkflowRecord | null>(null);
  private readonly _saving = signal(false);
  private readonly permissions = inject(RoutePermissionService);

  readonly loading = computed(() => this._loading());
  readonly error   = computed(() => this._error());
  readonly showDialog    = computed(() => this._dialogOpen());
  readonly dialogMode    = computed(() => this._dialogMode());
  readonly editingRecord = computed(() => this._editing());
  readonly saving        = computed(() => this._saving());

  errorMsg: string | null = null;

  @ViewChild('track') trackEl?: ElementRef<HTMLElement>;
  visibleStart = 0;
  perView = 8;
  trackTransform = 'translateX(0px)';
  trackTransitionStyle = 'transform 0.55s cubic-bezier(.16,.84,.44,1)';
  private gapPx = 16;
  private resizeHandler = () => this.updatePerView();

  constructor(
    private driveWhipCore: DriveWhipCoreService,
    private crypto: CryptoService
  ) {}

  private authSession = inject(AuthSessionService);

  ngOnInit(): void {
    this.updatePerView();
    window.addEventListener('resize', this.resizeHandler);

    // Optional decrypt
    try { const u = localStorage.getItem('user'); if (u) this.crypto.decrypt(u); } catch {}
    try { const p = localStorage.getItem('dw.auth.user'); if (p) this.crypto.decrypt(p); } catch {}

    this.workflowsList();
  }

  ngAfterViewInit(): void { Promise.resolve().then(() => this.updateTransform()); }
  ngOnDestroy(): void { window.removeEventListener('resize', this.resizeHandler); }

    /** Filtrado con referencia estable */
  applyFilter(): void {
    if (!Array.isArray(this.workflowsRows)) {
      this.rowsForGrid = [];
      return;
    }
    switch (this.filterMode) {
      case 'active':
        this.rowsForGrid = this.workflowsRows.filter(r => Number((r as any)?.active ?? (r as any)?.is_active) === 1);
        break;
      case 'inactive':
        this.rowsForGrid = this.workflowsRows.filter(r => Number((r as any)?.active ?? (r as any)?.is_active) !== 1);
        break;
      default:
        this.rowsForGrid = this.workflowsRows;
        break;
    }
  }

  /** Main list load */
  workflowsList(): void {
    this._loading.set(true);
    this.errorMsg = null;

    const driveWhipCoreAPI: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_workflows_list,
      parameters: []
    };

    this.driveWhipCore
      .executeCommand<DriveWhipCommandResponse<WorkflowRecord>>(driveWhipCoreAPI)
      .subscribe({
        next: (response) => {
          if (response?.ok) {
            const raw = response.data as any;
            const rows = Array.isArray(raw)
              ? (Array.isArray(raw[0]) ? raw[0] : raw)
              : [];
            this.workflowsRows = (rows ?? []) as WorkflowRecord[];
          } else {
            this.workflowsRows = [];
          }
          this.applyFilter();
          this._loading.set(false);
        },
        error: (err) => {
          console.error('[WorkFlowsComponent] list error', err);
          this.workflowsRows = [];
          this.rowsForGrid = [];
          this.errorMsg = 'Request failed';
          this._loading.set(false);
        }
      });
  }

  /* ==================== D I A L O G  ==================== */
  openCreate(): void {
    if (!this.hasPermission('Create')) {
      Utilities.showToast('You do not have permission to create workflows.', 'warning');
      return;
    }
    this._dialogMode.set('create');
    this._editing.set(null);
    this._dialogOpen.set(true);
  }

  openEdit(rec: WorkflowRecord): void {
    if (!this.hasPermission('Update')) {
      Utilities.showToast('You do not have permission to edit workflows.', 'warning');
      return;
    }
    // Prefill: pass record to dialog
    this._dialogMode.set('edit');
    this._editing.set(rec);
    this._dialogOpen.set(true);
  }

  closeDialog(): void {
    if (this._saving()) return;
    this._dialogOpen.set(false);
  }

  handleDialogSave(result: WorkflowDialogResult): void {
    if (this._saving()) return;
    const mode = this._dialogMode();
    const action: 'C' | 'U' = mode === 'create' ? 'C' : 'U';
    if ((action === 'C' && !this.hasPermission('Create')) || (action === 'U' && !this.hasPermission('Update'))) {
      Utilities.showToast('You do not have permission to perform this action.', 'warning');
      return;
    }
    this._saving.set(true);

    const idWf = mode === 'edit' ? (this._editing()?.id_workflow ?? null) : null;

    this.mutate(action, {
      id_workflow: idWf ?? undefined,
      id_location: result.id_location ?? undefined,
      workflow_name: result.workflow_name,
      notes: result.notes,
      sort_order: result.sort_order ?? undefined,
      is_active: result.active ? 1 : 0,
    });
  }

  delete(rec: WorkflowRecord): void {
    if (!this.hasPermission('Delete')) {
      Utilities.showToast('You do not have permission to disable workflows.', 'warning');
      return;
    }
    Utilities.confirm({
      title: 'Disable workflow',
      text: `The workflow "${rec.workflow_name}" will be disabled. Continue?`,
      confirmButtonText: 'Disable',
      allowOutsideClick: false,
    }).then(c => {
      if (!c) return;
      this.mutate('D', { id_workflow: rec.id_workflow });
    });
  }

  /** CRUD → ajusta orden/params según tu SP */
  private mutate(action: 'C'|'U'|'D', rec: Partial<WorkflowRecord> & { is_active?: number }) {
    const required: Record<'C'|'U'|'D', RoutePermissionAction> = { C: 'Create', U: 'Update', D: 'Delete' };
    const needed = required[action];
    if (!this.hasPermission(needed)) {
      Utilities.showToast('You do not have permission to perform this action.', 'warning');
      this._saving.set(false);
      this._loading.set(false);
      return;
    }
    this._loading.set(true);

    // Firma real del SP:
    // (p_action, p_id_workflow, p_id_location, p_name, p_is_active, p_created_by, p_updated_by)
    const actor = this.resolveActor();
    const isActive = action === 'D' ? null : (rec.is_active ?? 1); // 0 | 1 | null
    const createdBy = action === 'C' ? actor : null;
    const updatedBy = action === 'U' || action === 'D' ? actor : null;

    const params: any[] = [
      action,
      rec.id_workflow ?? null,
      rec.id_location ?? null,
      rec.workflow_name ?? null,
      isActive,
      createdBy,
      updatedBy
    ];

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_workflows_crud,
      parameters: params
    };

    this.driveWhipCore
      .executeCommand<DriveWhipCommandResponse<WorkflowRecord>>(api)
      .subscribe({
        next: (res) => {
          if (!res.ok) {
            console.error('[WorkFlowsComponent] mutate error', res.error);
            this._saving.set(false);
            this._loading.set(false);
            return;
          }
          this._saving.set(false);
          this.closeDialog();
          this.workflowsList();
        },
        error: (err) => {
          console.error('[WorkFlowsComponent] mutate error', err);
          this._saving.set(false);
          this._loading.set(false);
        }
      });
  }

    hasPermission(action: RoutePermissionAction): boolean {
      return this.permissions.canCurrent(action);
    }

  /** Try to get a user string for audit fields, fallback to 'system' */
  private resolveActor(): string {
    const sessionUser = this.authSession.user;
    if (sessionUser) {
      if (sessionUser.user) return sessionUser.user;
    }
    return 'system';
  }

  /* ------- layout helpers (optional) ------- */
  private updatePerView() {
    const w = window.innerWidth;
    if (w < 576) this.perView = 2;
    else if (w < 768) this.perView = 3;
    else if (w < 992) this.perView = 4;
    else if (w < 1200) this.perView = 5;
    else if (w < 1400) this.perView = 6;
    else this.perView = 8;
    this.updateTransform();
  }

  private updateTransform() {
    const track = this.trackEl?.nativeElement;
    if (!track) return;
    const firstCard = track.querySelector('.status-card') as HTMLElement | null;
    if (!firstCard) return;
    const cardWidth = firstCard.getBoundingClientRect().width;
    const offset = (cardWidth + this.gapPx) * this.visibleStart * -1;
    this.trackTransform = `translateX(${offset}px)`;
  }
}
