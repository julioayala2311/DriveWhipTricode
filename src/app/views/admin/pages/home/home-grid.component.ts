import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, IHeaderParams, CellClickedEvent } from 'ag-grid-community';
import { IHeaderAngularComp } from 'ag-grid-angular';
import { Router } from '@angular/router';
import { LocationsRecord } from '../../../../core/models/locations.model';

/* ---------------- Grid Header (with icon) ---------------- */
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
  styles: [`.header-cell i { font-size: .9rem; line-height:1; }`]
})
export class GridHeaderComponent implements IHeaderAngularComp {
  public params: (IHeaderParams & { icon?: string }) | null = null;
  icon?: string;
  agInit(params: IHeaderParams & { icon?: string }): void { this.params = params; this.icon = params.icon; }
  refresh(params: IHeaderParams & { icon?: string }): boolean { this.params = params; this.icon = params.icon; return true; }
}

/* ---------------- Locations Grid ---------------- */
@Component({
  selector: 'app-locations-grid',
  standalone: true,
  imports: [CommonModule, FormsModule, AgGridAngular],
  template: `
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
                     (paginationChanged)="onPaginationChanged()"
                     (cellClicked)="onCellClicked($event)"
                     (rowClicked)="onRowClicked($event)">
    </ag-grid-angular>
  `
})
export class HomeGridComponent implements OnChanges {
  @Input() rowData: LocationsRecord[] = [];

  // 👉 Eventos al padre
  @Output() editRow = new EventEmitter<LocationsRecord>();
  @Output() deleteRow = new EventEmitter<LocationsRecord>();

  // Pagination
  pageSize = 10;
  pageSizeOptions = [10, 25, 50, 100];
  currentPage = 0;
  totalPages = 0;
  rowCount = 0;
  rowRangeStart = 0;
  rowRangeEnd = 0;

  constructor(private router: Router) {}

  columnDefs: ColDef[] = [
    { headerName: '', checkboxSelection: true, headerCheckboxSelection: true, width: 48, pinned: 'left', sortable: false, filter: false, resizable: false, suppressSizeToFit: true },

    // LOCATION as SPA "link"
    {
      headerName: 'Location',
      field: 'location_name',
      minWidth: 160,
      flex: 1,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-map-pin' },
      cellRenderer: (p: any) => {
        const name = (p.value ?? '').toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<span class="grid-link" role="link" aria-label="Open locations">${name}</span>`;
      }
    },

    { headerName: 'Address', field: 'market_address', minWidth: 180, flex: 1.1, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-map' } },

    {
      headerName: 'Applicants',
      field: 'applicants_count',
      minWidth: 130,
      flex: .6,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-users' },
      headerClass: 'ag-center-header',
      filter: 'agNumberColumnFilter',
      comparator: (a: any, b: any) => (Number(a) || 0) - (Number(b) || 0),
      cellClass: ['applicants-cell'],
      cellStyle: { textAlign: 'center' },
      cellRenderer: (p: any) => {
        const n = Number(p.value) || 0;
        const tone = n > 0 ? 'text-primary' : 'text-muted';
        return `
          <span class="applicants-cell-content" title="${n} applicants">
            <i class="feather icon-users ${tone}"></i>
            <span>${n}</span>
          </span>
        `;
      }
    },

    {
      headerName: 'Status',
      field: 'active',
      minWidth: 90,
      flex: .5,
      sortable: true,
      filter: true,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-check-circle' },
      headerClass: 'ag-center-header',
      cellClass: 'text-center',
      cellRenderer: (p: any) => this.activeBadge(p.value)
    },

    {
      headerName: 'Actions',
      field: 'actions',
      minWidth: 140,
      maxWidth: 180,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: (p: any) => this.actionButtons(p.data),
      cellClass: 'dw-actions-cell'
    },

    { headerName: 'Location ID', field: 'id_location', hide: true },
    { headerName: 'Market ID', field: 'id_market', hide: true },
    { headerName: 'Workflow ID', field: 'id_workflow', hide: true }
  ];

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    floatingFilter: true,
    resizable: true,
    wrapHeaderText: true,
    autoHeaderHeight: true
  };

  gridApi?: GridApi;
  selectedCount = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rowData'] && this.gridApi) {
      this.gridApi.setGridOption('rowData', this.rowData || []);
      this.gridApi.paginationGoToFirstPage();
      this.updatePaginationState();
      this.clearSelection();
    }
  }

  onGridReady(e: GridReadyEvent) {
    this.gridApi = e.api;
    this.updatePaginationState();
  }

  onFirstDataRendered() {
    this.gridApi?.sizeColumnsToFit();
    this.updatePaginationState();
  }

  onSelectionChanged() {
    this.selectedCount = this.gridApi?.getSelectedNodes().length || 0;
  }

  clearSelection() {
    this.gridApi?.deselectAll();
    this.onSelectionChanged();
  }

  exportCsv(onlySelected: boolean) {
    this.gridApi?.exportDataAsCsv({ onlySelected });
  }

  onPaginationChanged() {
    this.updatePaginationState();
  }

  // ---- CLICK HANDLER (botones y link) ----
  onCellClicked(e: CellClickedEvent) {
    if (!e?.colDef || !e.event) return;

    // 1) Botones dentro de Actions
    const target = e.event.target as HTMLElement;
    const btn = target?.closest('button[data-action]') as HTMLButtonElement | null;
    if (btn) {
      const action = btn.getAttribute('data-action');
      const rec = e.data as LocationsRecord;
      if (action === 'edit')   this.editRow.emit(rec);
      if (action === 'delete') this.deleteRow.emit(rec);
      return;
    }

    // 2) Click en Location -> navegar
    if (e.colDef.field === 'location_name') {
      const id = (e.data as any)?.id_location;
      if (id != null) {
        e.event?.preventDefault?.();
        this.router.navigate(['/locations'], { queryParams: { id_location: id } });
      }
    }
  }

  onRowClicked(e: any) {
    // Evita que botones de Actions disparen row navigation
    const target = e.event?.target as HTMLElement | null;
    if (target && target.closest('button,[data-action]')) return;

    // Navegación básica al hacer click en la fila (opcional)
    const id = e?.data?.id_location;
    if (id != null) {
      this.router.navigate(['/locations'], { queryParams: { id_location: id } });
    }
  }

  private actionButtons(rec: LocationsRecord) {
    if (!rec) return '';
    const disabled = Number((rec as any).active ?? 1) === 0;
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
    const label = active ? 'Active' : 'Inactive';
    return `<span class="${cls}" style="font-size:11px; letter-spacing:.5px;">${label}</span>`;
  }

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
  goToNext()     { this.gridApi?.paginationGoToNextPage();     this.updatePaginationState(); }
}
