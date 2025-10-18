import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, GridApi, GridReadyEvent, IHeaderParams, CellClickedEvent } from 'ag-grid-community';
import { IHeaderAngularComp } from 'ag-grid-angular';
import { WorkflowRecord } from './workflows-dialog.component';

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
  styles: [` .header-cell i { font-size: .9rem; line-height:1; } `]
})
export class GridHeaderComponent implements IHeaderAngularComp {
  public params: (IHeaderParams & { icon?: string }) | null = null;
  icon?: string;
  agInit(params: IHeaderParams & { icon?: string }): void { this.params = params; this.icon = params.icon; }
  refresh(params: IHeaderParams & { icon?: string }): boolean { this.params = params; this.icon = params.icon; return true; }
}

/* ---------------- Workflows Grid ---------------- */
@Component({
  selector: 'app-workflows-grid',
  standalone: true,
  imports: [CommonModule, FormsModule, AgGridAngular],
  template: `
    <ag-grid-angular class="ag-theme-quartz dw-grid-theme" style="width:100%;height:420px;"
      [rowData]="displayRowData"
      [columnDefs]="columnDefs"
      [defaultColDef]="defaultColDef"
      rowSelection="multiple"
      [suppressRowClickSelection]="true"
      [pagination]="true"
      [paginationPageSize]="pageSize"
      [paginationPageSizeSelector]="pageSizeOptions"
      [rowClassRules]="rowClassRules"
      (gridReady)="onGridReady($event)"
      (selectionChanged)="onSelectionChanged()"
      (firstDataRendered)="onFirstDataRendered()"
      (paginationChanged)="onPaginationChanged()"
      (cellClicked)="onCellClicked($event)">
    </ag-grid-angular>
  `,
  styles: [`
    /* Group header row styling */
    :host ::ng-deep .dw-group-row .ag-cell { background: #0000000a; border-top: 1px solid var(--bs-border-color,#dee2e6); }
    :host ::ng-deep .ag-theme-quartz .ag-cell.dw-group-cell { display:flex; align-items:center; gap:.5rem; padding:.5rem .75rem; }
    :host ::ng-deep .ag-theme-quartz .ag-cell.dw-group-cell i { color: var(--bs-primary,#0d6efd); }
  `]
})
export class WorkflowsGridComponent implements OnChanges {
  @Input() rowData: WorkflowRecord[] = [];

  @Output() editRow = new EventEmitter<WorkflowRecord>();
  @Output() deleteRow = new EventEmitter<WorkflowRecord>();

  pageSize = 10;
  pageSizeOptions = [10, 25, 50, 100];
  currentPage = 0;
  totalPages = 0;
  rowCount = 0;
  rowRangeStart = 0;
  rowRangeEnd = 0;

