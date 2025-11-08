import { Component, OnInit, OnDestroy, ViewChild, inject, ChangeDetectorRef } from "@angular/core";
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
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { AuthSessionService } from "../../../../core/services/auth/auth-session.service";
import Swal from "sweetalert2";

interface TemplateRow {
  id: string | number | null;
  name: string;
  code: string;
  format: string | null;
  messageType: string | null;
  lastEdited: string | null;
  lastEditedBy: string | null;
  active: boolean | null;
  // Optional detailed fields for local editing/preview (not provided by list SP)
  emailSubject?: string | null;
  emailBody?: string | null;
  smsBody?: string | null;
}

@Component({
  selector: "dw-templates-page",
  standalone: true,
  imports: [CommonModule, FormsModule, AgGridAngular, GridHeaderComponent],
  templateUrl: "./templates-page.component.html",
  styleUrls: ["./templates-page.component.scss"],
})
export class TemplatesPageComponent implements OnInit, OnDestroy {
  @ViewChild(AgGridAngular) grid?: AgGridAngular;
  @ViewChild('smsArea') smsArea?: any;
  @ViewChild('emailArea') emailArea?: any;
  private gridApi?: GridApi;
  private core = inject(DriveWhipCoreService);
  private authSession = inject(AuthSessionService);
  private sanitizer = inject(DomSanitizer);
  private cdr = inject(ChangeDetectorRef);

  loading = false;
  error: string | null = null;
  selectedCount = 0;
  rowCount = 0;
  currentPage = 0;
  totalPages = 0;
  pageSize = 25;
  pageSizeOptions: number[] = [10, 25, 50, 100];
  showCreateModal = false;
  // Legacy simple modal state (kept for fallback, but we now use the editor modal)
  newTemplate = {
    code: "",
    name: "",
    format: "",
    messageType: "Email",
    lastEditedBy: "",
  };

  // --- New Editor Modals State ---
  showEditorModal = false; // Add/Edit main modal
  editorMode: 'add' | 'edit' = 'add';
  showSmsEditor = false;
  showEmailEditor = false;
  showPreviewModal = false;
  previewTab: 'email' | 'sms' = 'email';

  // Basic picklists for the form
  templateTypes = [ { value: 'Follow Up', label: 'Follow Up' } ];
  private typesLoading = false;
  private typesError: string | null = null;

  templateForm = {
    id: null as string | number | null,
    name: '',
    type: 'Follow Up',
    emailSubject: '',
    emailBody: '',
    smsBody: '',
    isActive: true as boolean,
  };

  private readonly cardSnippetLength = 140;
  private readonly smsSegmentLength = 160;
  private readonly smsMaxLength = 1000;

  // --- DataKey dependent selects state ---
  dataKeyTypes: string[] = [];
  private dataKeysCache: Record<string, string[]> = {};
  // SMS modal selections
  smsDataKeyType: string = '';
  smsDataKey: string = '';
  smsDataKeyOptions: string[] = [];
  // Email modal selections
  emailDataKeyType: string = '';
  emailDataKey: string = '';
  emailDataKeyOptions: string[] = [];

  get emailCard() {
    const subjectRaw = (this.templateForm.emailSubject || '').trim();
    const bodyHtml = (this.templateForm.emailBody || '').toString();
    const bodyText = this.normalizeWhitespace(this.stripHtml(bodyHtml));
    const configured = !!(subjectRaw || bodyText);
    const previewSource = bodyText || subjectRaw || 'Click to compose the email message.';
    const preview = this.truncate(previewSource, this.cardSnippetLength);
    const subjectLabel = subjectRaw || 'Subject pending';
    const metaParts: string[] = [];
    if (subjectRaw) {
      metaParts.push(`${subjectRaw.length} subject chars`);
    }
    if (bodyText) {
      metaParts.push(`${bodyText.length} body chars`);
    }
    const meta = configured ? metaParts.join(' · ') : 'Add a subject or body to get started.';
    return {
      configured,
      subject: subjectLabel,
      preview,
      status: configured ? 'Ready' : 'Draft',
      badge: configured ? 'ready' : 'pending',
      meta,
    } as const;
  }

