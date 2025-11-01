import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApplicantPanelComponent } from './applicants-panel.component';
import { ApplicantActionsCellComponent, ApplicantQuickAction } from './applicant-actions-cell.component';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, IHeaderParams, CellClickedEvent, GridOptions } from 'ag-grid-community';
import { IHeaderAngularComp } from 'ag-grid-angular';
import { DriveWhipCoreService } from '../../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipAdminCommand } from '../../../../../core/db/procedures';
import { IDriveWhipCoreAPI, DriveWhipCommandResponse } from '../../../../../core/models/entities.model';
import { Utilities } from '../../../../../Utilities/Utilities';

@Component({
  selector: 'app-grid-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="d-inline-flex align-items-center gap-1 header-cell" [title]="params?.displayName">
      <i *ngIf="icon" class="feather {{ icon }} small text-primary"></i>
      <span class="text-truncate">{{ params?.displayName }}</span>
    </div>
  `,
  styles: [`
    .header-cell i { font-size: .9rem; line-height:1; }
  `]
})
export class GridHeaderComponent implements IHeaderAngularComp {
  public params: (IHeaderParams & { icon?: string }) | null = null;
  icon?: string;
  agInit(params: IHeaderParams & { icon?: string }): void { this.params = params; this.icon = params.icon; }
  refresh(params: IHeaderParams & { icon?: string }): boolean { this.params = params; this.icon = params.icon; return true; }
}

@Component({
  selector: 'app-applicants-grid',
  standalone: true,
    imports: [CommonModule, FormsModule, AgGridAngular, ApplicantPanelComponent],
  template: `
  <div class="d-flex flex-wrap gap-2 align-items-center mb-4">
    <h6 class="mb-0 fw-semibold">Applicants
      <span *ngIf="applicantsCount !== null && applicantsCount !== undefined">({{ applicantsCount }})</span>
      <span *ngIf="(applicantsCount === null || applicantsCount === undefined) && cardId">(Stage #{{ cardId }})</span>
    </h6>
  </div>
  <div *ngIf="loading" class="small text-secondary mb-2 d-flex align-items-center gap-2">
    <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
    Loading applicants...
  </div>
  <div *ngIf="error" class="alert alert-danger py-1 px-2 small mb-2">{{ error }}</div>
  <div *ngIf="selectedCount>0" class="badge bg-primary-subtle text-primary fw-normal mb-2 selection-badge">
    <i class="feather icon-info me-1"></i>{{ selectedCount }} selected
  </div>
  <ag-grid-angular class="ag-theme-quartz dw-grid-theme" style="width:100%;height:420px;"
                   [rowData]="rowData"
                   [columnDefs]="columnDefs"
                   [defaultColDef]="defaultColDef"
                   [context]="context"
                   [gridOptions]="gridOptions"
                   rowSelection="multiple"
                   [suppressRowClickSelection]="true"
                   [pagination]="true"
                   [paginationPageSize]="pageSize"
                   [paginationPageSizeSelector]="pageSizeOptions"
                   (gridReady)="onGridReady($event)"
                   (cellClicked)="onCellClicked($event)"
                   (selectionChanged)="onSelectionChanged()"
                   (firstDataRendered)="onFirstDataRendered()"
                   (paginationChanged)="onPaginationChanged()">
  </ag-grid-angular>

  <app-applicant-panel
    *ngIf="panelOpen"
    [applicant]="null"
    [applicantId]="activeApplicant?.id || null"
      [status]="activeApplicant?.status || null"
    [statuses]="activeApplicant?.statuses || null"
    [activeTab]="activeTab"
    [hasPrevious]="hasPreviousApplicant()"
    [hasNext]="hasNextApplicant()"
    [(draftMessage)]="draftMessage"
    [locationName]="locationName"
    [stageName]="selectedStage?.name || activeApplicant?.stageName || ''"
    [stageIcon]="stageIconClass"
    [availableStages]="stageOptions"
    [currentStageId]="activeApplicant?.stageId ?? selectedStage?.id_stage ?? null"
    (closePanel)="closePanel()"
    (goToPrevious)="goToPreviousApplicant()"
    (goToNext)="goToNextApplicant()"
    (setTab)="setTab($event)"
    (sendMessage)="onSendMessage($event)"
    (stageMoved)="onStageMoved($event)"
    (applicantSaved)="onApplicantSaved($event)"
    (applicantDeleted)="onApplicantDeleted($event)"
  ></app-applicant-panel>
  `,
  styles: [`
    :host { position: relative; display:block; }
    .grid-link { color: var(--bs-primary,#0d6efd); cursor:pointer; font-weight:600; text-decoration:none; }
    .grid-link:hover { text-decoration: underline; }
    .selection-badge { border-radius: 999px; padding:.35rem .65rem; }
    /* Allow multi-line content in cells and avoid clipping */
    :host ::ng-deep .ag-theme-quartz .ag-cell-wrap-text { white-space: normal !important; }
    :host ::ng-deep .ag-theme-quartz .status-badge { line-height: 1; }
    :host ::ng-deep .ag-theme-quartz .status-badge-action { cursor: pointer; }
    :host ::ng-deep .ag-theme-quartz .ag-cell div.d-flex.flex-wrap { align-items: center; gap: .25rem; }
    :host ::ng-deep .ag-theme-quartz .actions-cell-wrapper { padding: 0 !important; }
  `]
})
export class ApplicantsGridComponent implements OnInit, OnChanges {
  @ViewChild(ApplicantPanelComponent) panelComponent?: ApplicantPanelComponent;

  context = { componentParent: this };
  @Output() stageMoved = new EventEmitter<{ idApplicant: string; toStageId: number }>();
  @Output() applicantDeleted = new EventEmitter<string>();
  @Input() cardId!: number | null; // stage id
  @Input() applicantsCount: number | null | undefined = null; // total applicants (stage.applicants_count)
  @Input() locationName = '';
  @Input() selectedStage: StageMeta | null = null;
  @Input() stageIconClass = 'icon-layers';
  @Input() stageOptions: StageMeta[] = [];
  @Input() selectedWorkflowId: number | null = null; // workflow id required by SP

  // Pagination
  pageSize = 10;
  pageSizeOptions = [10,25,50,100];
  currentPage = 0;
  totalPages = 0;
  rowCount = 0;
  rowRangeStart = 0;
  rowRangeEnd = 0;

  gridOptions: GridOptions = {
    components: {
      applicantActionsCell: ApplicantActionsCellComponent,
    },
  };

  columnDefs: ColDef[] = [
    // { headerName: '', checkboxSelection: true, headerCheckboxSelection: true, width: 48, pinned: 'left', sortable: false, filter: false, resizable: false, suppressSizeToFit: true },
  { headerName: '', field: '__actions', width: 48, pinned: 'left', sortable: false, filter: false, resizable: false, suppressSizeToFit: true, cellClass: 'actions-cell-wrapper', cellRenderer: 'applicantActionsCell' },
    { headerName: 'Name', field: 'name', minWidth: 160, flex: 1, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-user' }, cellRenderer: (p: any) => {
        const value = (p.value ?? '').toString().replace(/</g,'<').replace(/>/g,'>');
        return `<span class="grid-link" role="link" aria-label="Open workflow">${value}</span>`;
      } },
    { headerName: 'Email', field: 'email', minWidth: 210, flex: 1.2, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-mail' } },
    { headerName: 'Phone', field: 'phone', minWidth: 140, flex: .8, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-phone' } },
    { 
      headerName: 'Status', field: 'status', minWidth: 260, flex: 1.4, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-clipboard' },
      autoHeight: true, wrapText: true, cellClass: 'ag-cell-wrap-text',
      cellRenderer: (p: any) => {
        // Prefer rendering the full list of statuses if available; fallback to single p.value
        const list = Array.isArray(p?.data?.statuses) ? p.data.statuses : (p?.value ? [p.value] : []);
        if (!list.length) return '';
        const renderOne = (item: any) => {
          const complete = !!item.isComplete;
          const stageRaw = (item.stage || 'Stage').toString();
          const stage = stageRaw.trim();
          const isReviewFiles = stage.toLowerCase() === 'review files';
          const isAllFilesApproved = stage.toLowerCase() === 'all files approved';
          // If the stage indicates a re-collecting flow (e.g., "1 Re-collecting", "2 Re-collecting"), treat specially
          const isRecollecting = !isReviewFiles && !isAllFilesApproved && /\bre-collecting\b/i.test(stage);
          // statusName may be normalized elsewhere; still compute a safe display value
          const rawStatus = (item.statusName ?? '').toString().trim();
          const statusName = rawStatus !== '' ? rawStatus : (complete ? 'complete' : 'incomplete');

          let text: string;
          if (isReviewFiles || isAllFilesApproved) {
            // For Review Files and All Files Approved show only the stage text
            text = stage;
          } else if (isRecollecting) {
            text = stage;
          } else {
            text = `${stage || 'Stage'} - ${statusName}`;
          }

          let colorClass = '';
          let icon = '';
          if (isAllFilesApproved) {
            // Special: treat as success and show only the stage text (no "- incomplete")
            colorClass = 'bg-success-subtle text-success';
            icon = 'icon-check-circle';
          } else if (isReviewFiles) {
            colorClass = 'bg-info text-white';
            icon = 'icon-folder';
          } else if (isRecollecting) {
            colorClass = 'bg-info-subtle text-info';
            icon = 'icon-clock';
          } else if (complete) {
            colorClass = 'bg-success-subtle text-success';
            icon = 'icon-check-circle';
          } else {
            colorClass = 'bg-primary-subtle text-primary';
            icon = 'icon-shield';
          }

          const actionAttr = isReviewFiles ? ' data-status-action="open-files"' : '';
          const extraClass = isReviewFiles ? ' status-badge-action' : '';
          return `<span class="badge ${colorClass} d-inline-flex align-items-center gap-1 status-badge${extraClass}"${actionAttr}><i class="feather ${icon}"></i><span>${text}</span></span>`;
        };
        // Optionally de-duplicate repeated statuses keeping the last occurrence
        const seen = new Set<string>();
        const deduped: any[] = [];
        for (let i = list.length - 1; i >= 0; i--) {
          const it = list[i];
          const key = `${(it.stage||'').toLowerCase()}|${(it.statusName||'').toLowerCase()}|${it.order ?? ''}`;
          if (!seen.has(key)) { seen.add(key); deduped.unshift(it); }
        }
        return `<div class="d-flex flex-wrap gap-1">${deduped.map(renderOne).join('')}</div>`;
      }
    },
    { headerName: 'Custom Label', field: 'custom', minWidth: 150, flex: .7, valueGetter: () => '', headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-tag' } },
    { headerName: 'Applied', field: 'applied', minWidth: 120, flex: .6, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-calendar' } },
    { headerName: 'Idle Since', field: 'IdleSince', minWidth: 120, flex: .6, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-calendar' } }
  ];

  defaultColDef: ColDef = { sortable:true, filter:true, floatingFilter:true, resizable:true, wrapHeaderText:true, autoHeaderHeight:true };

  rowData: any[] = [];
  loading = false;
  error: string | null = null;
  gridApi?: GridApi; // public for template access (*ngIf="gridApi")
  selectedCount = 0;
  panelOpen = false;
  activeApplicant: ApplicantRow | null = null;
  activeTab: PanelTab = 'messages';
  draftMessage = '';
  private recentApplicants: ApplicantRow[] = [];

  constructor(private core: DriveWhipCoreService) {}

  ngOnInit(): void { if (this.cardId) this.loadApplicants(); }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cardId'] && !changes['cardId'].firstChange) {
      if (this.cardId) this.loadApplicants(); else { this.rowData = []; this.refreshGrid(); }
    }
    // If workflow changes while a stage is selected, refresh to include correct parameter
    if (changes['selectedWorkflowId'] && !changes['selectedWorkflowId'].firstChange) {
      if (this.cardId) this.loadApplicants();
    }
    if (changes['locationName'] && !changes['locationName'].firstChange) {
      this.applyLocationToRows();
    }
    if (changes['selectedStage'] && !changes['selectedStage'].firstChange) {
      this.applyStageMetaToRows();
    }
    if (changes['stageIconClass'] && !changes['stageIconClass'].firstChange) {
      this.applyStageMetaToRows();
    }
  }

  /** Handler invoked when an applicant was moved to another stage. Refresh applicants list and try to keep the panel open on the same applicant if still present. */
  onStageMoved(evt: { idApplicant: string; toStageId: number }) {
    // Reload the applicants for the current card/stage. This will also refresh counts shown in parent.
    this.loadApplicants();
    // If the active applicant still exists in the refreshed list, keep it; otherwise close panel.
    // loadApplicants already attempts to reconcile activeApplicant, so no extra work required here.
    // Forward typed event to parent component
    try { this.stageMoved.emit(evt); } catch (e) { /* best-effort forward */ }
  }

  private loadApplicants() {
    if (!this.cardId) return;
    this.loading = true;
    this.error = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_X_crm_stages,
      // SP requires: p_id_stage, p_id_workflow
      parameters: [ 
                    this.cardId, 
                    // this.selectedWorkflowId 
                  ]
    };
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: res => {
        if (!res.ok) {
          this.error = String(res.error || 'Failed to load applicants');
          Utilities.showToast(this.error, 'error');
          this.rowData = [];
          this.refreshGrid();
          return;
        }
        let raw: any = [];
        if (Array.isArray(res.data)) {
          const top = res.data as any[];
          if (top.length > 0 && Array.isArray(top[0])) raw = top[0]; else raw = top;
        }
        const list = Array.isArray(raw) ? raw : [];
        const mapped = list.map((r: any) => {
          const parsed = this.parseStatuses(r.Status);
          const statusObj = parsed.last;
          // Extract applicant id from any known property that may contain it
          const applicantId = (r?.id_applicant ?? r?.ID_APPLICANT ?? r?.IdApplicant ?? r?.idApplicant ?? r?.applicantId ?? r?.applicant_id ?? r?.id ?? r?.ID ?? r?.Id ?? r?.uuid ?? r?.guid ?? r?.ID_APPLICANTS ?? r?.id_applicants ?? r?.IdApplicants ?? r?.idApplicants) ?? null;
          return {
            id: applicantId != null ? String(applicantId) : null,
            name: r.Name ?? r.name ?? '',
            email: r.Email ?? r.email ?? '',
            phone: r.Phone ?? r.phone ?? '',
            status: statusObj,
            statuses: parsed.list,
            custom: '',
            applied: r.Applied ?? r.applied ?? '',
            IdleSince: r.IdleSince ?? r.idleSince ?? r.idle_since ?? '',
            stageName: statusObj?.stage ?? '',
            questionnaireLink: r.QuestionnaireUrl ?? r.questionnaireUrl ?? r.questionnaire_url ?? null,
            details: this.buildDetails(r),
            raw: r,
            locationName: this.locationName,
            stageIcon: this.stageIconClass
          } as ApplicantRow;
        });
        this.rowData = mapped;
        this.recentApplicants = mapped;
        this.applyLocationToRows();
        this.applyStageMetaToRows();
        if (this.activeApplicant) {
          const refreshed = mapped.find(m => this.isSameApplicant(m, this.activeApplicant as ApplicantRow));
          if (refreshed) {
            this.activeApplicant = refreshed;
            this.applyPanelMeta();
          } else {
            this.closePanel();
          }
        }
        this.refreshGrid();
      },
      error: err => {
        console.error('[ApplicantsGrid] loadApplicants error', err);
        this.error = 'Failed to load applicants';
        Utilities.showToast(this.error, 'error');
        this.rowData = [];
        this.refreshGrid();
      },
      complete: () => { this.loading = false; }
    });
  }

  /** Public refresh API so parents can request a reload without recreating the component */
  public refresh(): void {
    this.loadApplicants();
  }

  private parseStatuses(rawStatusJson: any): { list: Array<{ stage: string; statusName: string; isComplete: boolean; order?: number }>; last: { stage: string; statusName: string; isComplete: boolean; order?: number } | null } {
    const empty = { list: [], last: null as any };
    if (!rawStatusJson) return empty;
    // Try to parse; if malformed, attempt a light repair by ensuring closing bracket
    let arr: any;
    try {
      arr = typeof rawStatusJson === 'string' ? JSON.parse(rawStatusJson) : rawStatusJson;
    } catch {
      // Attempt a simple repair for truncated arrays
      try {
        const s = String(rawStatusJson).trim();
        const repaired = s.endsWith(']') ? s : (s + ']');
        arr = JSON.parse(repaired);
      } catch {
        return empty;
      }
    }
    if (!Array.isArray(arr) || !arr.length) return empty;
    const list = arr
      .filter((x: any) => x && typeof x === 'object')
      .map((x: any) => {
        const stage = String(x.stage || x.Stage || '').trim();
        const statusNameRaw = String(x.statusName || x.status || '').trim().toLowerCase();
        const normalized = statusNameRaw === 'complete' ? 'complete' : 'incomplete';
        const order = typeof x.order === 'number' ? x.order : undefined;
        return { stage: stage || 'Stage', statusName: normalized, isComplete: normalized === 'complete', order };
      });
    const last = list.length ? list[list.length - 1] : null;
    return { list, last };
  }

  private refreshGrid() {
    if (this.gridApi) {
      this.gridApi.setGridOption('rowData', this.rowData);
      this.gridApi.paginationGoToFirstPage();
      this.updatePaginationState();
      this.clearSelection();
      // Recalculate row heights to fit autoHeight cells (e.g., multiple status badges)
      this.gridApi.resetRowHeights();
    }
  }

  onCellClicked(event: CellClickedEvent): void {
    const clickTarget = (event.event?.target as HTMLElement | null) ?? null;
    if (event.colDef.field === 'status' && event.data && clickTarget) {
      const actionable = clickTarget.closest('[data-status-action]') as HTMLElement | null;
      if (actionable?.dataset.statusAction === 'open-files') {
        event.event?.preventDefault();
        event.event?.stopPropagation();
        this.openPanel(event.data.id, 'files');
        return;
      }
    }

    if (event.colDef.field === 'name' && event.data) {
      this.openPanel(event.data.id);
    }
  }

  openPanel(applicantId: string, initialTab: PanelTab = 'messages', postOpenAction?: (panel: ApplicantPanelComponent) => void): void {
    const applicant = this.rowData.find(row => row.id === applicantId) ?? this.recentApplicants.find(row => row.id === applicantId) ?? null;
    if (applicant) {
      this.enrichApplicantMeta(applicant);
    }
    this.activeApplicant = applicant;
    this.panelOpen = true;
    this.activeTab = initialTab;
    if (applicant) {
      this.trackApplicant(applicant);
    }

    if (postOpenAction) {
      const expectedId = applicant?.id ?? applicantId;
      // Run on next microtask to allow the component to instantiate
      setTimeout(() => this.deferPanelAction(postOpenAction, 0, expectedId), 0);
    }
  }

  closePanel(): void {
    this.panelOpen = false;
    this.activeApplicant = null;
    this.draftMessage = '';
  }

  setTab(tab: PanelTab): void {
    this.activeTab = tab;
  }

  handleQuickAction(applicant: ApplicantRow | null, action: ApplicantQuickAction, payload?: any): void {
    if (!applicant) {
      return;
    }

    const applicantId = this.resolveApplicantId(applicant);
    if (!applicantId) {
      Utilities.showToast('No pudimos identificar a este solicitante. Intenta actualizar la lista.', 'warning');
      return;
    }

    switch (action) {
      case 'openPanel':
        this.openPanel(applicantId, 'messages');
        break;
      case 'sendEmail':
        this.ensurePanelAction(applicantId, (panel) => panel.openEmailSidebar());
        break;
      case 'sendSms':
        this.ensurePanelAction(applicantId, (panel) => panel.openSmsSidebar());
        break;
      case 'resendSms':
        this.ensurePanelAction(applicantId, (panel) => {
          if (!panel.canResendMessage()) {
            Utilities.showToast('No outbound SMS available to resend', 'info');
            return;
          }
          panel.resendLastMessage();
        });
        break;
      case 'moveToModal':
        this.ensurePanelAction(applicantId, (panel) => panel.openMoveToModal());
        break;
      case 'moveToStage':
        if (payload === undefined || payload === null) {
          break;
        }
        this.ensurePanelAction(applicantId, (panel) =>
          panel.onStageClick(Number(payload))
        );
        break;
      case 'moveNext':
        this.ensurePanelAction(applicantId, (panel) => panel.moveToNextStage());
        break;
      case 'reject':
        this.ensurePanelAction(applicantId, (panel) => panel.rejectApplicant());
        break;
      case 'approveDriver':
        this.openPanel(applicantId, 'messages');
        break;
      case 'editApplicant':
        this.ensurePanelAction(applicantId, (panel) => panel.startEditApplicant());
        break;
      case 'deleteApplicant':
        this.ensurePanelAction(applicantId, (panel) => panel.onDeleteApplicantClick());
        break;
      default:
        break;
    }
  }

  private ensurePanelAction(applicantId: string, action: (panel: ApplicantPanelComponent) => void, tab: PanelTab = 'messages'): void {
    if (!applicantId) return;

    const sameApplicant = this.panelOpen && this.activeApplicant?.id === applicantId;
    if (!this.panelOpen || !sameApplicant) {
      this.openPanel(applicantId, tab, action);
      return;
    }

    this.deferPanelAction(action, 0, applicantId);
  }

  private resolveApplicantId(applicant: ApplicantRow | null): string | null {
    if (!applicant) return null;
    if (applicant.id) return applicant.id;
    const raw = applicant.raw || {};
    const candidates = [
      raw.id_applicant,
      raw.ID_APPLICANT,
      raw.IdApplicant,
      raw.idApplicant,
      raw.applicantId,
      raw.applicant_id,
      raw.ID_APPLICANTS,
      raw.id_applicants,
      raw.IdApplicants,
      raw.idApplicants,
      raw.id,
      raw.ID,
      raw.Id,
      raw.uuid,
      raw.guid,
    ];
    const found = candidates.find((val: unknown) => val !== null && val !== undefined && val !== '');
    return found !== undefined ? String(found) : null;
  }

  canResendQuickAction(applicant: ApplicantRow | null): boolean {
    // Replicate panel's validation: only enable when there's an outbound SMS to resend
    // If the panel is open for this applicant, delegate to its canResendMessage().
    const id = this.resolveApplicantId(applicant);
    if (!id) return false;
    const panel = this.panelComponent;
    if (panel && this.panelOpen && this.activeApplicant?.id === id) {
      try { return panel.canResendMessage(); } catch { return false; }
    }
    // Without chat context loaded we can't validate existence of last outbound SMS -> keep disabled
    return false;
  }

  private deferPanelAction(action: (panel: ApplicantPanelComponent) => void, attempt = 0, expectedId?: string | null): void {
    const panel = this.panelComponent;
    if (panel && (!expectedId || panel.applicantId === expectedId)) {
      try {
        action(panel);
      } catch (err) {
        console.error('[ApplicantsGrid] panel action error', err);
      }
      return;
    }

    if (attempt >= 12) {
      return;
    }

    setTimeout(() => this.deferPanelAction(action, attempt + 1, expectedId), 50);
  }

  onSendMessage(event: Event): void {
    event.preventDefault();
    if (!this.draftMessage.trim()) return;
    Utilities.showToast('Message queued (preview only)', 'info');
    this.draftMessage = '';
  }

  hasPreviousApplicant(): boolean {
    if (!this.activeApplicant) return false;
    const idx = this.recentApplicants.indexOf(this.activeApplicant);
    return idx > 0;
  }

  hasNextApplicant(): boolean {
    if (!this.activeApplicant) return false;
    const idx = this.recentApplicants.indexOf(this.activeApplicant);
    return idx >= 0 && idx < this.recentApplicants.length - 1;
  }

  goToPreviousApplicant(): void {
    if (!this.hasPreviousApplicant()) return;
    if (!this.activeApplicant) return;
    const idx = this.recentApplicants.indexOf(this.activeApplicant);
    if (idx > 0) {
      this.activeApplicant = this.recentApplicants[idx - 1];
      this.activeTab = 'messages';
    }
  }

  goToNextApplicant(): void {
    if (!this.hasNextApplicant()) return;
    if (!this.activeApplicant) return;
    const idx = this.recentApplicants.indexOf(this.activeApplicant);
    if (idx >= 0 && idx < this.recentApplicants.length - 1) {
      this.activeApplicant = this.recentApplicants[idx + 1];
      this.activeTab = 'messages';
    }
  }

  private trackApplicant(applicant: ApplicantRow): void {
    if (!this.recentApplicants.includes(applicant)) {
      this.recentApplicants.push(applicant);
    }
  }

  private enrichApplicantMeta(applicant: ApplicantRow): void {
    applicant.locationName = this.locationName || applicant.locationName || '';
    if (this.selectedStage) {
      applicant.stageName = this.selectedStage.name ?? applicant.stageName;
    }
    applicant.stageIcon = this.stageIconClass || applicant.stageIcon || 'icon-layers';
  }

  private applyLocationToRows(): void {
    const loc = (this.locationName ?? '').trim();
    this.rowData.forEach(row => row.locationName = loc || row.locationName || '');
    this.recentApplicants.forEach(row => row.locationName = loc || row.locationName || '');
    this.applyPanelMeta();
  }

  private applyStageMetaToRows(): void {
    const stageName = (this.selectedStage?.name ?? '').trim();
    const icon = this.stageIconClass || 'icon-layers';
    this.rowData.forEach(row => {
      row.stageName = stageName || row.stageName || row.status?.stage || '';
      row.stageIcon = icon || row.stageIcon || 'icon-layers';
    });
    this.recentApplicants.forEach(row => {
      row.stageName = stageName || row.stageName || row.status?.stage || '';
      row.stageIcon = icon || row.stageIcon || 'icon-layers';
    });
    this.applyPanelMeta();
  }

  private applyPanelMeta(): void {
    if (!this.activeApplicant) return;
    this.enrichApplicantMeta(this.activeApplicant);
  }

  private isSameApplicant(a: ApplicantRow, b: ApplicantRow): boolean {
    if (!a || !b) return false;
    if (a.id && b.id) return a.id === b.id;
    if (a.email && b.email) return a.email === b.email;
    if (a.phone && b.phone) return a.phone === b.phone;
    return a.name === b.name;
  }

  private buildDetails(raw: any): { label: string; value: string }[] {
    const details: { label: string; value: string }[] = [];
    const add = (label: string, value: any) => {
      if (value === null || value === undefined || value === '') return;
      details.push({ label, value: String(value) });
    };
    add('Applied', raw.Applied ?? raw.applied);
    add('Idle Since', raw.IdleSince ?? raw.idleSince ?? raw.idle_since);
    add('Referral', raw.Referral ?? raw.referral);
    add('Sms Opt In', raw.SmsOptIn ?? raw.smsOptIn ?? raw.sms_opt_in);
    add('Source', raw.Source ?? raw.source);
    return details.length ? details : [{ label: 'Details', value: 'No additional information available.' }];
  }

  onApplicantSaved(evt: { id: string; payload: any } | any): void {
    if (!evt) return;
    const id = evt.id ?? evt?.payload?.id ?? null;
    if (this.activeApplicant && id && this.activeApplicant.id === id) {
      this.activeApplicant = { ...this.activeApplicant, ...(evt.payload ?? {}) };
    }
    // Refresh the grid data so applicant row reflects latest info
    this.loadApplicants();
  }

  onApplicantDeleted(applicantId: string): void {
    if (!applicantId) {
      this.loadApplicants();
      return;
    }
    if (this.activeApplicant?.id === applicantId) {
      this.closePanel();
    }
    // Remove any cached references to the deleted applicant before reloading
    this.recentApplicants = this.recentApplicants.filter((row) => row.id !== applicantId);
    this.rowData = this.rowData.filter((row) => row.id !== applicantId);
    this.loadApplicants();
    try { this.applicantDeleted.emit(applicantId); } catch { /* best effort */ }
  }

  // Legacy mock helpers removed after integrating real API

  onGridReady(e: GridReadyEvent) { this.gridApi = e.api; this.refreshGrid(); }
  onFirstDataRendered() { 
    // With flex columns sizeColumnsToFit is usually not needed, but we ensure width usage.
    this.gridApi?.sizeColumnsToFit();
    this.updatePaginationState();
    this.gridApi?.resetRowHeights();
  }
  onSelectionChanged() { this.selectedCount = this.gridApi?.getSelectedNodes().length || 0; }
  clearSelection() { this.gridApi?.deselectAll(); this.onSelectionChanged(); }
  exportCsv(onlySelected: boolean) { this.gridApi?.exportDataAsCsv({ onlySelected }); }

  onPageSizeChangeValue(value: number) {
    this.pageSize = value;
    if (this.gridApi) {
      (this.gridApi as any).setGridOption?.('paginationPageSize', value);
      this.gridApi.paginationGoToFirstPage();
      this.updatePaginationState();
    }
  }

  onPaginationChanged() { this.updatePaginationState(); }

  private updatePaginationState() {
    if (!this.gridApi) return;
    this.rowCount = this.gridApi.getDisplayedRowCount();
    this.currentPage = this.gridApi.paginationGetCurrentPage();
    this.totalPages = this.gridApi.paginationGetTotalPages();
    const pageSize = (this.gridApi as any).getGridOption?.('paginationPageSize') || this.pageSize;
    this.rowRangeStart = this.currentPage * pageSize;
    this.rowRangeEnd = Math.min(this.rowRangeStart + pageSize, this.rowCount);
  }

  goToPrevious() { this.gridApi?.paginationGoToPreviousPage(); this.updatePaginationState(); }
  goToNext() { this.gridApi?.paginationGoToNextPage(); this.updatePaginationState(); }
}

type PanelTab = 'messages' | 'history' | 'files';

interface StageMeta { name: string; id_stage_type: number; id_stage?: number; }

interface ApplicantRow {
  name: string;
  email: string;
  phone: string;
  status: { stage: string; statusName: string; isComplete: boolean } | null;
  statuses?: Array<{ stage: string; statusName: string; isComplete: boolean; order?: number }>;
  custom: string;
  applied: string;
  IdleSince: string;
  stageName?: string;
  stageId?: number;
  questionnaireLink?: string | null;
  details: { label: string; value: string }[];
  locationName?: string;
  id?: string | null;
  stageIcon?: string;
  raw: any;
}


