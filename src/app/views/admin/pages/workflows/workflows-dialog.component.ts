import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges,
  signal,
  computed,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';

export interface LocationRecord {
  id_location: string;
  name: string;
}

export interface LocationListResponse extends Array<LocationRecord> {}


export interface WorkflowRecord {
  id_workflow: number;
  id_location: number | null;
  workflow_name: string;
  notes: string | null;
  is_active: number;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface WorkflowDialogResult {
  workflow_name: string;
  id_location: number | null;
  notes: string;
  sort_order: number | null;
  active: boolean; // visible only in edit mode
}

@Component({
  selector: 'dw-workflow-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dw-acc-dialog-backdrop" (click)="onBackdrop($event)"></div>
    <div class="dw-acc-dialog card shadow-lg">
      <div class="card-header d-flex align-items-center justify-content-between py-2">
        <h6 class="mb-0 fw-semibold">
          {{ mode === 'create' ? 'Create Workflow' : 'Edit Workflow' }}
        </h6>
        <button type="button" class="btn btn-sm btn-link text-secondary" (click)="cancel()" [disabled]="saving">×</button>
      </div>

      <div class="card-body">
        <form (ngSubmit)="save()" #f="ngForm" autocomplete="off" novalidate>
          <div class="row g-3">
            <div class="col-md-12">
              <label class="form-label small fw-semibold">
                Workflow Name <span class="text-danger">*</span>
              </label>
              <input type="text" class="form-control form-control-sm" name="workflow_name"
                     [(ngModel)]="workflow_name" required />
              <div class="invalid-feedback d-block" *ngIf="nameError">{{ nameError }}</div>
            </div>

            <!-- <div class="col-md-4">
              <label class="form-label small fw-semibold">Location (optional)</label>
              <input type="number" class="form-control form-control-sm"
                     name="id_location" [(ngModel)]="id_location" [min]="0" />
            </div> -->
            <div class="col-md-12">
              <label class="form-label small fw-semibold"
                >Location <span class="text-danger">*</span></label
              >
              <select
                class="form-select form-select-sm"
                name="role"
                [(ngModel)]="id_location"
                required
                [disabled]="_locations().length === 0"
              >
                <option value="" disabled>Select a location...</option>
                <option *ngFor="let r of _locations()" [value]="r.id_location">{{ r.name }}</option>
              </select>      
              <div
                class="text-muted small fst-italic pt-1"
                *ngIf="_locations().length === 0"
              >
                No active locations available.
              </div>
            </div>

            <!-- <div class="col-md-12">
              <label class="form-label small fw-semibold">Sort Order (optional)</label>
              <input type="number" class="form-control form-control-sm"
                     name="sort_order" [(ngModel)]="sort_order" />
            </div> -->

            <div class="col-12">
              <label class="form-label small fw-semibold">Notes</label>
              <textarea class="form-control form-control-sm" name="notes"
                        [(ngModel)]="notes" rows="3"></textarea>
            </div>

            <div class="col-md-6 d-flex align-items-center" *ngIf="mode === 'edit'">
              <div class="form-check form-switch mt-4">
                <input class="form-check-input" type="checkbox" id="wfActiveSwitch"
                       [(ngModel)]="active" name="active" />
                <label class="form-check-label small" for="wfActiveSwitch">Active</label>
              </div>
            </div>
          </div>

          <div class="d-flex justify-content-end gap-2 mt-3">
            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="cancel()" [disabled]="saving">
              Cancel
            </button>
            <button type="submit" class="btn btn-sm btn-primary" [disabled]="saving || !formValid()">
              {{ saving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: [`
    :host{ position:fixed; inset:0; z-index:1050; display:block; }
    .dw-acc-dialog-backdrop{ position:absolute; inset:0; background:rgba(0,0,0,.35); backdrop-filter:blur(2px); }
    .dw-acc-dialog{ position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:520px; max-width:95%; }
  `],
})
export class WorkflowsDialogComponent implements OnInit, OnChanges {
  @Input() mode: 'create' | 'edit' = 'create';
  @Input() record: WorkflowRecord | null = null;
  @Input() saving = false;
  @Output() closed = new EventEmitter<void>();
  @Output() saved  = new EventEmitter<WorkflowDialogResult>();  
  //@Input() locations: string[] = [];
  
  _locations = signal<LocationRecord[]>([]); // active role names
  locations : LocationRecord[] = []; // computed(() => this._locations());

  workflow_name = '';
  id_location: number | null = null;
  notes = '';
  sort_order: number | null = null;
  active = true;
  locationSelected: number | null = null;

  nameError: string | null = null;

  
  constructor(private core: DriveWhipCoreService) {
    this.loadLocations();
  }

  ngOnInit(){
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['record'] || changes['mode']) {
      if (this.mode === 'edit' && this.record) {
  // Pre-fill values from existing record
        this.workflow_name = this.record.workflow_name ?? '';
        this.id_location = (this.record.id_location ?? null) as any;
        this.notes = this.record.notes ?? '';
        this.sort_order = (this.record.sort_order ?? null) as any;
        this.active = Number(this.record.is_active) === 1;
        this.locationSelected = this.record.id_location;
      } else {
  // Reset to initial state for create mode
        this.workflow_name = '';
        this.id_location = null;
        this.notes = '';
        this.sort_order = null;
        this.active = true;
        this.locationSelected = null;
      }
      this.nameError = null;
    }
  }

  private loadLocations(): void {

      const api: IDriveWhipCoreAPI = {
        commandName: DriveWhipAdminCommand.crm_locations_workflows_list,
        parameters: []
      };
      this.core.executeCommand<DriveWhipCommandResponse<LocationRecord>>(api).subscribe({
        next: res => {
          if (!res.ok) return; 

          let raw: any = [];

          if (Array.isArray(res.data)) {
            const top = res.data as any[];
              if (top.length > 0 && Array.isArray(top[0])) raw = top[0]; else raw = top;
          }
          const list: LocationRecord[] = Array.isArray(raw) ? raw : [];
        
          this._locations.set(list);
        },
    error: () => { /* ignore roles load error to avoid breaking accounts UI */ }
      });
  }

  // formValid(): boolean {
  //   return !!this.workflow_name.trim() || !!this.id_location;
  // }

  formValid(): boolean {
    const nameOk =
      typeof this.workflow_name === 'string' &&
      this.workflow_name.trim().length > 0;

    // id_location puede venir como number o string desde el <select>
    const loc = this.id_location as any;
    const locationOk = loc !== null && loc !== undefined && String(loc).trim() !== '';

    return nameOk && locationOk;
  }

  save(): void {
    this.workflow_name = this.workflow_name.trim();
    if (!this.formValid()) {
      this.nameError = 'Workflow name is required.';
      return;
    }
    const loc = this.id_location;
    const order = this.sort_order;

    this.saved.emit({
      workflow_name: this.workflow_name,
      id_location: this.id_location,
      notes: this.notes?.trim() || '',
      sort_order:null,// (order === undefined || order === null || (order as any) === '') ? null : Number(order),
      active: this.active,
    });
  }

  cancel(): void { this.closed.emit(); }
  onBackdrop(ev: MouseEvent){ if (ev.target === ev.currentTarget) this.cancel(); }
}