  get smsCard() {
    const bodyRaw = (this.templateForm.smsBody || '').trim();
    const bodyText = this.normalizeWhitespace(bodyRaw);
    const configured = bodyText.length > 0;
    const previewSource = bodyText || 'Click to compose the SMS message.';
    const preview = this.truncate(previewSource, this.cardSnippetLength);
    const length = bodyText.length;
    const segments = length > 0 ? Math.ceil(length / this.smsSegmentLength) : 0;
    const overLimit = length > this.smsMaxLength;
    let status = 'Draft';
    let badge = 'pending';
    if (configured) {
      if (overLimit) {
        status = 'Too long';
        badge = 'danger';
      } else {
        status = 'Ready';
        badge = segments > 1 ? 'warning' : 'ready';
      }
    }
    const metaParts: string[] = [];
    metaParts.push(`${length}/${this.smsMaxLength} chars`);
    if (length > 0) {
      metaParts.push(`${segments || 1} segment${segments === 1 ? '' : 's'}`);
    } else {
      metaParts.push('Add copy to send a text');
    }
    if (overLimit) {
      metaParts.push('Trim to stay within limit');
    } else if (segments > 1) {
      metaParts.push('Multiple SMS parts');
    }
    const meta = metaParts.join(' · ');
    return {
      configured,
      preview,
      status,
      badge,
      meta,
    } as const;
  }

  private stripHtml(value: string): string {
    return value.replace(/<[^>]+>/g, ' ');
  }

