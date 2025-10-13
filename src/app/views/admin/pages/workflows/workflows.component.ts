import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';

import { WorkflowsGridComponent } from './workflows-grid.component';

import { CryptoService } from '../../../../core/services/crypto/crypto.service';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';
import { WorkflowsDialogComponent, WorkflowDialogResult, WorkflowRecord } from './workflows-dialog.component';
import { Utilities } from '../../../../Utilities/Utilities';

@Component({
  selector: 'app-workflow',
  standalone: true,
  imports: [CommonModule, NgbDropdownModule, FormsModule, WorkflowsGridComponent, WorkflowsDialogComponent],
  templateUrl: './workflows.component.html',
  styleUrl: './workflows.component.scss'
})
export class WorkFlowsComponent implements OnInit, AfterViewInit, OnDestroy {

  workflowsRows: WorkflowRecord[] = [];

  /** UI state */
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _dialogOpen = signal(false);
  private readonly _dialogMode = signal<'create' | 'edit'>('create');
  private readonly _editing = signal<WorkflowRecord | null>(null);
  private readonly _saving = signal(false);

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
          this._loading.set(false);
        },
        error: (err) => {
          console.error('[WorkFlowsComponent] list error', err);
          this.workflowsRows = [];
          this.errorMsg = 'Request failed';
          this._loading.set(false);
        }
      });
  }

  /* ==================== D I A L O G  ==================== */
  openCreate(): void {
    this._dialogMode.set('create');
    this._editing.set(null);
    this._dialogOpen.set(true);
  }

  openEdit(rec: WorkflowRecord): void {
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
    Utilities.confirm({
      title: 'Disable workflow',
      text: `The workflow "${rec.workflow_name}" will be disabled. Continue?`,
      confirmButtonText: 'Disable'
    }).then(c => {
      if (!c) return;
      this.mutate('D', { id_workflow: rec.id_workflow });
    });
  }

  /** CRUD → ajusta orden/params según tu SP */
  private mutate(action: 'C'|'U'|'D', rec: Partial<WorkflowRecord> & { is_active?: number }) {
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

  /** Try to get a user string for audit fields, fallback to 'system' */
  private resolveActor(): string {
    try {
      const u = localStorage.getItem('dw.auth.user') || localStorage.getItem('user');
      if (!u) return 'system';
      // If values are encrypted the decrypt may return a JSON string or plain text; keep it defensive
      let s: string | null = null;
      try { s = this.crypto.decrypt(u) as unknown as string; } catch { /* ignore */ }
      const raw = s || u;
      try {
        const obj = JSON.parse(raw);
        return obj?.email || obj?.username || obj?.name || 'system';
      } catch {
        // Not JSON, return trimmed string if reasonable
        const t = raw.trim();
        return t.length > 2 ? t : 'system';
      }
    } catch {
      return 'system';
    }
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
