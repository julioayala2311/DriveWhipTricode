import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { LocationsRecord } from '../../../../core/models/locations.model';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';
import { IDriveWhipCoreAPI, DriveWhipCommandResponse } from '../../../../core/models/entities.model';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';

export interface LocationDialogResult {
  name: string;
  id_market: number | null;     // si ya no lo usas, puedes quitarlo del payload
  notes: string;
  active: boolean;
  state: string | null;         // 2-letter code
  full_address: string | null;  // dirección completa
  json_form: string | null;
  state_code: string | null;
  country_code: string | null;
  previous_site_url: string | null;
}

type StateOption = { code: string; name: string };

@Component({
  selector: 'dw-home-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dw-acc-dialog-backdrop" (click)="onBackdrop($event)"></div>
    <div class="dw-acc-dialog card shadow-lg">
      <div class="card-header d-flex align-items-center justify-content-between py-2">
        <h6 class="mb-0 fw-semibold">
          {{ mode === 'create' ? 'Create Location' : 'Edit Location' }}
        </h6>
        <button type="button" class="btn btn-sm btn-link text-secondary" (click)="cancel()" [disabled]="saving">×</button>
      </div>

      <div class="card-body">
        <form (ngSubmit)="save()" #f="ngForm" autocomplete="off" novalidate>
          <div class="row g-3">
            <!-- Name -->
            <div class="col-12">
              <label class="form-label small fw-semibold">
                Location Name <span class="text-danger">*</span>
              </label>
              <input type="text" class="form-control form-control-sm" name="name"
                     [(ngModel)]="name" required />
              <div class="invalid-feedback d-block" *ngIf="nameError">{{ nameError }}</div>
            </div>

            <!-- Address section -->
            <div class="col-12">
              <div class="section-divider"></div>
              <div class="d-flex align-items-center justify-content-between mb-1">
                <label class="form-label small fw-semibold mb-0">Address</label>
              </div>
            </div>

            <div class="col-md-4">
              <label class="form-label small fw-semibold">State</label>
              <select class="form-select form-select-sm"
                      name="state"
                      [(ngModel)]="state"
                      [disabled]="loadingStates || states.length === 0">
                <option [ngValue]="''" [disabled]="true" *ngIf="!state">Select a state</option>
                <option *ngFor="let s of states" [ngValue]="s.code">{{ s.name }} ({{ s.code }})</option>
              </select>
              <div class="text-danger small pt-1" *ngIf="stateLoadError">{{ stateLoadError }}</div>
            </div>

            <div class="col-md-8">
              <label class="form-label small fw-semibold">Full Address</label>
              <input type="text"
                     class="form-control form-control-sm"
                     name="full_address"
                     maxlength="250"
                     [(ngModel)]="full_address"
                     placeholder="e.g., 123 Main St, Springfield, IL 62704" />
            </div>

            <!-- Notes -->
            <div class="col-12" style="display: none;">
              <div class="section-divider"></div>
              <label class="form-label small fw-semibold">Notes</label>
              <textarea class="form-control form-control-sm" name="notes"
                        [(ngModel)]="notes" rows="3"></textarea>
            </div>

            <!-- Status (only edit) -->
            <div class="col-md-6 d-flex align-items-center" *ngIf="mode === 'edit'">
              <div class="form-check form-switch mt-2">
                <input class="form-check-input" type="checkbox" id="locActiveSwitch"
                       [(ngModel)]="active" name="active" />
                <label class="form-check-label small ms-2" for="locActiveSwitch">Active</label>
              </div>
            </div>
          </div>

          
          <!-- URL -->
          <div class="col-12"  >
            <div class="section-divider"></div>
            <label class="form-label small fw-semibold">Prevous Site URL</label>
            <input type="text" class="form-control form-control-sm" name="previous_site_url"
                     [(ngModel)]="previous_site_url" required />
            <div class="invalid-feedback d-block" *ngIf="nameError">{{ nameError }}</div>
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
    .dw-acc-dialog{ position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:560px; max-width:95%; }
    .section-divider { border-top: 1px solid rgba(0,0,0,.08); margin: .25rem 0 .5rem; }
  `],
})
export class HomeDialogComponent implements OnInit, OnChanges {
  @Input() mode: 'create' | 'edit' = 'create';
  @Input() record: LocationsRecord | null = null;
  @Input() saving = false;
  @Output() closed = new EventEmitter<void>();
  @Output() saved  = new EventEmitter<LocationDialogResult>();

  // catálogo de estados
  states: StateOption[] = [];
  loadingStates = false;
  stateLoadError: string | null = null;

  // form model
  name = '';
  notes = '';
  active = true;
  state: string = '';            // código de 2 letras seleccionado en el combo
  full_address: string = '';
  json_form: string = '';
  state_code: string = '';       // si quieres mandarlo explícito al backend
  country_code: string = 'US';   // por defecto US
  previous_site_url: string = '';

  // valor entrante de estado (antes de cargar catálogo)
  private pendingStateRaw: string | null = null;

  nameError: string | null = null;

  constructor(private core: DriveWhipCoreService) {}

  ngOnInit(): void {
    this.loadStates();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['record'] || changes['mode']) {
      if (this.mode === 'edit' && this.record) {
        // Campos básicos
        this.name   = (this.record as any).location_name ?? (this.record as any).name ?? '';
        this.notes  = (this.record as any).notes ?? '';
        this.active = Number((this.record as any).active ?? (this.record as any).is_active ?? 1) === 1;

        // Address / country / state desde el registro
        this.full_address = (this.record as any).full_address ?? (this.record as any).address ?? '';
        this.country_code = ((this.record as any).country_code ?? 'US').toString().toUpperCase();
        
        this.previous_site_url   = (this.record as any).previous_site_url ?? (this.record as any).previous_site_url ?? '';

        // Puede venir como state_code ('MA') o como nombre ('Massachusetts') o campo genérico
        const rawState =
          (this.record as any).state_code ??
          (this.record as any).state ??
          (this.record as any).market_state ??
          (this.record as any).region ??
          '';

        // Guardar para aplicar cuando cargue el catálogo
        this.pendingStateRaw = rawState ? String(rawState) : null;

        // Si ya tenemos catálogo cargado, aplicar de una vez
        if (this.states.length > 0 && this.pendingStateRaw) {
          this.state = this.normalizeToStateCode(this.pendingStateRaw);
          this.pendingStateRaw = null;
        }
      } else {
        // modo create → limpiar
        this.name = '';
        this.notes = '';
        this.active = true;
        this.full_address = '';
        this.country_code = 'US';
        this.previous_site_url = '';
        this.state = '';
        this.state_code = '';
        this.json_form = '';
        this.pendingStateRaw = null;
      }
      this.nameError = null;
    }
  }

  /** Cargar estados de DB: commun_country_states('US') */
  private loadStates(): void {
    this.loadingStates = true;
    this.stateLoadError = null;

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.commun_country_states,
      parameters: [this.country_code || 'US']
    };

    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (res?.ok) {
          const raw = res.data as any;
          const rows = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw[0] : raw) : [];
          this.states = (rows ?? [])
            .map((r: any): StateOption | null => {
              const code = (r?.code ?? r?.abbr ?? r?.state_code ?? r?.state ?? '').toString().trim().toUpperCase();
              const name = (r?.name ?? r?.state_name ?? r?.label ?? '').toString().trim();
              if (!code || !name) return null;
              return { code, name };
            })
            .filter(Boolean) as StateOption[];

          this.states.sort((a, b) => a.name.localeCompare(b.name));

          // Aplicar el estado pendiente (si venía del registro)
          if (this.pendingStateRaw) {
            this.state = this.normalizeToStateCode(this.pendingStateRaw);
            this.pendingStateRaw = null;
          }
        } else {
          this.states = [];
          this.stateLoadError = (res as any)?.error || 'Failed to load states';
        }
        this.loadingStates = false;
      },
      error: (err) => {
        console.error('[HomeDialogComponent] loadStates error', err);
        this.states = [];
        this.stateLoadError = 'Request failed';
        this.loadingStates = false;
      }
    });
  }

  /** Normaliza nombre o código a un code de 2 letras válido del catálogo cargado */
  private normalizeToStateCode(value: string | null | undefined): string {
    const s = (value ?? '').toString().trim();
    if (!s) return '';
    const upper = s.toUpperCase();

    // Si ya es code válido
    if (upper.length === 2 && this.states.some(x => x.code === upper)) return upper;

    // Buscar por nombre exacto
    const byName = this.states.find(x => x.name.toUpperCase() === upper);
    if (byName) return byName.code;

    // Fallback: si es de 2 letras, lo devolvemos (por si el catálogo aún no estuviera)
    if (upper.length === 2) return upper;

    return '';
  }

  formValid(): boolean {
    return !!this.name.trim();
  }

  save(): void {
    this.name = this.name.trim();
    if (!this.formValid()) {
      this.nameError = 'Location name is required.';
      return;
    }

    // Asegura state_code explícito con lo seleccionado
    this.state_code = this.state || '';

    this.saved.emit({
      name: this.name,
      id_market: null, // si ya no aplica en DB, déjalo en null o quítalo del contrato
      notes: this.notes?.trim() || '',
      active: this.active,
      state: this.state || null,                         // 2-letter code (igual que state_code)
      full_address: this.full_address?.trim() || null,   // dirección completa
      country_code: this.country_code?.trim() || 'US',
      state_code: this.state_code?.trim() || null,
      json_form: this.json_form?.trim() || null,
      previous_site_url: this.previous_site_url?.trim() || null,
    });
  }

  cancel(): void { this.closed.emit(); }
  onBackdrop(ev: MouseEvent){ if (ev.target === ev.currentTarget) this.cancel(); }
}