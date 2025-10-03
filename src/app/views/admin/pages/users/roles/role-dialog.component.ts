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
import { RoleRecord } from "../../../../../core/models/role.model";

export interface RoleDialogResult {
  role: string;
  description: string;
  isActive: boolean;
}

@Component({
  selector: "dw-role-dialog",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="role-dialog-backdrop" (click)="onBackdrop($event)"></div>
    <div class="role-dialog card shadow-lg">
      <div
        class="card-header d-flex align-items-center justify-content-between py-2"
      >
        <h6 class="mb-0 fw-semibold">
          {{ mode === "create" ? "Create Role" : "Edit Role" }}
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
          <div class="mb-3">
            <label class="form-label small fw-semibold"
              >Role Name <span class="text-danger">*</span></label
            >
            <input
              type="text"
              class="form-control form-control-sm"
              name="role"
              [(ngModel)]="role"
              required
              [readonly]="mode === 'edit'"
            />
            <div class="invalid-feedback d-block" *ngIf="roleError">
              {{ roleError }}
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label small fw-semibold">Description</label>
            <textarea
              rows="3"
              class="form-control form-control-sm"
              name="description"
              [(ngModel)]="description"
            ></textarea>
          </div>
          <!-- Active switch: hidden on create because SP auth_roles_crud always inserts with is_active=1 ignoring p_active -->
          <div class="form-check form-switch mb-3" *ngIf="mode === 'edit'">
            <input
              class="form-check-input"
              type="checkbox"
              id="activeSwitch"
              [(ngModel)]="isActive"
              name="isActive"
            />
            <label class="form-check-label small" for="activeSwitch"
              >Active</label
            >
          </div>
          <div class="d-flex justify-content-end gap-2">
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
              [disabled]="saving || !roleValid()"
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
      .role-dialog-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(2px);
      }
      .role-dialog {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 420px;
        max-width: 95%;
      }
      textarea {
        resize: vertical;
      }
    `,
  ],
})
export class RoleDialogComponent implements OnChanges {
  @Input() mode: "create" | "edit" = "create";
  @Input() record: RoleRecord | null = null;
  @Input() existingRoleNames: string[] = [];
  @Input() saving = false;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<RoleDialogResult>();

  role = "";
  description = "";
  isActive = true;
  roleError: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["record"] || changes["mode"]) {
      if (this.mode === "edit" && this.record) {
        this.role = this.record.role;
        this.description = this.record.description;
        this.isActive = !!this.record.isactive;
      } else if (this.mode === "create") {
        this.role = "";
        this.description = "";
        this.isActive = true;
      }
      this.roleError = null;
    }
  }

  roleValid(): boolean {
    if (!this.role.trim()) return false;
    if (
      this.mode === "create" &&
      this.existingRoleNames.includes(this.role.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  }

  save(): void {
    this.role = this.role.trim();
    if (!this.roleValid()) {
      this.roleError = this.existingRoleNames.includes(this.role.toLowerCase())
        ? "Role already exists."
        : "Role is required.";
      return;
    }
    // NOTE: On create the backend SP currently forces is_active = 1 regardless; we still emit isActive for future compatibility
    this.saved.emit({
      role: this.role,
      description: this.description,
      isActive: this.isActive,
    });
  }

  cancel(): void {
    this.closed.emit();
  }
  onBackdrop(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) this.cancel();
  }
}
