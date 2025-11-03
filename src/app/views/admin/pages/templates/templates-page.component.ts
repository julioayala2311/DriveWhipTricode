import { Component, OnInit, ViewChild, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { AgGridAngular } from "ag-grid-angular";
import {
  ColDef,
  GridApi,
  GridOptions,
  GridReadyEvent,
  FirstDataRenderedEvent,
  SelectionChangedEvent,
  PaginationChangedEvent,
  CellClickedEvent,
} from "ag-grid-community";
import { GridHeaderComponent } from "../home/home-grid.component";
import { DriveWhipCoreService } from "../../../../core/services/drivewhip-core/drivewhip-core.service";
import { DriveWhipAdminCommand } from "../../../../core/db/procedures";
import {
  DriveWhipCommandResponse,
  IDriveWhipCoreAPI,
} from "../../../../core/models/entities.model";
import { Utilities } from "../../../../Utilities/Utilities";
import { firstValueFrom } from "rxjs";
import { FormsModule } from "@angular/forms";

interface TemplateRow {
  id: string | number | null;
  name: string;
  code: string;
  format: string | null;
  messageType: string | null;
  lastEdited: string | null;
  lastEditedBy: string | null;
}

@Component({
  selector: "dw-templates-page",
  standalone: true,
  imports: [CommonModule, FormsModule, AgGridAngular, GridHeaderComponent],
  templateUrl: "./templates-page.component.html",
  styleUrls: ["./templates-page.component.scss"],
})
export class TemplatesPageComponent implements OnInit {
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
  showCreateModal = false;
  newTemplate = {
    code: "",
    name: "",
    format: "",
    messageType: "Email",
    lastEditedBy: "",
  };

  private readonly fallbackRows: TemplateRow[] = [
    {
      id: "TPL-001",
      code: "welcome_email",
      name: "Welcome Email",
      format: "Email",
      messageType: "EMAIL",
      lastEdited: "2025-02-10 09:32",
      lastEditedBy: "admin@drivewhip.com",
    },
    {
      id: "TPL-002",
      code: "sms_followup",
      name: "Follow-up SMS",
      format: "SMS",
      messageType: "SMS",
      lastEdited: "2025-02-08 18:15",
      lastEditedBy: "automation@drivewhip.com",
    },
    {
      id: "TPL-003",
      code: "reminder_email",
      name: "Reminder Email",
      format: "Email",
      messageType: "EMAIL",
      lastEdited: "2025-01-26 11:45",
      lastEditedBy: "support@drivewhip.com",
    },
  ];

  columnDefs: ColDef[] = [
    {
      headerName: "Template Name",
      field: "name",
      minWidth: 220,
      flex: 1.4,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-file-text" },
      cellRenderer: (p: any) => {
        const text = (p.value ?? "")
          .toString()
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<span class="grid-link">${text}</span>`;
      },
    },
    {
      headerName: "Format",
      field: "format",
      minWidth: 140,
      flex: 0.8,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-tag" },
    },
    {
      headerName: "Message Type",
      field: "messageType",
      minWidth: 140,
      flex: 0.8,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-rss" },
    },
    {
      headerName: "Last Edited",
      field: "lastEdited",
      minWidth: 160,
      flex: 0.8,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-clock" },
    },
    {
      headerName: "Last Edited By",
      field: "lastEditedBy",
      minWidth: 160,
      flex: 0.9,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-user" },
    },
    {
      headerName: "Actions",
      field: "__actions",
      width: 210,
      sortable: false,
      filter: false,
      resizable: false,
      suppressSizeToFit: true,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-sliders" },
      cellRenderer: () => {
        return `
          <div class="d-flex gap-1 template-actions-inline">
            <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit">Edit</button>
            <button type="button" class="btn btn-sm btn-outline-primary" data-action="clone">Clone</button>
            <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete">Disable</button>
          </div>
        `;
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
      '<div class="ag-overlay-loading-center">No templates found.</div>',
    overlayLoadingTemplate:
      '<div class="ag-overlay-loading-center"><span class="spinner-border spinner-border-sm" role="status"></span><span class="ms-2">Loading...</span></div>',
  };

  rowData: TemplateRow[] = [];

  ngOnInit(): void {
    void this.loadTemplates();
  }

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
    if (this.loading) {
      this.gridApi.showLoadingOverlay();
    }
    this.updatePaginationState();
    event.api.sizeColumnsToFit({
      defaultMinWidth: 140,
      columnLimits: [{ key: "name", minWidth: 220 }],
    });
  }

  onFirstDataRendered(event: FirstDataRenderedEvent): void {
    event.api.sizeColumnsToFit({
      defaultMinWidth: 140,
      columnLimits: [{ key: "name", minWidth: 220 }],
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

  async loadTemplates(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.gridApi?.showLoadingOverlay();

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.notification_templates_crud,
      parameters: ["R", null, null, null, null, null, null, null],
    } as any;

    try {
      const res = await firstValueFrom(
        this.core.executeCommand<DriveWhipCommandResponse>(api)
      );

      if (!res || res.ok === false) {
        const message =
          (res as any)?.error?.toString() || "Failed to load templates";
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
        const id =
          row.id_template ??
          row.id ??
          row.template_id ??
          row.ID_TEMPLATE ??
          row.ID ??
          null;
        const code =
          (row.code ?? row.template_code ?? row.name ?? `tpl-${id ?? ""}`)
            ?.toString()
            .trim() || "";
        const name =
          (row.name ?? row.description ?? row.subject ?? `Template ${id ?? ""}`)
            ?.toString()
            .trim() || "";
        const format = (row.type ?? row.template_type ?? row.category ?? null)
          ?.toString()
          .trim() || null;
        const messageType = (row.channel ?? row.delivery ?? row.method ?? null)
          ?.toString()
          .trim() || null;
        const lastEdited =
          row.updated_at ?? row.last_modified ?? row.modified_at ?? null;
        const lastEditedBy =
          row.updated_by ??
          row.updatedBy ??
          row.modified_by ??
          row.modifiedBy ??
          row.last_modified_by ??
          null;

        return {
          id,
          name,
          code,
          format,
          messageType,
          lastEdited: lastEdited ? String(lastEdited) : null,
          lastEditedBy: lastEditedBy ? String(lastEditedBy) : null,
        };
      });
    } catch (err) {
      console.error("[TemplatesPage] loadTemplates error", err);
      this.error = "Failed to load templates";
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

  onCellClicked(event: CellClickedEvent): void {
    const target = event.event?.target as HTMLElement | null;
    if (!target) return;
    if (event.colDef.field !== "__actions") return;

    const actionBtn = target.closest(
      "button[data-action]"
    ) as HTMLButtonElement | null;
    if (actionBtn) {
      event.event?.preventDefault();
      event.event?.stopPropagation();
      const action = actionBtn.dataset.action ?? "";
      this.onActionClick(action, event.data as TemplateRow);
    }
  }

  openCreateTemplate(): void {
    this.newTemplate = {
      code: "",
      name: "",
      format: "",
      messageType: "Email",
      lastEditedBy: "",
    };
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
  }

  saveTemplate(): void {
    const { code, name, format, messageType, lastEditedBy } = this.newTemplate;
    if (!code.trim() || !name.trim()) {
      Utilities.showToast("Template code and name are required", "warning");
      return;
    }
    const now = new Date();
    const row: TemplateRow = {
      id: `new-${Date.now()}`,
      code: code.trim(),
      name: name.trim(),
      format: format.trim() || null,
      messageType: messageType.trim() || null,
      lastEdited: now.toISOString(),
      lastEditedBy: lastEditedBy.trim() || "You",
    };
    this.rowData = [row, ...this.rowData];
    Utilities.showToast("Template draft added", "success");
    this.closeCreateModal();
  }

  onActionClick(action: string, row: TemplateRow): void {
    switch (action) {
      case "edit":
        Utilities.showToast(`Edit template "${row.name}"`, "info");
        break;
      case "clone":
        Utilities.showToast(`Clone template "${row.name}"`, "info");
        break;
      case "delete":
        Utilities.confirm({
          title: "Delete template",
          text: `Are you sure you want to delete "${row.name}"?`,
          confirmButtonText: "Delete",
        }).then((confirmed) => {
          if (confirmed) {
            this.rowData = this.rowData.filter((r) => r !== row);
            Utilities.showToast("Template deleted", "success");
          }
        });
        break;
      default:
        break;
    }
  }
}
