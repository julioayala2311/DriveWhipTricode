import { Component, OnInit, ViewChild, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { AgGridAngular } from "ag-grid-angular";
import {
  ColDef,
  GridReadyEvent,
  GridApi,
  GridOptions,
  FirstDataRenderedEvent,
  SelectionChangedEvent,
  PaginationChangedEvent,
  ICellRendererParams,
} from "ag-grid-community";
import { DriveWhipCoreService } from "../../../../core/services/drivewhip-core/drivewhip-core.service";
import { DriveWhipAdminCommand } from "../../../../core/db/procedures";
import {
  IDriveWhipCoreAPI,
  DriveWhipCommandResponse,
} from "../../../../core/models/entities.model";
import { Utilities } from "../../../../Utilities/Utilities";
import { firstValueFrom } from "rxjs";
import { GridHeaderComponent } from "../home/home-grid.component";

interface DriverStatusEntry {
  stage: string;
  statusName: string;
  isComplete: boolean;
  order?: number;
}

@Component({
  selector: "dw-admin-drivers-page",
  standalone: true,
  imports: [CommonModule, AgGridAngular, GridHeaderComponent],
  templateUrl: "./drivers-page.component.html",
  styleUrls: ["./drivers-page.component.scss"],
})
export class DriversPageComponent implements OnInit {
  @ViewChild(AgGridAngular) grid?: AgGridAngular;
  private gridApi?: GridApi;
  private core = inject(DriveWhipCoreService);

  loading = false;
  error: string | null = null;
  selectedCount = 0;
  rowCount = 0;
  currentPage = 0;
  totalPages = 0;
  pageSize = 25;
  pageSizeOptions: number[] = [10, 25, 50, 100];

  private readonly fallbackRows = [
    {
      id: "sample-1",
      driverId: "D-1001",
      applicantId: "A-1001",
      name: "Sample Driver One",
      email: "driver.one@example.com",
      phone: "+1 (312) 555-0198",
      countryCode: "US",
      stateCode: "IL",
      city: "Chicago",
      status: "Active",
      statuses: [
        {
          stage: "Active",
          statusName: "active",
          isComplete: true,
        },
      ] as DriverStatusEntry[],
    },
    {
      id: "sample-2",
      driverId: "D-1002",
      applicantId: "A-1002",
      name: "Sample Driver Two",
      email: "driver.two@example.com",
      phone: "+1 (470) 555-0145",
      countryCode: "US",
      stateCode: "GA",
      city: "Atlanta",
      status: "Inactive",
      statuses: [
        {
          stage: "Inactive",
          statusName: "inactive",
          isComplete: false,
        },
      ] as DriverStatusEntry[],
    },
  ];

  columnDefs: ColDef[] = [
    {
      headerName: "Driver ID",
      field: "driverId",
      width: 140,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-hash" },
      filter: "agTextColumnFilter",
    },
    {
      headerName: "Applicant ID",
      field: "applicantId",
      width: 140,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-user" },
      filter: "agTextColumnFilter",
    },
    {
      headerName: "Driver",
      field: "name",
      minWidth: 180,
      flex: 1.1,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-user" },
      cellRenderer: (params: ICellRendererParams) => {
        const name = (params.value ?? "")
          .toString()
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<span style="color: var(--bs-primary, #0d6efd)" >${name}</span>`;
      },
    },
    {
      headerName: "Email",
      field: "email",
      minWidth: 220,
      flex: 1.2,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-mail" },
    },
    {
      headerName: "Phone",
      field: "phone",
      width: 160,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-smartphone" },
    },
    {
      headerName: "Country",
      field: "countryCode",
      width: 110,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-globe" },
    },
    {
      headerName: "State",
      field: "stateCode",
      width: 100,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-map" },
    },
    {
      headerName: "City",
      field: "city",
      minWidth: 140,
      flex: 1,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-map-pin" },
    },
    {
      headerName: "Referral",
      field: "referralName",
      minWidth: 140,
      flex: 1,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-user-plus" },
    },
    {
      headerName: "Status",
      field: "status",
      minWidth: 160,
      flex: 1.2,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-activity" },
      autoHeight: true,
      wrapText: true,
      cellClass: "ag-cell-wrap-text",
      valueGetter: (params: any) => {
        const data = params?.data || {};
        const list: DriverStatusEntry[] = Array.isArray(data.statuses)
          ? (data.statuses as DriverStatusEntry[])
          : [];
        if (list.length) {
          return list
            .map((item: DriverStatusEntry) => {
              const stage = (item?.stage || "").toString().trim();
              const normalizedStatus = (item?.statusName || "")
                .toString()
                .trim();
              const statusName =
                normalizedStatus || (item?.isComplete ? "complete" : "incomplete");
              return `${stage || "Stage"} - ${statusName}`;
            })
            .join(" | ");
        }
        return String(params?.value ?? "").trim();
      },
      getQuickFilterText: (params: any) => {
        try {
          return (params?.value ?? "").toString();
        } catch {
          return "";
        }
      },
      cellRenderer: (params: ICellRendererParams) => {
        const list = Array.isArray((params.data as any)?.statuses)
          ? ((params.data as any).statuses as DriverStatusEntry[])
          : [];
        if (list.length) {
          return this.renderStatusBadges(list);
        }
        const fallback = String(params.value ?? "").trim();
        if (!fallback) return "";
        return this.renderStatusBadges([
          {
            stage: fallback,
            statusName: fallback,
            isComplete: /active|complete|approved/i.test(fallback),
          },
        ]);
      },
      filter: "agTextColumnFilter",
      filterParams: {
        caseSensitive: false,
        debounceMs: 150,
        trimInput: true,
      },
    },
  ];

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    floatingFilter: true,
  };

  gridOptions: GridOptions = {
    suppressRowClickSelection: true,
    rowHeight: 48,
    headerHeight: 44,
    pagination: true,
    enableCellTextSelection: true,
    paginationPageSize: this.pageSize,
    paginationPageSizeSelector: this.pageSizeOptions,
    animateRows: true,
    overlayNoRowsTemplate:
      '<div class="ag-overlay-loading-center">No drivers found.</div>',
    overlayLoadingTemplate:
      '<div class="ag-overlay-loading-center"><span class="spinner-border spinner-border-sm" role="status"></span><span class="ms-2">Loading...</span></div>',
  };

  rowData: Array<Record<string, any>> = [];

  ngOnInit(): void {
    void this.loadDrivers();
  }

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
    if (this.loading) {
      this.gridApi.showLoadingOverlay();
    }
    this.updatePaginationState();
    event.api.sizeColumnsToFit({
      defaultMinWidth: 120,
      columnLimits: [{ key: "name", minWidth: 160 }],
    });
  }

  onFirstDataRendered(event: FirstDataRenderedEvent): void {
    event.api.sizeColumnsToFit({
      defaultMinWidth: 120,
      columnLimits: [{ key: "name", minWidth: 160 }],
    });
    this.updatePaginationState();
  }

  onSelectionChanged(event: SelectionChangedEvent): void {
    this.selectedCount = event.api.getSelectedNodes().length;
  }

  onPaginationChanged(event: PaginationChangedEvent): void {
    if (event.api) {
      this.updatePaginationState(event.api);
    }
  }

  async loadDrivers(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.gridApi?.showLoadingOverlay();

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_drivers_list,
      parameters: [],
    } as any;

    try {
      const res = await firstValueFrom(
        this.core.executeCommand<DriveWhipCommandResponse>(api)
      );

      if (!res || res.ok === false) {
        const message = (res as any)?.error?.toString() || "Failed to load drivers";
        this.error = message;
        Utilities.showToast(message, "warning");
        this.rowData = [...this.fallbackRows];
        return;
      }

      const data = Array.isArray(res.data)
        ? Array.isArray(res.data[0])
          ? res.data[0]
          : res.data
        : [];

      this.error = null;
      this.rowData = data.map((row: any) => {
        const driverId = row.id_driver ?? row.ID_DRIVER ?? row.driver_id ?? row.ID ?? null;
        const applicantId = row.id_applicant ?? row.ID_APPLICANT ?? row.applicant_id ?? null;
        const countryCode = row.country_code ?? row.COUNTRY_CODE ?? row.CountryCode ?? null;
        const stateCode = row.state_code ?? row.STATE_CODE ?? row.StateCode ?? null;
        const city = row.city ?? row.City ?? null;
        const referralName = row.referral_name ?? row.REFERRAL_NAME ?? row.Referral ?? null;
        const isActive = row.is_active ?? row.IS_ACTIVE ?? row.active ?? row.Active ?? null;

        const name =
          row.name ?? [row.first_name ?? "", row.last_name ?? ""].join(" ").trim();

        const statusText = isActive ? "Active" : "Inactive";
        const statuses: DriverStatusEntry[] = [
          {
            stage: statusText,
            statusName: statusText.toLowerCase(),
            isComplete: !!isActive,
          },
        ];

        return {
          id: driverId ?? null,
          driverId: driverId ?? null,
          applicantId: applicantId ?? null,
          name: name || "(no name)",
          email: row.email ?? row.email_address ?? "",
          phone: row.phone ?? row.phone_number ?? "",
          countryCode: countryCode ?? "",
          stateCode: stateCode ?? "",
            street: row.street ?? row.Street ?? "",
          city: city ?? "",
          zipCode: row.zip_code ?? row.ZIP_CODE ?? row.ZipCode ?? "",
          referralName: referralName ?? "",
          status: statusText,
          statuses,
        };
      });
    } catch (err) {
      console.error("[DriversPage] loadDrivers error", err);
      this.error = "Failed to load drivers";
      Utilities.showToast(this.error, "error");
      this.rowData = [...this.fallbackRows];
    } finally {
      this.loading = false;
      this.gridApi?.hideOverlay();
      setTimeout(() => {
        this.gridApi?.sizeColumnsToFit();
        this.updatePaginationState();
      }, 50);
    }
  }

  private updatePaginationState(api?: GridApi): void {
    const grid = api ?? this.gridApi;
    if (!grid) return;
    const modelCount =
      grid.getModel()?.getRowCount?.() ?? grid.getDisplayedRowCount();
    this.rowCount = modelCount;
    this.currentPage = grid.paginationGetCurrentPage();
    this.totalPages = Math.max(grid.paginationGetTotalPages(), 0);
    const size = (grid as any).getGridOption?.("paginationPageSize") ?? this.pageSize;
    this.pageSize = size;
    const selector = this.gridOptions.paginationPageSizeSelector;
    this.pageSizeOptions = Array.isArray(selector)
      ? [...selector]
      : [10, 25, 50, 100];
    this.gridOptions.paginationPageSizeSelector = this.pageSizeOptions;
    this.selectedCount = grid.getSelectedNodes().length;
  }

  get displayPageIndex(): number {
    return this.totalPages > 0 ? this.currentPage + 1 : 0;
  }

  get displayTotalPages(): number {
    return this.totalPages > 0 ? this.totalPages : 1;
  }

  clearSelection(): void {
    this.gridApi?.deselectAll();
    this.selectedCount = 0;
  }

  exportCsv(onlySelected: boolean): void {
    this.gridApi?.exportDataAsCsv({ onlySelected });
  }

  copySelected(includeHeaders: boolean = true): void {
    try {
      this.gridApi?.copySelectedRowsToClipboard({ includeHeaders });
      Utilities.showToast("Copied selected rows to clipboard", "success");
    } catch (e) {
      const rows = this.gridApi?.getSelectedRows?.() || [];
      if (rows.length) {
        const text = this.rowsToTsv(rows, includeHeaders);
        navigator.clipboard?.writeText(text).catch(() => {/* ignore */});
      }
    }
  }

  private rowsToTsv(rows: any[], includeHeaders: boolean): string {
    if (!rows?.length) return "";
    const cols = this.columnDefs.map(c => String(c.field || c.headerName || "")).filter(Boolean);
    const header = includeHeaders ? cols.join("\t") + "\n" : "";
    const body = rows
      .map(r =>
        cols
          .map(k => {
            const v = (r as any)[k as any];
            return v == null ? "" : String(v).replace(/\n/g, " ");
          })
          .join("\t")
      )
      .join("\n");
    return header + body;
  }

  goToPreviousPage(): void {
    this.gridApi?.paginationGoToPreviousPage();
    this.updatePaginationState();
  }

  goToNextPage(): void {
    this.gridApi?.paginationGoToNextPage();
    this.updatePaginationState();
  }

  onCellKeyDown(event: any): void {
    const key = (event.event as KeyboardEvent)?.key?.toLowerCase?.() || "";
    const ctrl = (event.event as KeyboardEvent)?.ctrlKey || (event.event as KeyboardEvent)?.metaKey;
    if (ctrl && key === "c") {
      const api = event.api;
      const ranges = (api as any).getCellRanges?.() || [];
      if (ranges && ranges.length && (api as any).copySelectedRangeToClipboard) {
        try {
          (api as any).copySelectedRangeToClipboard({ includeHeaders: true });
          return;
        } catch {}
      }
      const selectedRows = api.getSelectedRows?.() || [];
      if (selectedRows.length) {
        try {
          api.copySelectedRowsToClipboard({ includeHeaders: true });
          return;
        } catch {}
      }
      const value = (event.value ?? "").toString();
      if (value) {
        navigator.clipboard?.writeText(value).catch(() => {/* ignore */});
      }
    }
  }

  private renderStatusBadges(list: DriverStatusEntry[]): string {
    if (!Array.isArray(list) || !list.length) return "";

    const renderOne = (item: DriverStatusEntry) => {
      const stage = (item.stage || "Stage").toString().trim();
      const normalizedStatus = (item.statusName || "")
        .toString()
        .trim()
        .toLowerCase();
      const isComplete = item.isComplete || /active|complete/i.test(normalizedStatus);

      const label = `${stage || "Stage"} - ${normalizedStatus || "status"}`;

      let colorClass = "bg-primary-subtle text-primary";
      let icon = "icon-shield";

      if (/active|complete|approved/i.test(normalizedStatus)) {
        colorClass = "bg-success-subtle text-success";
        icon = "icon-check-circle";
      } else if (/inactive|pending|incomplete|review/i.test(normalizedStatus)) {
        colorClass = "bg-warning-subtle text-warning";
        icon = "icon-alert-circle";
      }

      return `<span class="badge ${colorClass} d-inline-flex align-items-center gap-1 status-badge"><i class="feather ${icon}"></i><span>${label}</span></span>`;
    };

    const deduped: DriverStatusEntry[] = [];
    const seen = new Set<string>();
    for (let idx = list.length - 1; idx >= 0; idx--) {
      const entry = list[idx];
      const key = `${(entry.stage || "").toLowerCase()}|${(
        entry.statusName || ""
      )
        .toString()
        .toLowerCase()}|${entry.order ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.unshift(entry);
      }
    }

    return `<div class="d-flex flex-wrap gap-1">${deduped
      .map(renderOne)
      .join("")}</div>`;
  }
}