  private normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, Math.max(maxLength - 3, 0)).trimEnd()}...`;
  }

  // Build a sandboxed HTML document for preview within an iframe
  get emailPreviewDoc(): SafeHtml {
    const body = (this.templateForm.emailBody || '').toString().trim();
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      /* Neutral base styles inside the sandbox */
      html, body { height: 100%; }
      body { margin: 12px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'; font-size: 14px; line-height: 1.5; color: #111; background: #fff; }
      img { max-width: 100%; height: auto; }
      table { border-collapse: collapse; }
      a { color: #0d6efd; }
      pre, code { white-space: pre-wrap; }
      /* Prevent oversized elements from breaking layout */
      *, *::before, *::after { box-sizing: border-box; }
    </style>
  </head>
  <body>${body || '<div style="color:#6c757d">Not configured yet...</div>'}</body>
</html>`;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private readonly fallbackRows: TemplateRow[] = [
    {
      id: "TPL-001",
      code: "welcome_email",
      name: "Welcome Email",
      format: "Email",
      messageType: "EMAIL",
      lastEdited: "2025-02-10 09:32",
      lastEditedBy: "admin@drivewhip.com",
      active: true,
    },
    {
      id: "TPL-002",
      code: "sms_followup",
      name: "Follow-up SMS",
      format: "SMS",
      messageType: "SMS",
      lastEdited: "2025-02-08 18:15",
      lastEditedBy: "automation@drivewhip.com",
      active: true,
    },
    {
      id: "TPL-003",
      code: "reminder_email",
      name: "Reminder Email",
      format: "Email",
      messageType: "EMAIL",
      lastEdited: "2025-01-26 11:45",
      lastEditedBy: "support@drivewhip.com",
      active: true,
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
      headerName: "Active",
      field: "active",
      minWidth: 120,
      flex: 0.6,
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-check-circle" },
      cellRenderer: (p: any) => {
        const v = p.value;
        const isActive = v === true || v === 1 || String(v).toLowerCase() === 'true';
        const label = isActive ? 'Active' : 'Inactive';
        const cls = isActive ? 'badge bg-success-subtle text-success' : 'badge bg-danger-subtle text-danger';
        return `<span class="${cls}">${label}</span>`;
      },
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
      width: 160,
      sortable: false,
      filter: false,
      resizable: false,
      suppressSizeToFit: true,
      cellClass: 'overflow-visible', // allow dropdown to overflow the cell
      headerComponent: GridHeaderComponent,
      headerComponentParams: { icon: "icon-sliders" },
      cellRenderer: (p: any) => {
        const v = p?.data?.active;
        const isActive = v === true || v === 1 || String(v).toLowerCase?.() === 'true';
        const toggleLabel = isActive ? 'Disable' : 'Activate';
        const toggleAction = isActive ? 'delete' : 'activate';
        return `
          <div class="template-actions-inline dropdown position-relative">
            <button type="button" class="btn btn-sm btn-outline-secondary dropdown-toggle" data-toggle="actions-menu">
              Actions
            </button>
            <div class="dropdown-menu">
              <button type="button" class="dropdown-item" data-action="edit">Edit</button>
              <button type="button" class="dropdown-item" data-action="clone">Clone</button>
              <button type="button" class="dropdown-item text-danger" data-action="delete">Disable</button>
              <!-- <button type="button" class="dropdown-item ${isActive ? 'text-danger' : 'text-success'}" data-action="${toggleAction}">${toggleLabel}</button> -->
            </div>
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
    enableCellTextSelection: true,
    paginationPageSize: this.pageSize,
    paginationPageSizeSelector: this.pageSizeOptions,
    animateRows: true,
    overlayNoRowsTemplate:
      '<div class="ag-overlay-loading-center">No templates found.</div>',
    overlayLoadingTemplate:
      '<div class="ag-overlay-loading-center"><span class="spinner-border spinner-border-sm" role="status"></span><span class="ms-2">Loading...</span></div>',
  };

  rowData: TemplateRow[] = [];
  private activeActionsMenu: {
    menu: HTMLElement;
    placeholder: HTMLElement;
    toggleBtn: HTMLElement;
    row: TemplateRow;
    menuClickHandler: (event: MouseEvent) => void;
    outsideClickHandler: (event: MouseEvent) => void;
    keydownHandler: (event: KeyboardEvent) => void;
    scrollHandler: () => void;
    resizeHandler: () => void;
  } | null = null;
  private editingRow: TemplateRow | null = null;

  ngOnInit(): void {
    // Load template types first (from SP), then load templates grid
    void this.loadTemplateTypes()
      .finally(() => {
        void this.loadTemplates();
      });
    // Load datakey types for editor selects
    void this.loadDataKeyTypes();
  }

  ngOnDestroy(): void {
    this.closeActiveActionsMenu();
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

  onCellKeyDown(event: any): void {
    const key = (event.event as KeyboardEvent)?.key?.toLowerCase?.() || "";
    const ctrl = (event.event as KeyboardEvent)?.ctrlKey || (event.event as KeyboardEvent)?.metaKey;
    if (ctrl && key === "c") {
      const api = event.api;
      const ranges = (api as any).getCellRanges?.() || [];
      if (ranges && ranges.length && (api as any).copySelectedRangeToClipboard) {
        try { (api as any).copySelectedRangeToClipboard({ includeHeaders: true }); return; } catch {}
      }
      const selectedRows = api.getSelectedRows?.() || [];
      if (selectedRows.length) {
        try { api.copySelectedRowsToClipboard({ includeHeaders: true }); return; } catch {}
      }
      const value = (event.value ?? "").toString();
      if (value) navigator.clipboard?.writeText(value).catch(() => {});
    }
  }

  async loadTemplates(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.gridApi?.showLoadingOverlay();

    // Use stored procedure notifcations_templates_list to retrieve templates
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.notifcations_templates_list,
      parameters: [],
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
        ? (Array.isArray(res.data[0]) ? res.data[0] : res.data)
        : [];

      this.error = null;
      this.rowData = data.map((row: any) => {
        // SP fields: id, TemplateName, Formatm, MessageType, LastEdited, LastEditedBy, Active
        const id = row.id ?? row.id_template ?? row.ID ?? null;
        const name = (row.TemplateName ?? row.description ?? row.name ?? `Template ${id ?? ''}`)?.toString().trim() || '';
        const format = (row.Formatm ?? row.Format ?? row.message_type ?? row.MessageType ?? null)?.toString().trim() || null;
        const messageType = (row.MessageType ?? row.event ?? null)?.toString().trim() || null;
        const lastEdited = row.LastEdited ?? row.update_at ?? row.created_at ?? null;
        const lastEditedBy = row.LastEditedBy ?? row.update_by ?? row.created_by ?? null;
        const activeRaw = row.Active ?? row.active ?? row.is_active ?? row.IS_ACTIVE ?? null;
        const active =
          activeRaw === null || activeRaw === undefined
            ? null
            : (activeRaw === true || activeRaw === 1 || String(activeRaw).toLowerCase() === 'true');
        return {
          id,
          name,
          code: '', // SP doesn't return code; not displayed in grid
          format,
          messageType,
          lastEdited: lastEdited ? String(lastEdited) : null,
          lastEditedBy: lastEditedBy ? String(lastEditedBy) : null,
          active,
        } as TemplateRow;
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

  private async loadTemplateTypes(): Promise<void> {
    this.typesLoading = true;
    this.typesError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.notifcations_templates_type_list,
      parameters: [],
    } as any;
    try {
      const res = await firstValueFrom(
        this.core.executeCommand<DriveWhipCommandResponse>(api)
      );
      if (!res || res.ok === false) {
        const message = (res as any)?.error?.toString() || 'Failed to load template types';
        this.typesError = message;
        Utilities.showToast(message, 'warning');
        return;
      }
      const data = Array.isArray(res.data)
        ? (Array.isArray(res.data[0]) ? res.data[0] : res.data)
        : [];
      const mapped = data
        .map((row: any) => {
          const code = (row.code ?? row.Code ?? row.value ?? row.Value ?? row.type_code ?? row.type ?? row.TYPE ?? '').toString().trim();
          const label = (row.label ?? row.Label ?? row.description ?? row.Description ?? row.Value ?? row.value ?? code).toString().trim();
          if (!code) return null;
          return { value: code, label } as { value: string; label: string };
        })
        .filter(Boolean) as { value: string; label: string }[];
      if (mapped.length) {
        this.templateTypes = mapped;
      }
    } catch (err) {
      console.error('[TemplatesPage] loadTemplateTypes error', err);
      this.typesError = 'Failed to load template types';
      Utilities.showToast(this.typesError, 'error');
    } finally {
      this.typesLoading = false;
      // Ensure current form value is still valid
      const first = this.templateTypes[0]?.value || 'Follow Up';
      if (!this.templateForm.type) {
        this.templateForm.type = first;
      }
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

    // Toggle dropdown menu
    const toggleBtn = target.closest('[data-toggle="actions-menu"]') as HTMLButtonElement | null;
    if (toggleBtn) {
      event.event?.preventDefault();
      event.event?.stopPropagation();
      const container = toggleBtn.closest('.template-actions-inline');
      const menu = container?.querySelector('.dropdown-menu') as HTMLElement | null;
      if (menu) {
        this.toggleActionsMenu(menu, toggleBtn, event.data as TemplateRow);
      }
      return;
    }

    // Handle action click
    const actionBtn = target.closest('button[data-action]') as HTMLButtonElement | null;
    if (actionBtn) {
      event.event?.preventDefault();
      event.event?.stopPropagation();
      const action = actionBtn.dataset.action ?? "";
      // Close the dropdown after action selection
      const menu = actionBtn.closest('.dropdown-menu') as HTMLElement | null;
      menu?.classList.remove('show');
      this.onActionClick(action, event.data as TemplateRow);
      return;
    }

    // Click somewhere else inside actions cell: close any open menus
    const gridEl = (this.grid as any)?.eGridDiv as HTMLElement | undefined;
    (gridEl || document).querySelectorAll('.dropdown-menu.show').forEach(el => el.classList.remove('show'));
  }

  openCreateTemplate(): void {
    this.editorMode = 'add';
    this.editingRow = null;
    this.templateForm = {
      id: null,
      name: '',
      type: this.templateTypes[0]?.value || 'Follow Up',
      emailSubject: '',
      emailBody: '',
      smsBody: '',
      isActive: true,
    };
    this.showEditorModal = true;
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
  }

  saveTemplate(): void {
    // Save backed by SP crm_notifications_templates_crud_v2
    const { name, emailSubject, emailBody, smsBody, type } = this.templateForm;
    if (!name.trim()) {
      Utilities.showToast('Template name is required', 'warning');
      return;
    }
    if (!emailBody.trim() && !smsBody.trim()) {
      Utilities.showToast('Provide at least Email or SMS content', 'warning');
      return;
    }

    const currentUser = this.authSession.user?.user || 'system';

    const callCrudV2 = async (
      action: 'C'|'U'|'D',
      params: {
        id: string | number | null;
        templateName: string;
        subject: string | null;
        emailBody: string | null;
        smsBody: string | null;
        typeCode: string | null;
        createdBy?: string | null;
        updatedBy?: string | null;
        isActive?: number | 0 | 1 | null;
        idTemplateTwilio?: string | number | null;
      }
    ) => {
      const api: IDriveWhipCoreAPI = {
        commandName: DriveWhipAdminCommand.crm_notifications_templates_crud_v2,
        parameters: [
          action,
          params.id ?? null,
          params.templateName ?? null,
          params.subject ?? null,
          params.emailBody ?? null,
          params.smsBody ?? null,
          params.typeCode ?? null,
          action === 'C' ? (params.createdBy ?? currentUser) : null,
          action !== 'C' ? (params.updatedBy ?? currentUser) : null,
          params.isActive ?? 1,
          params.idTemplateTwilio ?? null,
        ],
      } as any;
      const res = await firstValueFrom(this.core.executeCommand<DriveWhipCommandResponse>(api));
      if (!res || res.ok === false) {
        const message = (res as any)?.error?.toString() || 'Operation failed';
        throw new Error(message);
      }
      return res;
    };

    const run = async () => {
      if (this.editorMode === 'add') {
        await callCrudV2('C', {
          id: null,
          templateName: name.trim(),
          subject: (emailSubject || '').trim() || null,
          emailBody: emailBody.trim() || null,
          smsBody: smsBody.trim() || null,
          typeCode: type || null,
          createdBy: currentUser,
          isActive: this.templateForm.isActive ? 1 : 0,
          idTemplateTwilio: null,
        });
        Utilities.showToast('Template saved', 'success');
      } else {
        if (!emailBody.trim() && !smsBody.trim()) {
          Utilities.showToast('Provide at least Email or SMS content', 'warning');
          return;
        }
        if (emailBody.trim() && !(emailSubject || '').trim()) {
          Utilities.showToast('Email subject is required when providing email body', 'warning');
          return;
        }
        await callCrudV2('U', {
          id: this.templateForm.id,
          templateName: name.trim(),
          subject: (emailSubject || '').trim() || null,
          emailBody: emailBody.trim() || null,
          smsBody: smsBody.trim() || null,
          typeCode: type || null,
          updatedBy: currentUser,
          isActive: this.templateForm.isActive ? 1 : 0,
          idTemplateTwilio: null,
        });
        Utilities.showToast('Template updated', 'success');
      }
      this.showEditorModal = false;
      await this.loadTemplates();
    };

    run().catch(err => {
      const message = (err && err.message) ? err.message : 'Failed to save template';
      Utilities.showToast(message, 'error');
    });
  }

  onActionClick(action: string, row: TemplateRow): void {
    switch (action) {
      case "edit":
        this.openEditTemplate(row);
        break;
      case "activate": {
        void (async () => {
          const currentUser = this.authSession.user?.user || 'system';
          console.log(currentUser)
          // Fetch existing combined bodies for activation
          const { emailBody, smsBody, subject } = await this.fetchTemplateBody(row.id);
          const api: IDriveWhipCoreAPI = {
            commandName: DriveWhipAdminCommand.crm_notifications_templates_crud_v2,
            parameters: [
              'U',                    // action update
              row.id ?? null,         // template id
              row.name ?? null,       // template name
              (subject ?? ''),        // subject
              emailBody ?? null,      // body email
              smsBody ?? null,        // body sms
              null,                   // type code (not available in grid row)
              null,                   // created_by (null on update)
              currentUser,            // updated_by
              1,                      // is_active (activate)
              null                    // twilio id
            ]
          } as any;
          try {
            const res = await firstValueFrom(this.core.executeCommand<DriveWhipCommandResponse>(api));
            if (!res || (res as any).ok === false) {
              const message = (res as any)?.error?.toString() || 'Failed to activate template';
              throw new Error(message);
            }
            Utilities.showToast('Template activated', 'success');
            await this.loadTemplates();
          } catch (err: any) {
            const message = (err && err.message) ? err.message : 'Failed to activate template';
            Utilities.showToast(message, 'error');
          }
        })();
        break;
      }
      case "clone":
        void Swal.fire({
          title: 'Clone template',
          input: 'text',
          inputLabel: 'New template name',
          inputValue: `${row.name}`,
          inputAttributes: { maxlength: '100', style: 'color: var(--bs-body-color)' },
          showCancelButton: true,
          confirmButtonText: 'Clone',
          allowOutsideClick: false,
          preConfirm: async (value) => {
            const newName = (value || '').trim();
            if (!newName) {
              Swal.showValidationMessage('Name is required');
              return false;
            }
            const currentUser = this.authSession.user?.user || 'system';
            const api: IDriveWhipCoreAPI = {
              commandName: DriveWhipAdminCommand.notifcations_template_clone,
              parameters: [
                row.id ?? null, // p_id_template
                newName,        // p_description (name)
                currentUser     // p_user
              ],
            } as any;
            try {
              const res = await firstValueFrom(this.core.executeCommand<DriveWhipCommandResponse>(api));
              if (!res || res.ok === false) {
                const message = (res as any)?.error?.toString() || 'Clone failed';
                throw new Error(message);
              }
              return true;
            } catch (err: any) {
              Swal.showValidationMessage((err?.message || 'Clone failed').toString());
              return false;
            }
          }
        }).then(result => {
          if (result.isConfirmed) {
            Utilities.showToast('Template cloned', 'success');
            void this.loadTemplates();
          }
        });
        break;
      case "delete":
        Utilities.confirm({
          title: "Delete template",
          text: `Are you sure you want to delete "${row.name}"?`,
          confirmButtonText: "Delete",
          allowOutsideClick: false,
        }).then((confirmed) => {
          if (!confirmed) return;
          const currentUser = this.authSession.user?.user || 'system';
          const api: IDriveWhipCoreAPI = {
            commandName: DriveWhipAdminCommand.crm_notifications_templates_crud_v2,
            parameters: [
              'D',                  // action delete (logical inactivation)
              row.id ?? null,       // template id
              null,                 // name (not needed for delete)
              null,                 // subject
              null,                 // body email
              null,                 // body sms
              row.format ?? null,   // type code (if available)
              null,                 // created_by
              currentUser,          // updated_by
              0,                    // is_active -> set inactive
              null                  // twilio id
            ]
          } as any;
          firstValueFrom(this.core.executeCommand<DriveWhipCommandResponse>(api))
            .then(res => {
              if (!res || res.ok === false) {
                const message = (res as any)?.error?.toString() || 'Failed to delete template';
                throw new Error(message);
              }
              Utilities.showToast("Template deleted", "success");
              return this.loadTemplates();
            })
            .catch(err => {
              const message = (err && err.message) ? err.message : 'Failed to delete template';
              Utilities.showToast(message, 'error');
            });
        });
        break;
      default:
        break;
    }
  }

  private openEditTemplate(row: TemplateRow): void {
    this.editorMode = 'edit';
    this.editingRow = row;
    this.templateForm = {
      id: row.id ?? null,
      name: row.name || '',
      type: this.templateTypes[0]?.value || 'Follow Up',
      emailSubject: row.emailSubject || '',
      emailBody: row.emailBody || '',
      smsBody: row.smsBody || '',
      isActive: row.active === true,
    };
    this.showEditorModal = true;
    // After opening the modal, fetch the latest subject/body for this template id
    // using the SP crm_notifications_template_body. For Email we set subject+body; for SMS only body.
    void this.loadTemplateBodyForRow(row);
  }

  /**
   * Load both email & sms bodies plus subject for the given template row by executing the SP:
   *   crm_notifications_template_body(p_template_id)
   * New SP returns: BodyEmail, BodySMS, Subject
   * We now populate emailSubject/emailBody and smsBody regardless of template format so user can view both.
   */
  private async loadTemplateBodyForRow(row: TemplateRow): Promise<void> {
    const templateId = row?.id;
    if (templateId == null) return;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_notifications_template_body,
      parameters: [templateId],
    } as any;
    try {
      const res = await firstValueFrom(this.core.executeCommand<DriveWhipCommandResponse>(api));
      const data = Array.isArray(res?.data)
        ? (Array.isArray(res.data[0]) ? res.data[0] : res.data)
        : [];
      const first = (data && data[0]) ? data[0] : {};
      const emailBody = (first.BodyEmail ?? first.bodyEmail ?? first.body_email ?? '')?.toString?.() ?? '';
      const smsBody = (first.BodySMS ?? first.bodySMS ?? first.body_sms ?? '')?.toString?.() ?? '';
      const subject = (first.Subject ?? first.subject ?? first.template_subject ?? '')?.toString?.() ?? '';

      // Populate both channels so editor modal can show/edit both regardless of original format
      this.templateForm.emailSubject = subject || '';
      this.templateForm.emailBody = emailBody || '';
      this.templateForm.smsBody = smsBody || '';
      row.emailSubject = this.templateForm.emailSubject;
      row.emailBody = this.templateForm.emailBody;
      row.smsBody = this.templateForm.smsBody;
      // Ensure change detection picks up async updates even if the service runs outside NgZone
      try { this.cdr.detectChanges(); } catch {}
    } catch (err) {
      console.error('[TemplatesPage] loadTemplateBodyForRow error', err);
      // Non-blocking: keep modal open even if details fail to load
    }
  }

  // Fetch subject/body without mutating UI state; used for background updates like Activate
  private async fetchTemplateBody(templateId: string | number | null): Promise<{ emailBody: string; smsBody: string; subject: string; }> {
    if (templateId == null) return { emailBody: '', smsBody: '', subject: '' };
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_notifications_template_body,
      parameters: [templateId],
    } as any;
    try {
      const res = await firstValueFrom(this.core.executeCommand<DriveWhipCommandResponse>(api));
      const data = Array.isArray(res?.data)
        ? (Array.isArray(res.data[0]) ? res.data[0] : res.data)
        : [];
      const first = (data && data[0]) ? data[0] : {};
      const emailBody = (first.BodyEmail ?? first.bodyEmail ?? first.body_email ?? '')?.toString?.() ?? '';
      const smsBody = (first.BodySMS ?? first.bodySMS ?? first.body_sms ?? '')?.toString?.() ?? '';
      const subject = (first.Subject ?? first.subject ?? first.template_subject ?? '')?.toString?.() ?? '';
      return { emailBody, smsBody, subject };
    } catch {
      return { emailBody: '', smsBody: '', subject: '' };
    }
  }

  // --- Sub-editors ---
  openSmsEditor(): void {
    this.showSmsEditor = true;
  }
  openEmailEditor(): void {
    this.showEmailEditor = true;
  }
  saveSmsEditor(): void {
    // Just close; data already two-way bound via template binding
    this.showSmsEditor = false;
  }
  saveEmailEditor(): void {
    this.showEmailEditor = false;
  }
  openPreview(tab: 'email' | 'sms'): void {
    this.previewTab = tab;
    this.showPreviewModal = true;
  }
  closePreview(): void {
    this.showPreviewModal = false;
  }

  deleteCurrentTemplate(): void {
    const id = this.templateForm.id;
    if (id == null) { this.showEditorModal = false; return; }
    const row = this.rowData.find(r => r.id === id);
    if (!row) { this.showEditorModal = false; return; }
    this.onActionClick('delete', row);
    this.showEditorModal = false;
  }

  // --- DataKey selects: load & interactions ---
  private async loadDataKeyTypes(): Promise<void> {
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.notifcations_datakey_type_list,
      parameters: [],
    } as any;
    try {
      const res = await firstValueFrom(this.core.executeCommand<DriveWhipCommandResponse>(api));
      const data = Array.isArray(res?.data)
        ? (Array.isArray(res.data[0]) ? res.data[0] : res.data)
        : [];
      const types = (data || []).map((row: any) =>
        (row.value ?? row.id ?? row.TYPE ?? row.type ?? '').toString().trim()
      ).filter((v: string) => !!v);
      this.dataKeyTypes = Array.from(new Set(types));
      // Default the selects to first option if empty
      if (!this.smsDataKeyType && this.dataKeyTypes.length) this.smsDataKeyType = this.dataKeyTypes[0];
      if (!this.emailDataKeyType && this.dataKeyTypes.length) this.emailDataKeyType = this.dataKeyTypes[0];
      // Preload options for defaults
      if (this.smsDataKeyType) { void this.onSmsDataKeyTypeChange(); }
      if (this.emailDataKeyType) { void this.onEmailDataKeyTypeChange(); }
    } catch (err) {
      console.error('[TemplatesPage] loadDataKeyTypes error', err);
      // Keep empty gracefully
    }
  }

  private async getDataKeysForType(type: string): Promise<string[]> {
    const key = (type || '').toUpperCase();
    if (!key) return [];
    if (this.dataKeysCache[key]) {
      return this.dataKeysCache[key];
    }
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.notifcations_datakey_list,
      parameters: [key],
    } as any;
    try {
      const res = await firstValueFrom(this.core.executeCommand<DriveWhipCommandResponse>(api));
      const rows = Array.isArray(res?.data)
        ? (Array.isArray(res.data[0]) ? res.data[0] : res.data)
        : [];
      const list = (rows || []).map((row: any) =>
        (row.data_key ?? row.value ?? row.id ?? '').toString().trim()
      ).filter((v: string) => !!v);
      this.dataKeysCache[key] = list;
      return list;
    } catch (err) {
      console.error('[TemplatesPage] getDataKeysForType error', err);
      return [];
    }
  }

  async onSmsDataKeyTypeChange(): Promise<void> {
    this.smsDataKey = '';
    this.smsDataKeyOptions = await this.getDataKeysForType(this.smsDataKeyType);
  }

  async onEmailDataKeyTypeChange(): Promise<void> {
    this.emailDataKey = '';
    this.emailDataKeyOptions = await this.getDataKeysForType(this.emailDataKeyType);
  }

  onInsertDataKey(channel: 'sms' | 'email', token: string): void {
    if (!token) return;
    const area: HTMLTextAreaElement | null = channel === 'sms'
      ? (this.smsArea?.nativeElement as HTMLTextAreaElement | undefined) ?? null
      : (this.emailArea?.nativeElement as HTMLTextAreaElement | undefined) ?? null;
    if (!area) {
      // Fallback: append to end
      if (channel === 'sms') {
        this.templateForm.smsBody = (this.templateForm.smsBody || '') + token;
      } else {
        this.templateForm.emailBody = (this.templateForm.emailBody || '') + token;
      }
      return;
    }
    const value = channel === 'sms' ? (this.templateForm.smsBody || '') : (this.templateForm.emailBody || '');
    const start = area.selectionStart ?? value.length;
    const end = area.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = before + token + after;
    if (channel === 'sms') {
      this.templateForm.smsBody = next;
    } else {
      this.templateForm.emailBody = next;
    }
    // Restore focus and place caret after inserted token
    setTimeout(() => {
      area.focus();
      const pos = start + token.length;
      area.setSelectionRange(pos, pos);
    }, 0);

    // Clear the selected token to allow reusing the same dropdown
    if (channel === 'sms') this.smsDataKey = '';
    else this.emailDataKey = '';
  }

  private toggleActionsMenu(menu: HTMLElement, toggleBtn: HTMLElement, row: TemplateRow): void {
    if (this.activeActionsMenu?.menu === menu) {
      this.closeActiveActionsMenu();
      return;
    }
    this.closeActiveActionsMenu();
    this.openActionsMenu(menu, toggleBtn, row);
  }

  private openActionsMenu(menu: HTMLElement, toggleBtn: HTMLElement, row: TemplateRow): void {
    const placeholder = document.createElement('span');
    placeholder.className = 'actions-menu-placeholder';
    placeholder.style.display = 'none';
    const parent = menu.parentElement;
    parent?.insertBefore(placeholder, menu);
    document.body.appendChild(menu);

    menu.classList.add('show');
  menu.classList.add('template-actions-menu');
    menu.style.position = 'fixed';
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    menu.style.zIndex = '5000';
    this.positionActionsMenu(menu, toggleBtn);
    menu.style.visibility = 'visible';

    const menuClickHandler = (event: MouseEvent) => {
      const actionBtn = (event.target as HTMLElement | null)?.closest('button[data-action]') as HTMLButtonElement | null;
      if (!actionBtn) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const action = actionBtn.dataset.action ?? '';
      this.closeActiveActionsMenu();
      this.onActionClick(action, row);
    };
    const outsideClickHandler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menu.contains(target) || toggleBtn.contains(target)) return;
      this.closeActiveActionsMenu();
    };
    const keydownHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.closeActiveActionsMenu();
      }
    };
    const scrollHandler = () => {
      this.positionActionsMenu(menu, toggleBtn);
    };
    const resizeHandler = () => {
      this.positionActionsMenu(menu, toggleBtn);
    };

    menu.addEventListener('click', menuClickHandler);
    document.addEventListener('click', outsideClickHandler, true);
    document.addEventListener('keydown', keydownHandler, true);
    window.addEventListener('scroll', scrollHandler, true);
    window.addEventListener('resize', resizeHandler);

    this.activeActionsMenu = {
      menu,
      placeholder,
      toggleBtn,
      row,
      menuClickHandler,
      outsideClickHandler,
      keydownHandler,
      scrollHandler,
      resizeHandler,
    };
  }

  private positionActionsMenu(menu: HTMLElement, toggleBtn: HTMLElement): void {
    if (!document.body.contains(toggleBtn)) {
      this.closeActiveActionsMenu();
      return;
    }
    const rect = toggleBtn.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.closeActiveActionsMenu();
      return;
    }
    const menuWidth = menu.offsetWidth || 160;
    const menuHeight = menu.offsetHeight || 120;
    const margin = 6;
    let left = rect.right - menuWidth;
    const maxLeft = window.innerWidth - menuWidth - margin;
    if (left > maxLeft) left = maxLeft;
    if (left < margin) left = margin;
    let top = rect.bottom + margin;
    const maxTop = window.innerHeight - menuHeight - margin;
    if (top > maxTop) top = Math.max(margin, rect.top - menuHeight - margin);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  private closeActiveActionsMenu(): void {
    const info = this.activeActionsMenu;
    if (!info) return;
    const { menu, placeholder, menuClickHandler, outsideClickHandler, keydownHandler, scrollHandler, resizeHandler } = info;
    menu.classList.remove('show');
    menu.style.position = '';
    menu.style.display = '';
    menu.style.visibility = '';
    menu.style.zIndex = '';
  menu.style.left = '';
  menu.style.top = '';
    menu.removeEventListener('click', menuClickHandler);
    document.removeEventListener('click', outsideClickHandler, true);
    document.removeEventListener('keydown', keydownHandler, true);
    window.removeEventListener('scroll', scrollHandler, true);
    window.removeEventListener('resize', resizeHandler);
    if (placeholder.parentElement) {
      placeholder.parentElement.insertBefore(menu, placeholder);
    }
    placeholder.remove();
    this.activeActionsMenu = null;
  }
}
