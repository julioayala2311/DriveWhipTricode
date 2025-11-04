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

interface ApplicantStatusEntry {
  stage: string;
  statusName: string;
  isComplete: boolean;
  order?: number;
}

@Component({
  selector: "dw-admin-applicants-page",
  standalone: true,
  imports: [CommonModule, AgGridAngular, GridHeaderComponent],
  templateUrl: "./applicants-page.component.html",
  styleUrls: ["./applicants-page.component.scss"],
})
export class ApplicantsPageComponent implements OnInit {
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
      applicantId: "A-1001",
      name: "Reginald Harper",
      email: "reginald.harper@example.com",
      phone: "+1 (312) 555-0198",
      status: "Upload Images - complete",
      statuses: [
        {
          stage: "Upload Images",
          statusName: "complete",
          isComplete: true,
        },
        {
          stage: "Background Check",
          statusName: "complete",
          isComplete: true,
        },
      ] as ApplicantStatusEntry[],
    },
    {
      id: "sample-2",
      applicantId: "A-1002",
      name: "Ariya Whitfield",
      email: "awhitfield@example.com",
      phone: "+1 (470) 555-0145",
      status: "Upload Images - incomplete",
      statuses: [
        {
          stage: "Upload Images",
          statusName: "incomplete",
          isComplete: false,
        },
      ] as ApplicantStatusEntry[],
    },
  ];

  columnDefs: ColDef[] = [
    {
      headerName: "ID",
      field: "applicantId",
      width: 140,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-hash" },
      filter: "agTextColumnFilter",
    },
    {
      headerName: "Applicant",
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
      headerName: "Stage",
      field: "stageName",
      minWidth: 170,
      flex: 1,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-layers" },
    },
    {
      headerName: "Location",
      field: "locationName",
      minWidth: 170,
      flex: 1,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-map-pin" },
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
      // Provide a plain-text value for filtering/quick filter, independent of the badge renderer
      valueGetter: (params: any) => {
        const data = params?.data || {};
        const list: ApplicantStatusEntry[] = Array.isArray(data.statuses)
          ? (data.statuses as ApplicantStatusEntry[])
          : [];
        if (list.length) {
          const parts = list.map((item: ApplicantStatusEntry) => {
            const stage = (item?.stage || "").toString().trim();
            const normalizedStatus = (item?.statusName || "")
              .toString()
              .trim();
            const isReviewFiles = stage.toLowerCase() === "review files";
            const isAllFilesApproved = stage.toLowerCase() === "all files approved";
            const isRecollecting = !isReviewFiles && !isAllFilesApproved && /\bre-collecting\b/i.test(stage);
            if (isReviewFiles || isAllFilesApproved || isRecollecting) {
              return stage;
            }
            const statusName =
              normalizedStatus || (item?.isComplete ? "complete" : "incomplete");
            return `${stage || "Stage"} - ${statusName}`;
          });
          return parts.join(" | ");
        }
        const fallback = String(params?.value ?? "").trim();
        return fallback;
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
          ? ((params.data as any).statuses as ApplicantStatusEntry[])
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
            isComplete: /complete|approved/i.test(fallback),
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
    paginationPageSize: this.pageSize,
    paginationPageSizeSelector: this.pageSizeOptions,
    animateRows: true,
    overlayNoRowsTemplate:
      '<div class="ag-overlay-loading-center">No applicants found.</div>',
    overlayLoadingTemplate:
      '<div class="ag-overlay-loading-center"><span class="spinner-border spinner-border-sm" role="status"></span><span class="ms-2">Loading...</span></div>',
  };

  rowData: Array<Record<string, any>> = [];

  ngOnInit(): void {
    void this.loadApplicants();
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

  async loadApplicants(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.gridApi?.showLoadingOverlay();

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_list,
      parameters: [],
    } as any;

    try {
      const res = await firstValueFrom(
        this.core.executeCommand<DriveWhipCommandResponse>(api)
      );

      if (!res || res.ok === false) {
        const message =
          (res as any)?.error?.toString() || "Failed to load applicants";
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
        const applicantId =
          row.id_applicant ??
          row.ID_APPLICANT ??
          row.id ??
          row.ID ??
          row.applicant_id ??
          null;
        const stageName =
          row.stage_name ??
          row.stage ??
          row.Stage ??
          row.current_stage ??
          row.currentStage ??
          null;
        const locationName =
          row.location_name ??
          row.location ??
          row.Location ??
          row.locationName ??
          row.LocationName ??
          null;
        const statusSource =
          row.status ??
          row.Status ??
          row.statuses ??
          row.status_list ??
          row.statusList ??
          row.status_json ??
          row.statusJson ??
          null;
        const parsed = this.parseStatuses(statusSource);
        let statuses = parsed.list;
        if (!statuses.length) {
          const fallbackStatus = String(
            row.status ??
              row.Status ??
              row.stage ??
              row.stage_name ??
              row.applicant_status ??
              ""
          ).trim();
          const stageCandidate =
            stageName ??
            (String(row.stage ?? row.Stage ?? "").trim() || null);
          const stageLabel = stageCandidate || fallbackStatus || "Stage";
          if (fallbackStatus || stageLabel) {
            statuses = [
              {
                stage: stageLabel,
                statusName: fallbackStatus || stageLabel,
                isComplete: /complete|approved|active/i.test(fallbackStatus),
              },
            ];
          }
        }
        const statusText = statuses
          .map((s) => `${s.stage} - ${s.statusName}`)
          .join(", ");

        return {
          id: applicantId ?? null,
          applicantId: applicantId ?? null,
          stageName: stageName ?? null,
          locationName: locationName ?? null,
          name:
            row.name ??
            [row.first_name ?? "", row.last_name ?? ""].join(" ").trim(),
          email: row.email ?? row.email_address ?? "",
          phone: row.phone ?? row.phone_number ?? "",
          status: statusText,
          statuses,
        };
      });
    } catch (err) {
      console.error("[ApplicantsPage] loadApplicants error", err);
      this.error = "Failed to load applicants";
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
    const size =
      (grid as any).getGridOption?.("paginationPageSize") ?? this.pageSize;
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

  goToPreviousPage(): void {
    this.gridApi?.paginationGoToPreviousPage();
    this.updatePaginationState();
  }

  goToNextPage(): void {
    this.gridApi?.paginationGoToNextPage();
    this.updatePaginationState();
  }

  private renderStatusBadges(list: ApplicantStatusEntry[]): string {
    if (!Array.isArray(list) || !list.length) return "";

    const renderOne = (item: ApplicantStatusEntry) => {
      const stage = (item.stage || "Stage").toString().trim();
      const isReviewFiles = stage.toLowerCase() === "review files";
      const isAllFilesApproved = stage.toLowerCase() === "all files approved";
      const isRecollecting =
        !isReviewFiles && !isAllFilesApproved && /\bre-collecting\b/i.test(stage);
      const normalizedStatus = (item.statusName || "")
        .toString()
        .trim()
        .toLowerCase();
      const isComplete = item.isComplete || normalizedStatus === "complete";

      let label: string;
      if (isReviewFiles || isAllFilesApproved || isRecollecting) {
        label = stage;
      } else {
        label = `${stage || "Stage"} - ${normalizedStatus || "status"}`;
      }

      let colorClass = "bg-primary-subtle text-primary";
      let icon = "icon-shield";

      if (isAllFilesApproved) {
        colorClass = "bg-success-subtle text-success";
        icon = "icon-check-circle";
      } else if (isReviewFiles) {
        colorClass = "bg-info text-white";
        icon = "icon-folder";
      } else if (isRecollecting) {
        colorClass = "bg-info-subtle text-info";
        icon = "icon-clock";
      } else if (isComplete) {
        colorClass = "bg-success-subtle text-success";
        icon = "icon-check-circle";
      } else if (/pending|incomplete|review/i.test(normalizedStatus)) {
        colorClass = "bg-warning-subtle text-warning";
        icon = "icon-alert-circle";
      }

      return `<span class="badge ${colorClass} d-inline-flex align-items-center gap-1 status-badge"><i class="feather ${icon}"></i><span>${label}</span></span>`;
    };

    const deduped: ApplicantStatusEntry[] = [];
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

  private parseStatuses(rawStatusJson: any): {
    list: ApplicantStatusEntry[];
    last: ApplicantStatusEntry | null;
  } {
    const empty = { list: [] as ApplicantStatusEntry[], last: null as ApplicantStatusEntry | null };
    if (!rawStatusJson) return empty;

    let arr: any;
    try {
      arr =
        typeof rawStatusJson === "string"
          ? JSON.parse(rawStatusJson)
          : rawStatusJson;
    } catch {
      try {
        const s = String(rawStatusJson).trim();
        const repaired = s.endsWith("]") ? s : s + "]";
        arr = JSON.parse(repaired);
      } catch {
        return empty;
      }
    }

    if (!Array.isArray(arr) || !arr.length) return empty;

    const list = arr
      .filter((x: any) => x && typeof x === "object")
      .map((x: any) => {
        const stage = String(x.stage ?? x.Stage ?? "").trim() || "Stage";
        const statusNameRaw = String(
          x.statusName ?? x.status ?? x.Status ?? ""
        )
          .trim()
          .toLowerCase();
        const normalized =
          statusNameRaw === "complete"
            ? "complete"
            : statusNameRaw === "incomplete"
            ? "incomplete"
            : statusNameRaw || "status";
        const order = typeof x.order === "number" ? x.order : undefined;
        return {
          stage,
          statusName: normalized,
          isComplete: normalized === "complete",
          order,
        } as ApplicantStatusEntry;
      });

    const last = list.length ? list[list.length - 1] : null;
    return { list, last };
  }
}
