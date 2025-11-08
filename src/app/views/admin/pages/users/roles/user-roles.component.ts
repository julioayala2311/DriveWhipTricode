import { Utilities } from "./../../../../../Utilities/Utilities";
import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { AgGridAngular } from "ag-grid-angular";
import {
  ColDef,
  GridApi,
  GridReadyEvent,
  CellClickedEvent,
} from "ag-grid-community";
import { DriveWhipCoreService } from "../../../../../core/services/drivewhip-core/drivewhip-core.service";
import { DriveWhipAdminCommand } from "../../../../../core/db/procedures";
import {
  IDriveWhipCoreAPI,
  DriveWhipCommandResponse,
} from "../../../../../core/models/entities.model";
import { RoleRecord } from "../../../../../core/models/role.model";
import { RoleDialogComponent, RoleDialogResult } from "./index";
import { Observable, tap, catchError, finalize, map, of } from "rxjs";
import { RoleRouteRecord } from "../../../../../core/models/role.routes.model";
import { AuthSessionService } from "../../../../../core/services/auth/auth-session.service";

// User Roles management grid (ag-Grid integration)

@Component({
  selector: "dw-user-roles",
  standalone: true,
  imports: [CommonModule, AgGridAngular, RoleDialogComponent],
  templateUrl: "./user-roles.component.html",
  styleUrls: ["./user-roles.component.scss"],
})
export class UserRolesComponent implements OnInit, OnDestroy {
  // Signals (Angular 16+) for reactive state
  private authSession = inject(AuthSessionService);
  private readonly _loading = signal(false);
  private readonly _roles = signal<RoleRecord[]>([]);
  private readonly _rolesroutes = signal<RoleRouteRecord[]>([]);
  private readonly _error = signal<string | null>(null);
  private readonly _dialogOpen = signal(false);
  private readonly _dialogMode = signal<"create" | "edit">("create");
  private readonly _editingRecord = signal<RoleRecord | null>(null);
  private readonly _saving = signal(false);
  private readonly _compactActions = signal(false); // viewport-based
  private pendingActionColWidth: number | null = null;
  selectedRole = signal<RoleRecord | null>(null);
  // --- Detail (permissions) ---
  //routes  = signal<any[]>([]);           // filas del grid de permisos
  permError = signal<string | null>(null); // mensaje de error (si ocurre)

  private readonly ADMIN_ROLES = new Set(["ADMIN"]);

  // Exposed (if needed later)
  readonly compactActions = computed(() => this._compactActions());

  // Exposed computed signals
  readonly loading = computed(() => this._loading());
  readonly roles = computed(() => this._roles());
  readonly rolesroutes = computed(() => this._rolesroutes());
  readonly error = computed(() => this._error());
  readonly showDialog = computed(() => this._dialogOpen());
  readonly dialogMode = computed(() => this._dialogMode());
  readonly editingRecord = computed(() => this._editingRecord());
  readonly saving = computed(() => this._saving());
  readonly roleNames = computed(() =>
    this._roles().map((r) => r.role.toLowerCase())
  );

  // ag-Grid column definitions
  columnDefs: ColDef[] = [
    {
      headerName: "Role",
      field: "role",
      minWidth: 160,
      flex: 1,
      sortable: true,
      filter: true,
    },
    {
      headerName: "Description",
      field: "description",
      minWidth: 240,
      flex: 1.4,
      sortable: true,
      filter: true,
    },
    {
      headerName: "Created At",
      field: "createdat",
      minWidth: 160,
      flex: 0.9,
      valueFormatter: (p) => this.formatDate(p.value),
      sortable: true,
    },
    {
      headerName: "Active",
      field: "isactive",
      minWidth: 120,
      flex: 0.6,
      sortable: true,
      filter: true,
      cellRenderer: (p: any) => this.renderActiveBadge(p.value),
    },
    {
      headerName: "Actions",
      field: "actions",
      minWidth: 140,
      maxWidth: 180,
      pinned: "right",
      sortable: false,
      filter: false,
      cellRenderer: (p: any) => this.actionButtons(p.data),
      cellClass: "dw-actions-cell",
    },
  ];

