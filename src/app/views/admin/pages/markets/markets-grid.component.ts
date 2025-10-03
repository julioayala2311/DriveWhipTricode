import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, IHeaderParams } from 'ag-grid-community';
import { IHeaderAngularComp } from 'ag-grid-angular';

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
  styles: [`
    .header-cell i { font-size: .9rem; line-height:1; }
  `]
})
export class GridHeaderComponent implements IHeaderAngularComp {
  public params: (IHeaderParams & { icon?: string }) | null = null;
  icon?: string;

  agInit(params: IHeaderParams & { icon?: string }): void {
    this.params = params;
    this.icon = params.icon;
  }
  refresh(params: IHeaderParams & { icon?: string }): boolean {
    this.params = params;
    this.icon = params.icon;
    return true;
  }
}

/* ---------------- Markets Grid ---------------- */
@Component({
  selector: 'app-markets-grid',
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
                     (paginationChanged)="onPaginationChanged()">
    </ag-grid-angular>
  `,
  styles: [`
    /* center header helper when headerClass: 'ag-center-header' is used */
    .ag-center-header .ag-header-cell-label { justify-content: center; }

    /* Status badges */
    .status-badge {
      display: inline-block;
      padding: .25rem .5rem;
      border-radius: .5rem;
      font-size: .75rem;
      line-height: 1;
      white-space: nowrap;
    }
    .badge-on  { background: #d1e7dd; color: #0f5132; } /* success-subtle */
    .badge-off { background: #f8d7da; color: #842029; } /* danger-subtle */

    .text-center { text-align: center; }
  `]
})
export class MarketsGridComponent implements OnChanges {
  /** Rows received from parent */
  @Input() rowData: any[] = [];

  // Pagination
  pageSize = 10;
  pageSizeOptions = [10, 25, 50, 100];
  currentPage = 0;
  totalPages = 0;
  rowCount = 0;
  rowRangeStart = 0;
  rowRangeEnd = 0;

  columnDefs: ColDef[] = [
    { headerName: '', checkboxSelection: true, headerCheckboxSelection: true, width: 48, pinned: 'left', sortable: false, filter: false, resizable: false, suppressSizeToFit: true },

    // Market name (plain text)
    {
      headerName: 'Market',
      field: 'name',
      minWidth: 160,
      flex: 1,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-map-pin' }
    },

    { headerName: 'Notes', field: 'notes', minWidth: 160, flex: 1, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-file-text' } },

    // Active as non-interactive badge (no click changes)
    {
      headerName: 'Active',
      field: 'is_active',
      minWidth: 110,
      flex: .5,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-check-circle' },
      headerClass: 'ag-center-header',
      valueGetter: (p) => Number(p.data?.is_active) === 1 ? 1 : 0, // normalize 1/0
      comparator: (a: any, b: any) => Number(a) - Number(b),
      filter: 'agSetColumnFilter',
      filterParams: {
        values: [1, 0],
        valueFormatter: (p: any) => (Number(p.value) === 1 ? 'Active' : 'Inactive'),
        textFormatter: (val: string) => val
      },
      cellClass: 'text-center',
      cellStyle: { pointerEvents: 'none' }, // ← evita cualquier click/hover efecto
      cellRenderer: (p: any) => {
        const on = Number(p.value) === 1;
        const label = on ? 'Active' : 'Inactive';
        const cls = on ? 'badge-on' : 'badge-off';
        return `<span class="status-badge ${cls}">${label}</span>`;
      }
    },

    { headerName: 'Street', field: 'street_address', minWidth: 200, flex: 1.2, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-home' } },
    { headerName: 'City', field: 'city', minWidth: 140, flex: .8, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-map' } },
    { headerName: 'State/Region', field: 'state_region', minWidth: 160, flex: .9, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-compass' } },
    { headerName: 'Postal Code', field: 'postal_code', minWidth: 130, flex: .6, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-hash' } },
    { headerName: 'Country', field: 'country_code', minWidth: 110, flex: .5, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-globe' } },

    {
      headerName: 'Latitude',
      field: 'latitude',
      minWidth: 120,
      flex: .6,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-navigation' },
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => p.value != null ? Number(p.value).toFixed(6) : ''
    },
    {
      headerName: 'Longitude',
      field: 'longitude',
      minWidth: 120,
      flex: .6,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-navigation' },
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => p.value != null ? Number(p.value).toFixed(6) : ''
    },

    // Hidden technical ID
    { headerName: 'Market ID', field: 'id_market', hide: true }
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

  private updatePaginationState() {
    if (!this.gridApi) return;
    this.rowCount = this.gridApi.getDisplayedRowCount();
    this.currentPage = this.gridApi.paginationGetCurrentPage();
    this.totalPages = this.gridApi.paginationGetTotalPages();
    const pageSize = (this.gridApi as any).getGridOption?.('paginationPageSize') || this.pageSize;
    this.rowRangeStart = this.currentPage * pageSize;
    this.rowRangeEnd = Math.min(this.rowRangeStart + pageSize, this.rowCount);
  }

  goToPrevious() {
    this.gridApi?.paginationGoToPreviousPage();
    this.updatePaginationState();
  }

  goToNext() {
    this.gridApi?.paginationGoToNextPage();
    this.updatePaginationState();
  }
}
