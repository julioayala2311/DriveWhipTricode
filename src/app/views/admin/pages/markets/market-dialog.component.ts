import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

export interface MarketForm {
  id_market?: number | null;
  name: string;
  notes?: string | null;
  is_active: number; // 1 | 0
  street_address?: string | null;
  city?: string | null;
  state_region?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

@Component({
  standalone: true,
  selector: 'app-market-dialog',
  imports: [CommonModule, FormsModule],
  template: `
  <div class="modal-header">
    <h5 class="modal-title">{{ title || (form.id_market ? 'Edit Market' : 'Add Market') }}</h5>
    <button type="button" class="btn-close" aria-label="Close" (click)="activeModal.dismiss('dismiss')"></button>
  </div>

  <form #f="ngForm" (ngSubmit)="onSubmit(f)" novalidate>
    <div class="modal-body">
      <div class="row g-3">
        <div class="col-md-8">
          <label class="form-label">Name <span class="text-danger">*</span></label>
          <input class="form-control" name="name" [(ngModel)]="form.name" required maxlength="100" />
        </div>

<div class="col-md-4 d-flex align-items-end">
  <div class="form-check form-switch">
    <input
      class="form-check-input"
      type="checkbox"
      id="activeSwitch"
      [ngModel]="form.is_active === 1"
      (ngModelChange)="form.is_active = $event ? 1 : 0"
    />
    <label class="form-check-label ms-2" for="activeSwitch">
      {{ form.is_active === 1 ? 'Active' : 'Inactive' }}
    </label>
  </div>
</div>


        <div class="col-12">
          <label class="form-label">Notes</label>
          <textarea class="form-control" name="notes" rows="2" [(ngModel)]="form.notes" maxlength="500"></textarea>
        </div>

        <div class="col-12"><hr class="my-2"></div>
        <div class="col-12"><h6 class="mb-0">Address</h6></div>

        <div class="col-12">
          <label class="form-label">Street Address</label>
          <input class="form-control" name="street_address" [(ngModel)]="form.street_address" maxlength="255"/>
        </div>

        <div class="col-md-4">
          <label class="form-label">City</label>
          <input class="form-control" name="city" [(ngModel)]="form.city" maxlength="100"/>
        </div>
        <div class="col-md-4">
          <label class="form-label">State/Region</label>
          <input class="form-control" name="state_region" [(ngModel)]="form.state_region" maxlength="100"/>
        </div>
        <div class="col-md-4">
          <label class="form-label">Postal Code</label>
          <input class="form-control" name="postal_code" [(ngModel)]="form.postal_code" maxlength="20"/>
        </div>

        <div class="col-md-4">
          <label class="form-label">Country (ISO-2)</label>
          <input class="form-control" name="country_code" [(ngModel)]="form.country_code" maxlength="2"/>
        </div>
        <div class="col-md-4">
          <label class="form-label">Latitude</label>
          <input type="number" step="0.000001" class="form-control" name="latitude" [(ngModel)]="form.latitude"/>
        </div>
        <div class="col-md-4">
          <label class="form-label">Longitude</label>
          <input type="number" step="0.000001" class="form-control" name="longitude" [(ngModel)]="form.longitude"/>
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn btn-outline-secondary" (click)="activeModal.dismiss('cancel')">Cancel</button>
      <button type="submit" class="btn btn-primary" [disabled]="f.invalid">
        {{ form.id_market ? 'Save changes' : 'Create' }}
      </button>
    </div>
  </form>
  `
})
export class MarketDialogComponent {
  @Input() title?: string;
  @Input() initialValue?: Partial<MarketForm>;

  form: MarketForm = {
    id_market: null,
    name: '',
    notes: '',
    is_active: 1,
    street_address: '',
    city: '',
    state_region: '',
    postal_code: '',
    country_code: '',
    latitude: null,
    longitude: null
  };

  constructor(public activeModal: NgbActiveModal) {}

  ngOnInit(): void {
    if (this.initialValue) {
      this.form = {
        ...this.form,
        ...this.initialValue,
        is_active: Number(this.initialValue.is_active ?? 1) === 1 ? 1 : 0
      };
    }
  }

  onSubmit(f: NgForm) {
    if (f.invalid) return;
    this.activeModal.close(this.form);
  }
}
