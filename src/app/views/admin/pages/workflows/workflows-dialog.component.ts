import {
  Component, Input, Output, EventEmitter,
  OnChanges, SimpleChanges, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';

export interface WorkflowRecord {
  id_workflow: number;
  id_location: number | null;
  name: string;
  notes: string | null;
  is_active: number;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  location_name: string | null;
}

export interface WorkflowDialogResult {
  name: string;
  id_location: number | null;
  notes: string;
  sort_order: number | null;
  active: boolean; // visible solo en edit
}

type LocationOption = { id: number; code: string; name: string };

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
            <div class="col-md-8">
              <label class="form-label small fw-semibold">
                Workflow Name <span class="text-danger">*</span>
              </label>
              <input type="text"
                     class="form-control form-control-sm"
                     name="name"
                     [(ngModel)]="name"
                     required />
              <div class="invalid-feedback d-block" *ngIf="nameError">{{ nameError }}</div>
            </div>

            <div class="col-md-4">
              <label class="form-label small fw-semibold">
                Location <span class="text-danger">*</span>
              </label>
              <select class="form-select form-select-sm"
                      name="id_location"
                      [(ngModel)]="id_location"
                      [disabled]="loadingLocations || locations.length === 0"
                      required>
                <option [ngValue]="null" disabled *ngIf="id_location === null">Select a location</option>
                <option *ngFor="let s of locations" [ngValue]="s.id">
                  {{ s.name }} {{ s.code ? '(' + s.code + ')' : '' }}
                </option>
              </select>
              <div class="text-danger small pt-1" *ngIf="locationLoadError">{{ locationLoadError }}</div>
              <div class="text-danger small pt-1" *ngIf="locationError">{{ locationError }}</div>
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

  // Catálogo
  locationLoadError: string | null = null;
  loadingLocations = false;
  locations: LocationOption[] = [];

  // Form
  name = '';
  id_location: number | null = null;
  notes = '';
  sort_order: number | null = null;
  active = true;

  // UI errors
  nameError: string | null = null;
  locationError: string | null = null;

  constructor(private core: DriveWhipCoreService) {}

  ngOnInit(): void {
    this.loadLocations();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['record'] || changes['mode']) {
      if (this.mode === 'edit' && this.record) {
        // ⬇️ Prefill desde la fila (coerción fuerte a number)
        this.name = this.record.name ?? '';
        this.id_location =
          this.record.id_location !== null && this.record.id_location !== undefined
            ? Number(this.record.id_location)
            : null;
        this.notes = this.record.notes ?? '';
        this.sort_order =
          this.record.sort_order !== null && this.record.sort_order !== undefined
            ? Number(this.record.sort_order)
            : null;
        this.active = Number(this.record.is_active) === 1;

        // Si ya hay catálogo cargado, asegúrate que exista la opción y re-asigna para que Angular seleccione
        this.ensureSelectedLocation();
      } else {
        // Estado inicial en create
        this.name = '';
        this.id_location = null;
        this.notes = '';
        this.sort_order = null;
        this.active = true;
      }
      this.nameError = null;
      this.locationError = null;
    }
  }

  /** Carga catálogo y sincroniza selección si venías en modo edición */
  private loadLocations(): void {
    this.loadingLocations = true;
    this.locationLoadError = null;

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_locations_list,
      parameters: []
    };

    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (res?.ok) {
          const raw = res.data as any;
          const rows = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw[0] : raw) : [];
          this.locations = (rows ?? [])
            .map((r: any): LocationOption | null => {
              const idRaw = (r?.id_location ?? r?.id ?? r?.location_id ?? null);
              const id = (idRaw !== null && idRaw !== undefined && !Number.isNaN(Number(idRaw))) ? Number(idRaw) : null;
              if (id === null) return null;

              const code = (r?.code ?? r?.abbr ?? r?.state ?? '').toString().trim().toUpperCase();
              const name = (r?.name ?? r?.location_name ?? r?.label ?? `Location #${id}`).toString().trim();
              return { id, code, name };
            })
            .filter(Boolean) as LocationOption[];

          this.locations.sort((a, b) => a.name.localeCompare(b.name));

          // 🔁 Ahora que cargó el catálogo, sincroniza la selección del combo
          this.ensureSelectedLocation();
        } else {
          this.locations = [];
          this.locationLoadError = (res as any)?.error || 'Failed to load locations';
        }
        this.loadingLocations = false;
      },
      error: (err) => {
        console.error('[WorkflowsDialogComponent] loadLocations error', err);
        this.locations = [];
        this.locationLoadError = 'Request failed';
        this.loadingLocations = false;
      }
    });
  }

  /** Garantiza que el <select> muestre la opción del registro editado */
  private ensureSelectedLocation(): void {
    if (this.id_location === null) return;
    // Si existe en el catálogo, re-asigna el mismo número (fuerza el binding)
    const exists = this.locations.some(x => x.id === Number(this.id_location));
    if (exists) {
      this.id_location = Number(this.id_location);
    } else {
      // Si el id del registro no existe en catálogo, limpia para obligar selección manual
      this.id_location = null;
    }
  }

  formValid(): boolean {
    const nameOk = !!this.name?.trim();
    const locOk = this.id_location !== null && !Number.isNaN(this.id_location);
    return nameOk && locOk;
  }

  save(): void {
    this.name = this.name.trim();
    this.nameError = null;
    this.locationError = null;

    if (!this.name) this.nameError = 'Workflow name is required.';
    if (this.id_location === null) this.locationError = 'Location is required.';
    if (!this.formValid()) return;

    const order = this.sort_order;

    this.saved.emit({
      name: this.name,
      id_location: this.id_location,
      notes: this.notes?.trim() || '',
      sort_order: (order === undefined || order === null || (order as any) === '') ? null : Number(order),
      active: this.active,
    });
  }

  cancel(): void { this.closed.emit(); }
  onBackdrop(ev: MouseEvent){ if (ev.target === ev.currentTarget) this.cancel(); }
}
