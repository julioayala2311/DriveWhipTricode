import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, IHeaderParams } from 'ag-grid-community';
import { IHeaderAngularComp } from 'ag-grid-angular';
import { Router } from '@angular/router';

/* ---------------- Grid Header (con icono) ---------------- */
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
                     (cellClicked)="onCellClicked($event)">
    </ag-grid-angular>
  `,
  styles: [`
    /* Centrado del encabezado cuando se usa headerClass: 'ag-center-header' */
    .ag-center-header .ag-header-cell-label { justify-content: center; }

    /* Link visual en la columna Location */
    .grid-link {
      cursor: pointer;                 /* mano al pasar */
      color: var(--bs-primary, #0d6efd);
      text-decoration: underline;
    }
    .grid-link:hover { filter: brightness(0.9); }

    /* Ajustes visuales para Applicants centrado */
    .applicants-cell { text-align: center; }
    .applicants-cell .applicants-cell-content {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: .25rem;
      width: 100%;
    }
    .applicants-cell .feather { width: 14px; height: 14px; line-height: 1; }
  `]
})
export class LocationsGridComponent implements OnChanges {
  /** Filas recibidas desde el componente padre */
  @Input() rowData: any[] = [];

  // Paginación
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

    // LOCATION como <a> link SPA
    {
      headerName: 'Location',
      field: 'location_name',
      minWidth: 160,
      flex: 1,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-map-pin' },
      cellRenderer: (p: any) => {
        const name = (p.value ?? '').toString().replace(/"/g, '&quot;');
        const id   = p.data?.id_location;
        const href = id != null ? `/openngs/${encodeURIComponent(id)}` : '#';
        return `<a class="grid-link" href="${href}" role="link" aria-label="Open openings for ${name}">${name}</a>`;
      }
    },

    { headerName: 'Market', field: 'market_name', minWidth: 140, flex: .9, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-map' } },
    { headerName: 'Workflow', field: 'workflow_name', minWidth: 180, flex: 1.1, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-git-branch' } },
    { headerName: 'Address', field: 'market_address', minWidth: 180, flex: 1.1, headerComponent: GridHeaderComponent, headerComponentParams: { icon: 'icon-map' } },

    {
      headerName: 'Applicants',
      field: 'applicants_count',
      minWidth: 130,
      flex: .6,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-users' },
      headerClass: 'ag-center-header',          // centra el encabezado
      filter: 'agNumberColumnFilter',
      comparator: (a: any, b: any) => (Number(a) || 0) - (Number(b) || 0),
      cellClass: ['applicants-cell'],           // centrado del contenido
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

    // IDs ocultos (útiles para acciones)
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

  /** Navegación SPA al hacer click en la celda "Location" (previene el href) */
  onCellClicked(evt: any) {
    if (evt?.colDef?.field === 'location_name' && evt?.data?.id_location != null) {
      evt.event?.preventDefault?.(); // evita navegación por el href
      this.router.navigate(['/openngs', evt.data.id_location]);
    }
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