  columnDefs: ColDef[] = [
    // {
    //   headerName: '',
    //   checkboxSelection: (p) => !(p?.data && (p.data as any).__group === true),
    //   headerCheckboxSelection: true,
    //   width: 48,
    //   pinned: 'left',
    //   sortable: false,
    //   filter: false,
    //   resizable: false,
    //   suppressSizeToFit: true
    // },
    {
      headerName: 'Location',
      field: 'location_name',
      minWidth: 160,
      flex: 1,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-map-pin' },
      colSpan: (p) => (p?.data && (p.data as any).__group === true) ? 100 : 1,
      cellClass: (p) => (p?.data && (p.data as any).__group === true) ? 'dw-group-cell' : '',
      cellRenderer: (p: any) => {
        if (p?.data && p.data.__group === true) {
          const rawName = (p.data.location_name || 'Unknown Location');
          const name = rawName.toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const count = Number(p.data.__count || 0);
          const isOpen = this.expandedGroups.has(String(rawName));
          const chevron = isOpen ? 'icon-chevron-down' : 'icon-chevron-right';
          return `
            <button class="btn btn-xs btn-link p-0 me-1" type="button" data-action="toggle-group" aria-label="Toggle group">
              <i class="feather ${chevron}"></i>
            </button>
            <i class="feather icon-map-pin"></i> <span>${name}</span>
            <span class="ms-2 badge bg-primary-subtle text-primary">${count} workflow${count===1?'':'s'}</span>`;
        }
        // For normal rows, avoid repeating the location value (group header already shows it)
        return '';
      },
      sortable: true,
      comparator: (a: any, b: any, nodeA, nodeB) => {
        // Ensure group rows sort by location and remain before their items if resorted
        const da: any = nodeA?.data || {}; const db: any = nodeB?.data || {};
        const la = (da.location_name || '').toString().toLowerCase();
        const lb = (db.location_name || '').toString().toLowerCase();
        if (da.__group === true && db.__group !== true) return la.localeCompare(lb) || -1;
        if (db.__group === true && da.__group !== true) return la.localeCompare(lb) || 1;
        return la.localeCompare(lb);
      },
      filter: false
    },

    {
      headerName: 'Workflow',
      field: 'workflow_name',
      minWidth: 200,
      flex: 1.2,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-briefcase' },
      cellRenderer: (p: any) => {
        if (p?.data && p.data.__group === true) return '';
        const value = (p.value ?? '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return `<span class="grid-link" role="link" aria-label="Open workflow">${value}</span>`;
      }
    },
    {
      headerName: 'Created On',
      field: 'created_at',
      minWidth: 170,
      flex: .8,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-calendar' },
      headerClass: 'ag-center-header',
      cellClass: 'text-nowrap',
      filter: 'agDateColumnFilter',
      valueGetter: (p: any) => {
        if (p?.data && p.data.__group === true) return null;
        const v = p.data?.created_at;
        if (!v) return null;
        const iso = typeof v === 'string' ? v.replace(' ', 'T') : v;
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? null : d;
      },
      valueFormatter: (p: any) => {
        const d: Date | null = p.value instanceof Date ? p.value : null;
        if (!d) return '';
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${mm}/${dd}/${yyyy}`;
      },
      comparator: (a: any, b: any) => {
        const ta = a instanceof Date ? a.getTime() : 0;
        const tb = b instanceof Date ? b.getTime() : 0;
        return ta - tb;
      }
    },
    {
      headerName: 'Active',
      field: 'is_active',
      minWidth: 110,
      flex: .5,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: 'icon-check-circle' },
      headerClass: 'ag-center-header',
  valueGetter: (p) => (p?.data && p.data.__group === true) ? null : (Number(p.data?.is_active) === 1 ? 1 : 0),
      comparator: (a: any, b: any) => Number(a) - Number(b),
      filter: 'agSetColumnFilter',
      filterParams: {
        values: [1, 0],
        valueFormatter: (p: any) => (Number(p.value) === 1 ? 'Active' : 'Inactive'),
        textFormatter: (val: string) => val
      },
      cellClass: 'text-center',
      cellStyle: { pointerEvents: 'none' },
      cellRenderer: (p: any) => this.activeBadge(p.value)
    },

    {
      headerName: 'Actions',
      field: 'actions',
      minWidth: 140,
      maxWidth: 180,
      pinned: 'right',
      sortable:false,
      filter:false,
      cellRenderer: (p: any) => (p?.data && p.data.__group === true) ? '' : this.actionButtons(p.data),
      cellClass:'dw-actions-cell'
    },

    { headerName: 'workflow ID', field: 'id_workflow', hide: true }
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
  displayRowData: any[] = [];
  rowClassRules = { 'dw-group-row': (p: any) => !!(p?.data && (p.data as any).__group === true) };
  private expandedGroups = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rowData']) {
      this.rebuildAllExpanded();
      this.displayRowData = this.buildGroupedRows(this.rowData || []);
      if (this.gridApi) {
        this.gridApi.setGridOption('rowData', this.displayRowData);
        this.gridApi.paginationGoToFirstPage();
        this.updatePaginationState();
        this.clearSelection();
      }
    }
  }

  constructor(private router: Router) {}

  private actionButtons(rec: WorkflowRecord) {
    if (!rec) return '';
    if ((rec as any).__group === true) return '';
    const disabled = Number((rec as any).is_active ?? 1) === 0;
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

  onCellClicked(e: CellClickedEvent) {
    if (!e?.colDef || !e.event) return;
    if (e?.data && (e.data as any).__group === true) {
      const target = e.event.target as HTMLElement;
      const btn = target?.closest('button[data-action="toggle-group"]') as HTMLButtonElement | null;
      if (btn) {
        const groupName = String((e.data as any)?.location_name || '');
        if (this.expandedGroups.has(groupName)) this.expandedGroups.delete(groupName); else this.expandedGroups.add(groupName);
        this.displayRowData = this.buildGroupedRows(this.rowData || []);
        this.gridApi?.setGridOption('rowData', this.displayRowData);
        this.updatePaginationState();
      }
      return; // ignore other clicks on group rows
    }

    // 1) Botones de Actions
    const target = e.event.target as HTMLElement;
    const btn = target?.closest('button[data-action]') as HTMLButtonElement | null;
    if (btn) {
      const action = btn.getAttribute('data-action');
      const rec = e.data as WorkflowRecord;
      if (action === 'edit')   this.editRow.emit(rec);
      if (action === 'delete') this.deleteRow.emit(rec);
      return;
    }

    // 2) Click en el nombre → navegar
  if (e.colDef.field === 'workflow_name') {
      const id = (e.data as any)?.id_workflow;
      if (id != null) {
        e.event?.preventDefault?.();
        this.router.navigate(['/workflows','edit', id]);
      }
    }
  }

  onGridReady(e: GridReadyEvent) {
    this.gridApi = e.api;
    // Initialize with grouped data
    this.rebuildAllExpanded();
    this.displayRowData = this.buildGroupedRows(this.rowData || []);
    this.gridApi.setGridOption('rowData', this.displayRowData);
    this.updatePaginationState();
  }
  onFirstDataRendered() { this.gridApi?.sizeColumnsToFit(); this.updatePaginationState(); }
  onSelectionChanged()  { this.selectedCount = this.gridApi?.getSelectedNodes().length || 0; }
  clearSelection()      { this.gridApi?.deselectAll(); this.onSelectionChanged(); }
  exportCsv(onlySelected: boolean) { this.gridApi?.exportDataAsCsv({ onlySelected }); }
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

  /** Build a visually grouped dataset: insert a header row per location, followed by its workflows. */
  private buildGroupedRows(data: WorkflowRecord[]): any[] {
    if (!Array.isArray(data) || data.length === 0) return [];
    // Sort by location then by workflow name
    const sorted = [...data].sort((a: any, b: any) => {
      const la = (a?.location_name || '').toString().toLowerCase();
      const lb = (b?.location_name || '').toString().toLowerCase();
      if (la !== lb) return la.localeCompare(lb);
      const wa = (a?.workflow_name || '').toString().toLowerCase();
      const wb = (b?.workflow_name || '').toString().toLowerCase();
      return wa.localeCompare(wb);
    });
    const out: any[] = [];
    let current: string | null = null;
    let buffer: WorkflowRecord[] = [];
    const flush = () => {
      if (current === null) return;
      const count = buffer.length;
      out.push({ __group: true, location_name: current, __count: count });
      if (this.expandedGroups.has(current)) {
        out.push(...buffer);
      }
      buffer = [];
    };
    for (const rec of sorted) {
      const loc = (rec as any)?.location_name ?? 'Unknown';
      if (current === null || String(loc) !== String(current)) {
        flush();
        current = String(loc);
      }
      buffer.push(rec);
    }
    flush();
    return out;
  }

  /** Expand all groups by default based on current data */
  private rebuildAllExpanded(): void {
    this.expandedGroups.clear();
    const names = new Set<string>((this.rowData || []).map((r: any) => String(r?.location_name ?? 'Unknown')));
    names.forEach(n => this.expandedGroups.add(n));
  }
}
