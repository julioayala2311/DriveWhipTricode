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
  role: string;
  active: boolean; // only relevant on edit (hidden on create)
}

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
            <div class="col-md-6">
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
            </div>
            <div class="col-md-6">
              <label class="form-label small fw-semibold"
                >Username <span class="text-danger">*</span></label
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
                name="role"
                [(ngModel)]="role"
                required
                [disabled]="roles.length === 0"
              >
                <option value="" disabled>Select a role...</option>
                <option *ngFor="let r of roles" [value]="r">{{ r }}</option>
              </select>
              <div
                class="invalid-feedback d-block"
                *ngIf="role && roles.length && !roles.includes(role)"
              >
                Selected role is no longer active.
              </div>
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
                />
                <label class="form-check-label small" for="accActiveSwitch">Active</label>
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
  @Input() roles: string[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<AccountDialogResult>();

  user = "";
  firstname = "";
  lastname = "";
  role = "";
  active = true;
  userError: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["record"] || changes["mode"]) {
      if (this.mode === "edit" && this.record) {
        this.user = this.record.user;
        this.firstname = this.record.firstname;
        this.lastname = this.record.lastname;
        this.role = this.record.role;
        this.active = this.record.active === 1;
      } else if (this.mode === "create") {
        this.user = "";
        this.firstname = "";
        this.lastname = "";
        this.role = "";
        this.active = true; // SP will enforce 1 on create
      }
      this.userError = null;
    }
  }

  formValid(): boolean {
    if (
      !this.user.trim() ||
      !this.firstname.trim() ||
      !this.lastname.trim() ||
      !this.role.trim()
    )
      return false;
    if (
      this.mode === "create" &&
      this.existingUsernames.includes(this.user.trim().toLowerCase())
    )
      return false;
    if (this.roles.length > 0 && !this.roles.includes(this.role.trim()))
      return false;
    return true;
  }

  save(): void {
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
    this.saved.emit({
      user: this.user,
      firstname: this.firstname,
      lastname: this.lastname,
      role: this.role,
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
