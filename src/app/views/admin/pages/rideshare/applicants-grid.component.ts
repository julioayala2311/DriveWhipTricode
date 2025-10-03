import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, IHeaderParams } from 'ag-grid-community';
import { IHeaderAngularComp } from 'ag-grid-angular';

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
  imports: [CommonModule, FormsModule, AgGridAngular],
  template: `
  <div class="d-flex flex-wrap gap-2 align-items-center mb-4">
    <h6 class="mb-0 fw-semibold">Applicants (Card #{{ cardId }})</h6>
    <div class="ms-auto d-flex gap-2 align-items-center flex-wrap">
      <!-- Botones opcionales futuros (export, acciones) -->
    </div>
  </div>
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
                   (selectionChanged)="onSelectionChanged()"
                   (firstDataRendered)="onFirstDataRendered()"
                   (paginationChanged)="onPaginationChanged()">
  </ag-grid-angular>
  `
})
export class ApplicantsGridComponent implements OnInit, OnChanges {
  @Input() cardId!: number | null;

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
    { headerName: 'Name', field: 'name', minWidth: 160, flex: 1, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-user' } },
    { headerName: 'Email', field: 'email', minWidth: 210, flex: 1.2, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-mail' } },
    { headerName: 'Phone', field: 'phone', minWidth: 140, flex: .8, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-phone' } },
    { 
      headerName: 'Status', field: 'status', minWidth: 260, flex: 1.4, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-clipboard' },
      cellRenderer: (p: any) => {
        const complete = p.value === 'complete';
        const text = complete ? 'Insurance Questionnaire - Complete' : 'Insurance Questionnaire - Incomplete';
        const colorClass = complete ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary';
        const icon = complete ? 'icon-check-circle' : 'icon-shield';
        return `<span class="badge ${colorClass} d-inline-flex align-items-center gap-1 status-badge"><i class="feather ${icon}"></i><span>${text}</span></span>`;
      }
    },
    { headerName: 'Custom Label', field: 'custom', minWidth: 150, flex: .7, valueGetter: () => '', headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-tag' } },
    { headerName: 'Applied', field: 'applied', minWidth: 120, flex: .6, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-calendar' } }
  ];

  defaultColDef: ColDef = { sortable:true, filter:true, floatingFilter:true, resizable:true, wrapHeaderText:true, autoHeaderHeight:true };

  rowData: any[] = [];
  gridApi?: GridApi; // public for template access (*ngIf="gridApi")
  selectedCount = 0;

  ngOnInit(): void { this.generateData(); }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cardId'] && !changes['cardId'].firstChange) {
      this.generateData();
    }
  }

  private generateData() {
    // If cardId is null, fallback to default dataset
    const seed = (this.cardId ?? 1) * 9973; // prime multiplier for dispersion
    const rand = this.createSeededRandom(seed);

    // Vary row count and completion ratio by card
    const base = 28 + ((this.cardId ?? 0) % 5) * 6; // 28,34,40,46,52 pattern
    const variance = Math.floor(rand() * 6); // +0..5
    const rows = base + variance;

    // Different name pools per bucket of cardId to make visual diff obvious
    const namePools = [
      { first: ['Ana','Luis','Carlos','Marta','Jorge','Lucía','Pablo','Elena'], last: ['García','Rodríguez','López','Martínez','Sánchez','Pérez'] },
      { first: ['Sofía','Diego','Valeria','Andrés','Camila','Héctor','Rosa','Iván'], last: ['Fernández','Ruiz','Torres','Flores','Gómez','Vargas'] },
      { first: ['Noah','Emma','Liam','Olivia','Mason','Ava','Ethan','Mia'], last: ['Johnson','Brown','Davis','Miller','Wilson','Moore'] },
      { first: ['Chloe','Lucas','Amelia','Mateo','Zoe','Marco','Eva','Sergio'], last: ['Navarro','Iglesias','Ramos','Delgado','Morales','Castro'] },
      { first: ['Isabella','Elijah','Harper','Logan','Ella','Levi','Aria','Henry'], last: ['Anderson','Thomas','Jackson','White','Harris','Martin'] }
    ];
    const pool = namePools[(this.cardId ?? 0) % namePools.length];

    // Completion ratio tied to seed
    const completionBias = 0.2 + ((this.cardId ?? 0) % 5) * 0.15; // ranges roughly 0.2 .. 0.8

    this.rowData = Array.from({ length: rows }).map((_, i) => {
      const first = pool.first[i % pool.first.length];
      const last = pool.last[(i + 2) % pool.last.length];
      const name = `${first} ${last}`;
      const status = rand() < completionBias ? 'complete' : 'incomplete';
      return {
        name,
        email: name.toLowerCase().replace(/ /g, '.') + '@example.com',
        phone: '+1 (555) ' + String(1000 + ((i * 37) % 9000)).padStart(4, '0'),
        status,
        custom: (this.cardId ?? 0) % 2 === 0 ? 'Priority' : '',
        applied: this.randomRecentDate(rand)
      };
    });

    if (this.gridApi) {
      this.gridApi.setGridOption('rowData', this.rowData);
      // Reset pagination to first page when dataset changes
      this.gridApi.paginationGoToFirstPage();
      this.updatePaginationState();
      this.clearSelection();
    }
  }

  private createSeededRandom(seed: number) {
    // Simple LCG
    let s = seed >>> 0;
    return function() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s & 0xffffffff) / 0x100000000;
    };
  }

  private mockRow(i:number) { return {}; /* deprecated after dynamic generation */ }

  private randomRecentDate(rand: () => number = Math.random): string {
    const now = new Date();
    const past = new Date(now.getTime() - rand() * 30 * 24 * 60 * 60 * 1000);
    const dd = String(past.getDate()).padStart(2,'0');
    const mm = String(past.getMonth()+1).padStart(2,'0');
    const yy = String(past.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  }

  onGridReady(e: GridReadyEvent) { this.gridApi = e.api; this.updatePaginationState(); }
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


