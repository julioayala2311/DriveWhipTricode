import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';

import { HomeGridComponent } from './home-grid.component';

import { CryptoService } from '../../../../core/services/crypto/crypto.service';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';
import { LocationsRecord } from '../../../../core/models/locations.model';
import { HomeDialogComponent, LocationDialogResult } from './home-dialog.component';

@Component({
  selector: 'app-ride-share',
  standalone: true,
  imports: [CommonModule, NgbDropdownModule, FormsModule, HomeGridComponent, HomeDialogComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class LocationsComponent implements OnInit, AfterViewInit, OnDestroy {

  locationsRows: LocationsRecord[] = [];
  rowsForGrid: LocationsRecord[] = [];

  filterMode: 'all' | 'active' | 'inactive' = 'all';

  private readonly _loading = signal(false);
  private readonly _records = signal<LocationsRecord[]>([]);
  private readonly _error = signal<string | null>(null);
  private readonly _dialogOpen = signal(false);
  private readonly _dialogMode = signal<'create' | 'edit'>('create');
  private readonly _editing = signal<LocationsRecord | null>(null);
  private readonly _saving = signal(false);

  readonly loading = computed(() => this._loading());
  readonly error = computed(() => this._error());
  readonly records = computed(() => this._records());
  readonly showDialog = computed(() => this._dialogOpen());
  readonly dialogMode = computed(() => this._dialogMode());
  readonly saving = computed(() => this._saving());
  readonly editingRecord = computed(() => this._editing());

  errorMsg: string | null = null;

  @ViewChild('track') trackEl?: ElementRef<HTMLElement>;
  visibleStart = 0;
  perView = 8;
  trackTransform = 'translateX(0px)';
  trackTransitionStyle = 'transform 0.55s cubic-bezier(.16,.84,.44,1)';
  private gapPx = 16;
  private resizeHandler = () => this.updatePerView();

  constructor(
    private driveWhipCore: DriveWhipCoreService,
    private crypto: CryptoService
  ) {}

  ngOnInit(): void {
    this.updatePerView();
    window.addEventListener('resize', this.resizeHandler);

    try { const u = localStorage.getItem('user'); if (u) this.crypto.decrypt(u); } catch {}
    try { const p = localStorage.getItem('dw.auth.user'); if (p) this.crypto.decrypt(p); } catch {}

    this.locationsList();
  }

  ngAfterViewInit(): void { Promise.resolve().then(() => this.updateTransform()); }
  ngOnDestroy(): void { window.removeEventListener('resize', this.resizeHandler); }

  /** Listado principal */
  locationsList(): void {
    this._loading.set(true);
    this.errorMsg = null;

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_locations_list,
      parameters: []
    };

    this.driveWhipCore
      .executeCommand<DriveWhipCommandResponse<LocationsRecord>>(api)
      .subscribe({
        next: (response) => {
          if (response?.ok) {
            const raw = response.data as any;
            const rows = Array.isArray(raw)
              ? (Array.isArray(raw[0]) ? raw[0] : raw)
              : [];
            this.locationsRows = (rows ?? []) as LocationsRecord[];
          } else {
            this.locationsRows = [];
          }
          this.applyFilter();
          this._loading.set(false);
        },
        error: (err) => {
          console.error('[LocationsComponent] list error', err);
          this.locationsRows = [];
          this.rowsForGrid = [];
          this.errorMsg = 'Request failed';
          this._loading.set(false);
        }
      });
  }

  /** Filtrado con referencia estable */
  applyFilter(): void {
    if (!Array.isArray(this.locationsRows)) {
      this.rowsForGrid = [];
      return;
    }
    switch (this.filterMode) {
      case 'active':
        this.rowsForGrid = this.locationsRows.filter(r => Number((r as any)?.active ?? (r as any)?.is_active) === 1);
        break;
      case 'inactive':
        this.rowsForGrid = this.locationsRows.filter(r => Number((r as any)?.active ?? (r as any)?.is_active) !== 1);
        break;
      default:
        this.rowsForGrid = this.locationsRows;
        break;
    }
  }

  // ======== D I Á L O G O ========
  openCreate(): void {
    this._dialogMode.set('create');
    this._editing.set(null);
    this._dialogOpen.set(true);
  }

  openEdit(rec: LocationsRecord): void {
    this._dialogMode.set('edit');
    this._editing.set(rec);      // ⬅️ pasa el registro al dialog
    this._dialogOpen.set(true);  // ⬅️ abre
  }

  closeDialog(): void {
    if (this._saving()) return;
    this._dialogOpen.set(false);
  }

  handleDialogSave(result: LocationDialogResult): void {
    if (this._saving()) return;
    const mode = this._dialogMode();
    const action: 'C' | 'U' = mode === 'create' ? 'C' : 'U';
    this._saving.set(true);

    const idLoc = mode === 'edit' ? (this._editing()?.id_location ?? null) : null;

    this.mutate(action, {
      id_location: idLoc ?? undefined,
      //id_market: result.id_market ?? undefined,
      location_name: result.name,   // mapea a p_name
      notes: result.notes,          // mapea a p_notes
      is_active: result.active ? 1 : 0,
      country_code: result.country_code?? undefined, // mapea a p_notes,
      state_code: result.state?? undefined, // mapea a p_notes,
      full_address: result.full_address?? undefined, // mapea a p_notes,
      json_form: result.json_form?? undefined, // mapea a p_notes
    });
  }

  delete(rec: LocationsRecord): void {
  // if (!window.confirm(`Disable location "${(rec as any).location_name ?? (rec as any).name}"?`)) return;
    this.mutate('D', { id_location: (rec as any).id_location });

    //Activate or not 
    //this.onChangeActive((rec as any).id_location);
  }

  // private onChangeActive(id_location: string): void {
  //     this._loading.set(true);
  
  //     const api: IDriveWhipCoreAPI = {
  //       commandName: DriveWhipAdminCommand.crm_locations_active,
        
  //       parameters: [id_location]
  //     };
  
  //   this.driveWhipCore.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
  //     next: res => {

  //       if (!res.ok) {
  //         return;
  //       }
  //       this.locationsList();
  //     },
  //     error: err => {
  //       console.error('[HomeComponent] error', err);
  //     }
  //   });
  // }


  /** CRUD → ajusta el orden si tu SP difiere
   *  Ejemplo firma SP: (p_action, p_id_location, p_id_market, p_name, p_notes, p_is_active)
   */
  private mutate(action: 'C'|'U'|'D', rec: Partial<LocationsRecord> & {
    location_name?: string; name?: string; notes?: string; is_active?: number;
  }) {
    this._loading.set(true);

    const nameForSp = (rec as any).location_name ?? (rec as any).name ?? null;

    let profile: { user: any } | null = null;

    const encryptedProfile = localStorage.getItem('dw.auth.user');
    if (encryptedProfile) {
      profile = this.crypto.decrypt(encryptedProfile) as { user: any };
      //console.log(profile.user);
    }

    const params: any[] = [
      action,
      (rec as any).id_location ?? null,
      // (rec as any).id_market ?? null,
      nameForSp,
      (rec as any).notes ?? null,
      action === 'D' ? null : ((rec as any).is_active ?? 1),
      profile!.user,
      null,
      (rec as any).country_code ?? null, //county
      (rec as any).state_code ?? null, //state
      (rec as any).full_address ?? null, //full
      null
    ];

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_locations_crud,
      parameters: params
    };

    this.driveWhipCore
      .executeCommand<DriveWhipCommandResponse<LocationsRecord>>(api)
      .subscribe({
        next: (res) => {
          if (!res.ok) {
            console.error('[LocationsComponent] mutate error', res.error);
            this._saving.set(false);
            this._loading.set(false);
            return;
          }
          this._saving.set(false);
          this.closeDialog();
          this.locationsList();
        },
        error: (err) => {
          console.error('[LocationsComponent] mutate error', err);
          this._saving.set(false);
          this._loading.set(false);
        }
      });
  }

  /** ---- Layout utils ---- */
  private updatePerView() {
    const w = window.innerWidth;
    if (w < 576) this.perView = 2;
    else if (w < 768) this.perView = 3;
    else if (w < 992) this.perView = 4;
    else if (w < 1200) this.perView = 5;
    else if (w < 1400) this.perView = 6;
    else this.perView = 8;
    this.updateTransform();
  }
  private updateTransform() {
    const track = this.trackEl?.nativeElement;
    if (!track) return;
    const firstCard = track.querySelector('.status-card') as HTMLElement | null;
    if (!firstCard) return;
    const cardWidth = firstCard.getBoundingClientRect().width;
    const offset = (cardWidth + this.gapPx) * this.visibleStart * -1;
    this.trackTransform = `translateX(${offset}px)`;
  }
}