  // ag-Grid column definitions (detalle: rutas por rol)
  permColumnDefs: ColDef[] = [
    {
      headerName: "Menu Item",
      field: "label",
      minWidth: 260,
      flex: 1.6,
      sortable: true,
      filter: true,
      cellRenderer: (p: any) => {
        const parent = (p?.data?.parentLabel || "").toString();
        const isRoot = !parent || parent === "ROOT";
        const routeLabel = (p?.data?.label || "").toString();
        const top = isRoot ? routeLabel : parent;
        const sub = isRoot ? "" : routeLabel;
        // Reuse the same visual pattern as Locations Address column: two-line, bootstrap utility classes
        // First line: bold (fw-semibold) and normal text color; second line: secondary & small
        return `
          <div class="d-flex flex-column lh-sm py-1">
            <div class="fw-semibold text-body">${this.escapeHtml(top)}</div>
            ${
              sub
                ? `<div class="text-secondary small">${this.escapeHtml(
                    sub
                  )}</div>`
                : ""
            }
          </div>
        `;
      },
    },
    {
      headerName: "Permissions",
      field: "permissions",
      minWidth: 220,
      flex: 1.1,
      sortable: false,
      filter: false,
      suppressHeaderMenuButton: true,
      cellRenderer: (p: any) => {
        const data = p?.data || {};
        const roleId = this.selectedRole()?.Id ?? null;
        const assigned = Number(data.is_assigned) === 1;
        const perms = {
          Create: Number(data.Create) === 1 ? 1 : 0,
          Read: Number(data.Read) === 1 ? 1 : 0,
          Update: Number(data.Update) === 1 ? 1 : 0,
          Delete: Number(data.Delete) === 1 ? 1 : 0,
        };
        const container = document.createElement('div');
        container.className = 'permission-buttons perm-btn-group';

        const spec: Array<{icon:string; field: 'Create'|'Read'|'Update'|'Delete'; label: string; aria: string}> = [
          { icon: 'icon-plus', field: 'Create', label: 'Add', aria: 'Toggle Add permission' },
          { icon: 'icon-eye', field: 'Read', label: 'View', aria: 'Toggle View permission' },
          { icon: 'icon-edit', field: 'Update', label: 'Edit', aria: 'Toggle Edit permission' },
          { icon: 'icon-trash', field: 'Delete', label: 'Remove', aria: 'Toggle Remove permission' },
        ];

        const makeBtn = (item: typeof spec[number]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          const initPressed = perms[item.field] === 1;
          btn.setAttribute('aria-pressed', initPressed ? 'true' : 'false');
          btn.setAttribute('aria-label', item.aria);
          btn.title = `${item.label}: ${initPressed ? 'On' : 'Off'}`;
          const palette: Record<'Create' | 'Read' | 'Update' | 'Delete', string> = {
            Create: 'perm-success',
            Read: 'perm-info',
            Update: 'perm-warning',
            Delete: 'perm-danger',
          };
          const variant = palette[item.field];
          btn.className = 'perm-btn';
          const applyState = (on: boolean) => {
            btn.classList.toggle('perm-on', on);
            btn.classList.toggle('perm-off', !on);
            btn.classList.toggle(variant, on);
          };
          applyState(initPressed);
          if (!assigned) {
            btn.classList.add('perm-disabled');
          }

          const icon = document.createElement('i');
          icon.className = `perm-icon ${
            initPressed ? 'perm-icon-active' : 'perm-icon-inactive'
          } feather ${item.icon}`;
          icon.setAttribute('aria-hidden', 'true');
          btn.appendChild(icon);

          const srLabel = document.createElement('span');
          srLabel.className = 'visually-hidden';
          srLabel.textContent = item.label;
          btn.appendChild(srLabel);

          if (!assigned) {
            btn.disabled = true;
            btn.title = `${item.label} (assign route first)`;
          }
          btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            if (!assigned) return;
            const prev = { ...perms };
            const currentPressed = perms[item.field] === 1;
            const next = { ...perms, [item.field]: currentPressed ? 0 : 1 } as any;
            // optimistic visual toggle
            perms[item.field] = next[item.field];
            btn.setAttribute('aria-pressed', perms[item.field] === 1 ? 'true' : 'false');
            btn.title = `${item.label}: ${perms[item.field] === 1 ? 'On' : 'Off'}`;
            applyState(perms[item.field] === 1);
            icon.classList.toggle('perm-icon-active', perms[item.field] === 1);
            icon.classList.toggle('perm-icon-inactive', perms[item.field] !== 1);
            try {
              await this.updateRoutePermissions(data.id_route, roleId, next, prev, p);
            } catch (e) {
              // rollback
              perms[item.field] = prev[item.field];
              btn.setAttribute('aria-pressed', perms[item.field] === 1 ? 'true' : 'false');
              btn.title = `${item.label}: ${perms[item.field] === 1 ? 'On' : 'Off'}`;
              applyState(perms[item.field] === 1);
              icon.classList.toggle('perm-icon-active', perms[item.field] === 1);
              icon.classList.toggle('perm-icon-inactive', perms[item.field] !== 1);
            }
          });
          return btn;
        };

        spec.forEach(s => container.appendChild(makeBtn(s)));
        return container;
      }
    },
    {
      headerName: "Icon",
      hide: true,
      field: "icon",
      minWidth: 160,
      flex: 1,
      sortable: true,
      filter: true,
    },
    {
      headerName: "Order",
      hide: true,
      field: "sort_order",
      minWidth: 160,
      flex: 1,
      sortable: true,
      filter: true,
    },
    {
      headerName: "Active",
      hide: true,
      field: "is_active",
      minWidth: 120,
      flex: 0.6,
      sortable: true,
      filter: true,
      cellRenderer: (p: any) => this.renderActiveBadge(p.value),
    },

    // ← Switch para activar/desactivar la ruta para el rol
    // {
    //     headerName: 'Assigned',
    //     field: 'is_assigned',                    // keep backend field name
    //     minWidth: 120,
    //     flex: .55,
    //     headerClass: 'ag-center-header',
    //     cellClass: 'text-center',
    //     sortable: true,
    //     filter: 'agSetColumnFilter',
    //     // Default to UNASSIGNED (0) if null/undefined/anything ≠ 1
    //     valueGetter: (p) => Number(p.data?.is_active) === 1 ? 1 : 0,
    //     filterParams: {
    //       values: [1, 0],
    //       valueFormatter: (p: any) => (Number(p.value) === 1 ? 'Assigned' : 'Unassigned')
    //     },
    //     cellRenderer: (p: any) => {
    //       const on = Number(p.value) === 1;
    //       return `
    //         <div class="form-check form-switch d-inline-flex align-items-center justify-content-center">
    //           <input type="checkbox" class="form-check-input perm-toggle"
    //                 ${on ? 'checked' : ''} data-route="${p?.data?.id_route}">
    //         </div>
    //       `;
    //     }
    //   },

    {
      headerName: "Assigned",
      field: "is_assigned",
      minWidth: 120,
      flex: 0.55,
      headerClass: "ag-center-header",
      cellClass: "text-center",
      sortable: true,
      filter: "agSetColumnFilter",

      // Normaliza a 1/0 evitando null/undefined
      valueGetter: (p) => (Number(p.data?.is_assigned) === 1 ? 1 : 0),

      filterParams: {
        values: [1, 0],
        valueFormatter: (p: any) =>
          Number(p.value) === 1 ? "Assigned" : "Unassigned",
      },

      cellRenderer: (p: any) => {
        const on = Number(p.value) === 1;
        const eDiv = document.createElement("div");
        eDiv.className =
          "form-check form-switch d-inline-flex align-items-center justify-content-center";
        eDiv.innerHTML = `
          <input type="checkbox" class="form-check-input perm-toggle" ${
            on ? "checked" : ""
          }>
        `;

        const input = eDiv.querySelector("input") as HTMLInputElement;

        // evita que el click seleccione la fila
        eDiv.addEventListener("click", (ev) => ev.stopPropagation());

        input.addEventListener("change", async () => {
          // datos que necesitas enviar
          const id_route = p?.data?.id_route; // ajusta si tu PK se llama distinto
          const role = p?.data?.role; // ajusta si tu campo es role_code u otro
          const label = p?.data?.label; // ajusta si tu campo es role_code u otro
          const assigned = input.checked ? 1 : 0;
          const roleId = this.selectedRole()?.Id ?? null;

          // actualización optimista
          const prev = Number(p.value) === 1 ? 1 : 0;
          p.node.setDataValue("is_assigned", assigned);

          // deshabilita mientras llama
          input.disabled = true;

          try {
            // Llama al método del componente (definido abajo)
            this.onToggleAssigned({ id_route, role, roleId, label, assigned });
          } catch (e) {
            // rollback si falla
            p.node.setDataValue("is_assigned", prev);
            // re-chequea visualmente acorde al rollback
            input.checked = prev === 1;
            console.error(e);
          } finally {
            input.disabled = false;
          }
        });

        return eDiv;
      },
    },
    // IDs/fields técnicos ocultos (útiles para acciones)
    { headerName: "Route ID", field: "id_route", hide: true },
    { headerName: "Parent ID", field: "parent_id", hide: true },
    { headerName: "Path", field: "path", hide: true }, // ya lo mostramos bajo label
  ];

  // Align default column behavior with applicants grid (sortable/filterable/floating filters, responsive headers)
  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    floatingFilter: true,
    resizable: true,
    wrapHeaderText: true,
    autoHeaderHeight: true,
    suppressHeaderMenuButton: true,
  };

  pageSize = 25;
  pageSizeOptions = [10, 25, 50, 100];
  private gridApi?: GridApi;

  constructor(private core: DriveWhipCoreService) {}

  // componente.ts
  private async onToggleAssigned(payload: {
    id_route: number;
    role: string;
    roleId?: number | null;
    label: string;
    assigned: 0 | 1;
  }) {
    const isAssign = payload.assigned === 1;

    const ok = await Utilities.confirm({
      title: isAssign ? "Assign route" : "Unassign route",
      text: isAssign
        ? `The role "${payload.role}" will be assigned to route "${payload.label}". Continue?`
        : `The role "${payload.role}" will be unassigned from route "${payload.label}". Continue?`,
      confirmButtonText: isAssign ? "Assign" : "Unassign",
      allowOutsideClick: false,
    });

    if (!ok) {
      this.loadRolesRoutes(payload.roleId ?? null);
      return; // usuario canceló
    }

    if (isAssign) {
      await this.assignRoleRoute(
        payload.id_route,
        payload.roleId ?? null
      );
      Utilities.showToast("Assigned", "success");
    } else {
      await this.unassignRoleRoute(
        payload.id_route,
        payload.roleId ?? null
      );
      Utilities.showToast("Unassigned", "warning");
    }
  }

  assignRoleRoute(id_route: number, roleId: number | null): void {
    this._loading.set(true);
    this._error.set(null);
    const currentUser = this.authSession.user?.user || "system";
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.auth_roles_routes_crud_v2,
      // v2 signature: (action, id_role, id_route, can_create, can_read, can_update, can_delete, username)
      // Backend on 'C' ignores provided CRUD flags and inserts 1/1/1/1 itself; we still pass 0s for clarity.
      parameters: [
        'C',
        roleId?.toString() ?? null,
        id_route,
        1, // can_create
        1, // can_read
        1, // can_update
        1, // can_delete
        currentUser
      ],
    };
    this.core
      .executeCommand<DriveWhipCommandResponse<RoleRecord>>(api)
      .subscribe({
        next: (res) => {
          if (!res.ok) {
            const msg: string = (res.error as any)
              ? String(res.error)
              : "Failed to load roles";
            this._error.set(msg);
            Utilities.showToast(msg, "error");
            this._loading.set(false);
            return;
          }

          this.loadRolesRoutes(roleId ?? null);
        },
        error: (err) => {
          console.error("[UserRolesComponent] loadRoles error", err);
          const msg = "Failed to load roles";
          this._error.set(msg);
          Utilities.showToast(msg, "error");
        },
        complete: () => this._loading.set(false),
      });
  }

  // Remove role-route assignment (action 'D')
  unassignRoleRoute(id_route: number, roleId: number | null): void {
    this._loading.set(true);
    this._error.set(null);
    const currentUser = this.authSession.user?.user || 'system';
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.auth_roles_routes_crud_v2,
      parameters: [
        'D',
        roleId?.toString() ?? null,
        id_route,
        0, // can_create (ignored on D)
        0, // can_read (ignored on D)
        0, // can_update (ignored on D)
        0, // can_delete (ignored on D)
        currentUser
      ]
    };
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res.ok) {
          const msg: string = (res.error as any)
            ? String(res.error)
            : 'Failed to unassign route';
          this._error.set(msg);
          Utilities.showToast(msg, 'error');
          this._loading.set(false);
          return;
        }
        this.loadRolesRoutes(roleId ?? null);
      },
      error: (err) => {
        console.error('[UserRolesComponent] unassign route error', err);
        const msg = 'Failed to unassign route';
        this._error.set(msg);
        Utilities.showToast(msg, 'error');
      },
      complete: () => this._loading.set(false)
    });
  }

  // Update CRUD permissions for a role-route
  private async updateRoutePermissions(
    id_route: number,
    roleId: number | null,
    next: { Create: number; Read: number; Update: number; Delete: number },
    prev: { Create: number; Read: number; Update: number; Delete: number },
    p?: any
  ): Promise<void> {
    if (roleId == null) return Promise.reject('Missing role id');
    const currentUser = this.authSession.user?.user || 'system';
    // Use action 'U' for updating existing permissions
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.auth_roles_routes_crud_v2,
      parameters: [
        'U',
        roleId?.toString() ?? null,
        id_route,
        Number(next.Create) === 1 ? 1 : 0,
        Number(next.Read) === 1 ? 1 : 0,
        Number(next.Update) === 1 ? 1 : 0,
        Number(next.Delete) === 1 ? 1 : 0,
        currentUser
      ],
    };

    this._loading.set(true);

    return new Promise<void>((resolve, reject) => {
      this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
        next: (res) => {
          if (!res.ok) {
            const msg: string = (res.error as any)
              ? String(res.error)
              : 'Failed to update permissions';
            this._error.set(msg);
            Utilities.showToast(msg, 'error');
            // rollback handled by caller
            reject(msg);
            return;
          }
          // Refresh only this row's data in grid if API returns authoritative data
          // Here we just ensure the node data matches 'next'
          try {
            if (p?.node?.data) {
              p.node.data.Create = next.Create;
              p.node.data.Read = next.Read;
              p.node.data.Update = next.Update;
              p.node.data.Delete = next.Delete;
            }
          } catch {}
          // Ensure full grid refresh so any dependent logic / other formatting stays consistent
          this.loadRolesRoutes(roleId);
          resolve();
        },
        error: (err) => {
          console.error('[UserRolesComponent] update permissions error', err);
          const msg = 'Failed to update permissions';
          this._error.set(msg);
          Utilities.showToast(msg, 'error');
          reject(err);
        },
        complete: () => this._loading.set(false),
      });
    });
  }

  ngOnInit(): void {
    this.loadRoles();
    this.evaluateViewport();
    window.addEventListener("resize", this._onResize, { passive: true });
  }

  ngOnDestroy(): void {
    window.removeEventListener("resize", this._onResize as any);
  }

  private _onResize = () => {
    this.evaluateViewport();
  };

  private evaluateViewport(): void {
    const compact = window.innerWidth < 640; // breakpoint ~sm
    const prev = this._compactActions();
    if (prev !== compact) {
      this._compactActions.set(compact);
      this.adjustActionsColumnWidth();
    } else if (!this.gridApi) {
      // store desired width until grid ready
      this.pendingActionColWidth = compact ? 90 : 160;
    }
  }

  private adjustActionsColumnWidth(): void {
    const width = this._compactActions() ? 90 : 160;
    if (!this.gridApi) {
      this.pendingActionColWidth = width;
      return;
    }
    const col = this.gridApi.getColumn("actions");
    if (col) {
      this.gridApi.setColumnWidth(col, width);
    }
  }

  private isAdminRole(rec: RoleRecord): boolean {
    const role = (rec?.role ?? "").toString().trim().toUpperCase();
    return this.ADMIN_ROLES.has(role);
  }

  loadRoles(): void {
    this._loading.set(true);
    this._error.set(null);
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.auth_roles_crud_v2,
      // v2 signature: (action, id_role, role, description, active)
      // Read-all: pass null for id_role, role, description, active
      parameters: ["R", null, null, null, null],
    };
    this.core
      .executeCommand<DriveWhipCommandResponse<RoleRecord>>(api)
      .subscribe({
        next: (res) => {
          if (!res.ok) {
            const msg: string = (res.error as any)
              ? String(res.error)
              : "Failed to load roles";
            this._error.set(msg);
            Utilities.showToast(msg, "error");
            this._loading.set(false);
            return;
          }
          let raw: any = [];
          if (res.ok && Array.isArray(res.data)) {
            // Some backends (e.g. mysql2 / stored procedure calls) return: [ [ rows ], fields ] or simply [ [ rows ] ]
            // Our API seems to already strip fields but still wraps rows in an extra array.
            const top = res.data as any[];
            if (top.length > 0 && Array.isArray(top[0])) {
              raw = top[0];
            } else {
              raw = top; // fallback if already flat
            }
          }
          const list: RoleRecord[] = Array.isArray(raw) ? raw : [];
          // Filter out potential empty placeholder objects
          const cleaned = list.filter(
            (r) =>
              r &&
              Object.values(r).some(
                (v) => v !== null && v !== undefined && String(v).trim() !== ""
              )
          );
          this._roles.set(cleaned as RoleRecord[]);
        },
        error: (err) => {
          console.error("[UserRolesComponent] loadRoles error", err);
          const msg = "Failed to load roles";
          this._error.set(msg);
          Utilities.showToast(msg, "error");
        },
        complete: () => this._loading.set(false),
      });
  }

  loadRolesRoutes(roleId?: number | null): void {
    this._loading.set(true);
    this._error.set(null);
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.auth_roles_routes,
      // Now send the Role Id from v2 list; backend expects id over role string
      parameters: [roleId?.toString() ?? null],
    };
    this.core
      .executeCommand<DriveWhipCommandResponse<RoleRouteRecord>>(api)
      .subscribe({
        next: (res) => {
          if (!res.ok) {
            const msg: string = (res.error as any)
              ? String(res.error)
              : "Failed to load roles routes";
            this._error.set(msg);
            Utilities.showToast(msg, "error");
            this._loading.set(false);
            return;
          }
          let raw: any = [];
          if (res.ok && Array.isArray(res.data)) {
            // Some backends (e.g. mysql2 / stored procedure calls) return: [ [ rows ], fields ] or simply [ [ rows ] ]
            // Our API seems to already strip fields but still wraps rows in an extra array.
            const top = res.data as any[];
            if (top.length > 0 && Array.isArray(top[0])) {
              raw = top[0];
            } else {
              raw = top; // fallback if already flat
            }
          }
          const list: RoleRouteRecord[] = Array.isArray(raw) ? raw : [];
          // Filter out potential empty placeholder objects
          const cleaned = list.filter(
            (r) =>
              r &&
              Object.values(r).some(
                (v) => v !== null && v !== undefined && String(v).trim() !== ""
              )
          ) as RoleRouteRecord[];

          // Build map id_route -> label for parents (only root menus parent_id null)
          const labelById: Record<number, string> = {};
          for (const r of cleaned) {
            if (r && (r.parent_id === null || r.parent_id === undefined)) {
              labelById[r.id_route] = r.label;
            }
          }
          // Derive parentLabel for each
          const withParent: RoleRouteRecord[] = cleaned.map((r) => ({
            ...r,
            parentLabel: r.parent_id
              ? labelById[r.parent_id] || "(Unknown parent)"
              : "ROOT",
          }));

          // Optional: sort by parentLabel then sort_order then label
          withParent.sort((a, b) => {
            const pl = a.parentLabel!.localeCompare(b.parentLabel!);
            if (pl !== 0) return pl;
            const so = (a.sort_order || 0) - (b.sort_order || 0);
            if (so !== 0) return so;
            return a.label.localeCompare(b.label);
          });

          this._rolesroutes.set(withParent);
        },
        error: (err) => {
          console.error("[UserRolesComponent] loadRoles error", err);
          const msg = "Failed to load roles";
          this._error.set(msg);
          Utilities.showToast(msg, "error");
        },
        complete: () => this._loading.set(false),
      });
  }

  onGridReady(e: GridReadyEvent) {
    this.gridApi = e.api;
    // With flex columns we no longer need sizeColumnsToFit; allow natural dynamic sizing
    if (this.pendingActionColWidth) {
      const col = this.gridApi.getColumn("actions");
      if (col) this.gridApi.setColumnWidth(col, this.pendingActionColWidth);
      this.pendingActionColWidth = null;
    } else {
      this.adjustActionsColumnWidth();
    }
  }

  onGridCellKeyDown(event: any): void {
    const key = (event.event as KeyboardEvent)?.key?.toLowerCase?.() || "";
    const ctrl =
      (event.event as KeyboardEvent)?.ctrlKey ||
      (event.event as KeyboardEvent)?.metaKey;
    if (ctrl && key === "c") {
      const api = event.api;
      const ranges = (api as any).getCellRanges?.() || [];
      if (
        ranges &&
        ranges.length &&
        (api as any).copySelectedRangeToClipboard
      ) {
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
      if (value) navigator.clipboard?.writeText(value).catch(() => {});
    }
  }

  // CRUD placeholders
  onCreate(): void {
    this._dialogMode.set("create");
    this._editingRecord.set(null);
    this._dialogOpen.set(true);
  }

  onEdit(record: RoleRecord): void {
    this._dialogMode.set("edit");
    this._editingRecord.set(record);
    this._dialogOpen.set(true);
  }

  onDelete(record: RoleRecord): void {
    if (!record) return;
    if (Number(record.isactive) !== 1) return; // already inactive, button will be disabled too

    // Bloquear deshabilitar a cuentas administrador
    if (this.isAdminRole(record)) {
      Utilities.showToast("Administrator role cannot be disabled.", "warning");
      return;
    }

    Utilities.confirm({
      title: "Disable role",
      text: `The role "${record.role}" will be disabled. Continue?`,
      confirmButtonText: "Disable",
      icon: "warning",
      allowOutsideClick: false,
    }).then((ok) => {
      if (!ok) return;
      // Pass Id for delete (action 'D') in second param
  this.mutate("D", record.Id ?? null, record.role).subscribe({
        next: (success) => {
          if (success) Utilities.showToast("Role disabled", "success");
        },
        error: (err) => {
          console.error("[UserRolesComponent] delete error", err);
          const msg = "Failed to disable role";
          this._error.set(msg);
          Utilities.showToast(msg, "error");
        },
      });
    });
  }

  closeDialog(): void {
    if (this._saving()) return; // avoid closing while saving
    this._dialogOpen.set(false);
  }

  handleDialogSave(result: RoleDialogResult): void {
    if (this._saving()) return;
    const mode = this._dialogMode();
    const isCreate = mode === "create";
    const action: "C" | "U" = isCreate ? "C" : "U";
    this._saving.set(true);
    // For updates send role Id; for creates null
    const idRole = isCreate ? null : this.editingRecord()?.Id ?? null;
    this.mutate(
      action,
      idRole,
      result.role,
      result.description,
      result.isActive ? 1 : 0
    )
      .pipe(finalize(() => this._saving.set(false)))
      .subscribe({
        next: (success) => {
          if (success) {
            // liberar estado de guardado antes de cerrar para que el guard no bloquee
            this._saving.set(false);
            this.closeDialog();
            Utilities.showToast(
              isCreate ? "Role created" : "Role updated",
              "success"
            );
          }
        },
        error: (err) => {
          console.error("[UserRolesComponent] save error", err);
          const msg = "Failed to save role";
          this._error.set(msg);
          Utilities.showToast(msg, "error");
        },
      });
  }

  private mutate(
    action: "C" | "U" | "D",
    idRole: number | null,
    role: string,
    description: string = "",
    isActive: number | null = null
  ): Observable<boolean> {
    this._loading.set(true);
    const effectiveIsActive = action === "D" ? null : isActive;
    // v2 expects: action, id_role, role, description, active
    const params: any[] = [
      action,
      idRole?.toString() ?? null,
      role,
      description,
      effectiveIsActive,
    ];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.auth_roles_crud_v2,
      parameters: params,
    };
    return this.core
      .executeCommand<DriveWhipCommandResponse<RoleRecord>>(api)
      .pipe(
        tap((res) => {
          if (!res.ok) {
            const msg: string = (res.error as any)
              ? String(res.error)
              : "Action failed";
            this._error.set(msg);
            Utilities.showToast(msg, "error");
            this._loading.set(false);
            return;
          }
          this.loadRoles();
        }),
        map((res) => !!res.ok),
        catchError((err) => {
          console.error("[UserRolesComponent] mutate error", err);
          const msg = "Action failed";
          this._loading.set(false);
          this._error.set(msg);
          Utilities.showToast(msg, "error");
          return of(false);
        })
      );
  }

  onCellClicked(e: CellClickedEvent) {
    if (e.colDef.field !== "actions") return;
    if (!e.event) return;
    const target = e.event.target as HTMLElement | null;
    if (!target) return;
    const button = target.closest(
      "button[data-action]"
    ) as HTMLButtonElement | null;
    if (!button) return;
    const action = button.getAttribute("data-action");
    const record = e.data as RoleRecord;
    if (!record) return;
    if (action === "edit") this.onEdit(record);
    else if (action === "delete") this.onDelete(record);
  }

  private actionButtons(record: RoleRecord) {
    if (!record) return "";
    const compact = this._compactActions();
    const inactive = Number(record.isactive) !== 1; // handle '1'/'0' strings from backend
    const admin = this.isAdminRole(record);
    const disabledAttr = inactive || admin ? "disabled" : "";
    const disableTitle = admin
      ? "Administrator role cannot be disabled"
      : inactive
      ? "Already inactive"
      : "Disable " + record.role;
    if (compact) {
      return `
        <div class="d-flex gap-1 justify-content-end">
          <button class="btn btn-xs btn-outline-secondary dw-icon-btn" type="button" data-action="edit" title="Edit ${record.role}" aria-label="Edit ${record.role}">
            <i class="feather icon-edit"></i>
          </button>
          <button class="btn btn-xs btn-outline-danger dw-icon-btn" type="button" data-action="delete" title="${disableTitle}" aria-label="Disable ${record.role}" ${disabledAttr}>
            <i class="feather icon-slash"></i>
          </button>
        </div>`;
    }
    return `
      <div class="d-flex gap-1 justify-content-end">
        <button class="btn btn-xs btn-outline-secondary" type="button" data-action="edit" data-role="${record.role}">Edit</button>
        <button class="btn btn-xs btn-outline-danger" type="button" data-action="delete" data-role="${record.role}" ${disabledAttr} title="${disableTitle}">Disable</button>
      </div>`;
  }

  private renderActiveBadge(value: any): string {
    const active = value === 1 || value === true;
    const cls = active
      ? "badge text-bg-success bg-success-subtle text-success fw-medium px-2 py-1"
      : "badge text-bg-danger bg-danger-subtle text-danger fw-medium px-2 py-1";
    const label = active ? "Active" : "Inactive";
    return `<span class="${cls}" style="font-size:11px; letter-spacing:.5px;">${label}</span>`;
  }

  private formatDate(raw: string): string {
    if (!raw) return "";
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toISOString().slice(0, 16).replace("T", " ");
  }

  //new

  onRoleSelectionChanged(): void {
    if (!this.gridApi) return;

    // Toma la fila seleccionada (compatibilidad: selectedRows o selectedNodes)
    const selected =
      (this.gridApi.getSelectedRows?.()[0] as RoleRecord | undefined) ??
      (this.gridApi.getSelectedNodes?.()[0]?.data as RoleRecord | undefined);

    // Si no hay selección, limpia el hijo
    if (!selected) {
      this.selectedRole.set(null);
      // this.permRows.set([]);
      this.permError.set(null);
      return;
    }

    // Evita recargar si es el mismo rol
    if (this.selectedRole()?.role === selected.role) return;

    // Guarda selección y carga permisos del hijo
    this.selectedRole.set(selected);
    this.loadRolesRoutes(selected.Id ?? null);
  }

  // HTML escaping helper (mirrors pattern used in locations grid)
  private escapeHtml(v: string): string {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
