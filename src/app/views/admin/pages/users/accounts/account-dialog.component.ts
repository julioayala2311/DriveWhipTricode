import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { UserAccountRecord } from "../../../../../core/models/user-account.model";

export interface AccountDialogResult {
  user: string;
  firstname: string;
  lastname: string;
  roleId: number;   // send numeric role Id to backend
  role?: string;    // optional label for convenience
  active: boolean; // only relevant on edit (hidden on create)
}
import { RoleRecord } from "../../../../../core/models/role.model";

@Component({
  selector: "dw-account-dialog",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dw-acc-dialog-backdrop" (click)="onBackdrop($event)"></div>
    <div class="dw-acc-dialog card shadow-lg">
      <div
        class="card-header d-flex align-items-center justify-content-between py-2"
      >
        <h6 class="mb-0 fw-semibold">
          {{ mode === "create" ? "Create Account" : "Edit Account" }}
        </h6>
        <button
          type="button"
          class="btn btn-sm btn-link text-secondary"
          (click)="cancel()"
          [disabled]="saving"
        >
          ×
        </button>
      </div>
      <div class="card-body">
        <form (ngSubmit)="save()" #f="ngForm" autocomplete="off" novalidate>
          <div class="row g-3">
            <!-- <div class="col-md-6">
              <label class="form-label small fw-semibold"
                >First Name <span class="text-danger">*</span></label
              >
              <input
                type="text"
                class="form-control form-control-sm"
                name="firstname"
                [(ngModel)]="firstname"
                required
              />
            </div>
            <div class="col-md-6">
              <label class="form-label small fw-semibold"
                >Last Name <span class="text-danger">*</span></label
              >
              <input
                type="text"
                class="form-control form-control-sm"
                name="lastname"
                [(ngModel)]="lastname"
                required
              />
            </div> -->
            <div class="col-md-6">
              <label class="form-label small fw-semibold"
                >Email <span class="text-danger">*</span></label
              >
              <input
                type="text"
                class="form-control form-control-sm"
                name="user"
                [(ngModel)]="user"
                required
                [readonly]="mode === 'edit'"
              />
              <div class="invalid-feedback d-block" *ngIf="userError">
                {{ userError }}
              </div>
            </div>
            <div class="col-md-6">
              <label class="form-label small fw-semibold"
                >Role <span class="text-danger">*</span></label
              >
              <select
                class="form-select form-select-sm"
                name="roleId"
                [(ngModel)]="roleId"
                required
                [disabled]="roles.length === 0"
              >
                <option [ngValue]="null" disabled>Select a role...</option>
                <option *ngFor="let r of roles" [ngValue]="r.Id">{{ r.role }}</option>
              </select>
              <!-- Invalid feedback placeholder removed until role list diff logic needed -->
              <div
                class="text-muted small fst-italic pt-1"
                *ngIf="roles.length === 0"
              >
                No active roles available.
              </div>
            </div>
            <div class="col-md-6 d-flex align-items-center" *ngIf="mode === 'edit'">
              <div class="form-check form-switch mt-4">
                <input
                  class="form-check-input"
                  type="checkbox"
                  id="accActiveSwitch"
                  [(ngModel)]="active"
                  name="active"
                  [disabled]="isAdminRecord"
                />
                <label class="form-check-label small" for="accActiveSwitch">Active</label>
                <div class="text-warning small pt-1" *ngIf="isAdminRecord">
                  Administrator accounts cannot be disabled.
                </div>
              </div>
            </div>
          </div>
          <div class="d-flex justify-content-end gap-2 mt-3">
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              (click)="cancel()"
              [disabled]="saving"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-sm btn-primary"
              [disabled]="saving || !formValid()"
            >
              {{ saving ? "Saving..." : "Save" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 1050;
        display: block;
      }
      .dw-acc-dialog-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(2px);
      }
      .dw-acc-dialog {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 520px;
        max-width: 95%;
      }
    `,
  ],
})
export class AccountDialogComponent implements OnChanges {
  @Input() mode: "create" | "edit" = "create";
  @Input() record: UserAccountRecord | null = null;
  @Input() existingUsernames: string[] = [];
  @Input() saving = false;
  @Input() roles: RoleRecord[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<AccountDialogResult>();

  user = "";
  firstname = "";
  lastname = "";
  role = "";      // label only (for edit display/compat)
  roleId: number | null = null;
  active = true;
  userError: string | null = null;
  isAdminRecord = false; // UI guard for ADMIN role

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["record"] || changes["mode"] || changes["roles"]) {
      if (this.mode === "edit" && this.record) {
        this.user = this.record.user;
        this.firstname = this.record.firstname;
        this.lastname = this.record.lastname;
        this.role = this.record.role;
  // try to map current role label to Id from provided roles
        const match = this.roles.find(r => r.role?.trim().toLowerCase() === (this.record!.role || '').trim().toLowerCase());
        this.roleId = match?.Id ?? null;
  this.isAdminRecord = (this.record.role || '').trim().toUpperCase() === 'ADMIN';
        // Accept numeric 1, boolean true, or string 'true'
        const a: any = (this.record as any).active;
        this.active = (a === 1 || a === true || String(a).toLowerCase() === 'true');
      } else if (this.mode === "create") {
        this.user = "";
        this.firstname = "";
        this.lastname = "";
        this.role = "";
        this.roleId = null;
        this.active = true; // SP will enforce 1 on create
        this.isAdminRecord = false;
      }
      this.userError = null;
    }
  }

  formValid(): boolean {
    if (
      !this.user.trim() ||
      // !this.firstname.trim() ||
      // !this.lastname.trim() ||
      this.roleId == null
    )
      return false;
    if (
      this.mode === "create" &&
      this.existingUsernames.includes(this.user.trim().toLowerCase())
    )
      return false;
    if (this.roles.length > 0 && this.roleId != null && !this.roles.some(r => r.Id === this.roleId))
      return false;
    return true;
  }

  save(): void {
    // Hard guard: never allow deactivating ADMIN via dialog
    if (this.isAdminRecord) {
      this.active = true;
    }
    this.user = this.user.trim();
    this.firstname = this.firstname.trim();
    this.lastname = this.lastname.trim();
    this.role = this.role.trim();
    if (!this.formValid()) {
      if (!this.user.trim()) this.userError = "Username is required.";
      else if (this.existingUsernames.includes(this.user.toLowerCase()))
        this.userError = "Username already exists.";
      else this.userError = null;
      return;
    }
    const selectedRole = this.roles.find(r => r.Id === this.roleId!);
    this.saved.emit({
      user: this.user,
      firstname: this.firstname,
      lastname: this.lastname,
      roleId: this.roleId!,
      role: selectedRole?.role,
      active: this.active,
    });
  }

  cancel(): void {
    this.closed.emit();
  }
  onBackdrop(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) this.cancel();
  }
}
