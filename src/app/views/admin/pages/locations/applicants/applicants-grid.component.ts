import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApplicantPanelComponent } from './applicants-panel.component';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, IHeaderParams, CellClickedEvent } from 'ag-grid-community';
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
    [applicant]="activeApplicant"
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
  ></app-applicant-panel>
  `,
  styles: [`
    :host { position: relative; display:block; }
    .grid-link { color: var(--bs-primary,#0d6efd); cursor:pointer; font-weight:600; text-decoration:none; }
    .grid-link:hover { text-decoration: underline; }
    .selection-badge { border-radius: 999px; padding:.35rem .65rem; }
  `]
})
export class ApplicantsGridComponent implements OnInit, OnChanges {
  @Input() cardId!: number | null; // stage id
  @Input() applicantsCount: number | null | undefined = null; // total applicants (stage.applicants_count)
  @Input() locationName = '';
  @Input() selectedStage: StageMeta | null = null;
  @Input() stageIconClass = 'icon-layers';
  @Input() stageOptions: StageMeta[] = [];

  // Pagination
  pageSize = 10;
  pageSizeOptions = [10,25,50,100];
  currentPage = 0;
  totalPages = 0;
  rowCount = 0;
  rowRangeStart = 0;
  rowRangeEnd = 0;

  columnDefs: ColDef[] = [
    { headerName: '', checkboxSelection: true, headerCheckboxSelection: true, width: 48, pinned: 'left', sortable: false, filter: false, resizable: false, suppressSizeToFit: true },
    { headerName: 'Name', field: 'name', minWidth: 160, flex: 1, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-user' }, cellRenderer: (p: any) => {
        const value = (p.value ?? '').toString().replace(/</g,'<').replace(/>/g,'>');
        return `<span class="grid-link" role="link" aria-label="Open workflow">${value}</span>`;
      } },
    { headerName: 'Email', field: 'email', minWidth: 210, flex: 1.2, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-mail' } },
    { headerName: 'Phone', field: 'phone', minWidth: 140, flex: .8, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-phone' } },
    { 
      headerName: 'Status', field: 'status', minWidth: 260, flex: 1.4, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-clipboard' },
      cellRenderer: (p: any) => {
        if (!p.value) return '';
        const complete = !!p.value.isComplete;
        const stage = p.value.stage || 'Stage';
        const statusName = p.value.statusName || (complete ? 'complete' : 'incomplete');
        const text = `${stage} - ${statusName}`;
        const colorClass = complete ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary';
        const icon = complete ? 'icon-check-circle' : 'icon-shield';
        return `<span class="badge ${colorClass} d-inline-flex align-items-center gap-1 status-badge"><i class="feather ${icon}"></i><span>${text}</span></span>`;
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

  private loadApplicants() {
    if (!this.cardId) return;
    this.loading = true;
    this.error = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_X_crm_stages,
      parameters: [ this.cardId ]
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
          const statusObj = this.parseStatusDetails(r.Status);
          return {
            name: r.Name ?? r.name ?? '',
            email: r.Email ?? r.email ?? '',
            phone: r.Phone ?? r.phone ?? '',
            status: statusObj,
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

  private parseStatusDetails(rawStatusJson: any): { stage: string; statusName: string; isComplete: boolean } | null {
    try {
      if (!rawStatusJson) return null;
      const arr = typeof rawStatusJson === 'string' ? JSON.parse(rawStatusJson) : rawStatusJson;
      if (Array.isArray(arr) && arr.length) {
        const last = arr[arr.length - 1];
        if (last && typeof last === 'object') {
          const stage = String(last.stage || last.Stage || '').trim();
          const statusName = String(last.statusName || last.status || '').trim().toLowerCase();
          const normalized = statusName === 'complete' ? 'complete' : 'incomplete';
          return { stage: stage || 'Stage', statusName: normalized, isComplete: normalized === 'complete' };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private refreshGrid() {
    if (this.gridApi) {
      this.gridApi.setGridOption('rowData', this.rowData);
      this.gridApi.paginationGoToFirstPage();
      this.updatePaginationState();
      this.clearSelection();
    }
  }

  onCellClicked(event: CellClickedEvent): void {
    if (event.colDef.field === 'name' && event.data) {
      this.openPanel(event.data as ApplicantRow);
    }
  }

  openPanel(applicant: ApplicantRow): void {
    this.enrichApplicantMeta(applicant);
    this.activeApplicant = applicant;
    this.panelOpen = true;
    this.activeTab = 'messages';
    this.trackApplicant(applicant);
  }

  closePanel(): void {
    this.panelOpen = false;
    this.activeApplicant = null;
    this.draftMessage = '';
  }

  setTab(tab: PanelTab): void {
    this.activeTab = tab;
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

  // Legacy mock helpers removed after integrating real API

  onGridReady(e: GridReadyEvent) { this.gridApi = e.api; this.refreshGrid(); }
  onFirstDataRendered() { 
    // With flex columns sizeColumnsToFit is usually not needed, but we ensure width usage.
    this.gridApi?.sizeColumnsToFit();
    this.updatePaginationState();
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
  custom: string;
  applied: string;
  IdleSince: string;
  stageName?: string;
  stageId?: number;
  questionnaireLink?: string | null;
  details: { label: string; value: string }[];
  locationName?: string;
  stageIcon?: string;
  raw: any;
}


