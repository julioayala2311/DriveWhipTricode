import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import Swal from 'sweetalert2';
import { ApplicantsGridComponent } from './applicants-grid.component';
import { CommonModule } from '@angular/common';
import { NgbDropdownModule, NgbDropdown } from '@ng-bootstrap/ng-bootstrap';
import { CryptoService } from '../../../../core/services/crypto/crypto.service';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';
import { ActivatedRoute } from '@angular/router';
import { RouterModule } from '@angular/router';

interface LocationOption {
  id: number;
  name: string;
  groupLabel: string;
  locationLine?: string;
  applicants?: number | null;
  applicantsLabel?: string;
  isActive?: boolean;
}

interface LocationGroup {
  label: string;
  items: LocationOption[];
}

interface StageItem {
  id_stage: number;
  id_workflow: number;
  name: string;
  sort_order: number;
  id_stage_type: number;
  type: string;
  applicants_count: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    NgbDropdownModule,
    ApplicantsGridComponent
  ],
  templateUrl: './locations.component.html',
  styleUrl: './locations.component.scss'
})
export class LocationsComponent implements OnInit, AfterViewInit, OnDestroy {
  // Stages (carousel data) loaded from crm_stages_list
  stages: StageItem[] = [];
  selectedStageDetails: StageItem | null = null;

  @ViewChild('track') trackEl?: ElementRef<HTMLElement>;
  
  idLocation!: string | null;
  visibleStart = 0;
  perView = 8; // Target for desktop
  showGrid = false;
  selectedCardId: number | null = null;
  trackTransform = 'translateX(0px)';
  trackTransitionStyle = 'transform 0.55s cubic-bezier(.16,.84,.44,1)';
  private animating = false;
  endIndex = 0;
  private gapPx = 16; // 1rem default gap; update if SCSS changes
  private resizeHandler = () => this.updatePerView();

  // Locations dropdown (crm_locations_dropdown)
  locations: LocationOption[] = [];
  locationGroups: LocationGroup[] = [];
  selectedLocationId: number | null = null;
  loadingLocations = false;
  locationsError: string | null = null;
  readonly locationResultsCap = 100;
  locationsLimited = false;
  selectedLocationOption: LocationOption | null = null;
  stagesRequested = false;
  stagesLoading = false;
  private readonly numberFormatter = new Intl.NumberFormat('en-US');

  get totalStages() { return this.stages.length; }
  get visibleCards() { return this.stages.slice(this.visibleStart, this.visibleStart + this.perView); }
  get selectedStageApplicantsCount(): number | null {
    if (!this.selectedCardId) return null;
    const st = this.stages.find(s => s.id_stage === this.selectedCardId);
    return st ? st.applicants_count : null;
  }

  constructor(private driveWhipCore: DriveWhipCoreService, private crypto: CryptoService, private route: ActivatedRoute) {}

  onCardClick(stage: StageItem) {
    this.selectedCardId = stage.id_stage;
    this.showGrid = true;
    this.selectedStageDetails = stage;
  }

  onPostToJobBoards(): void {
    const iframeMarkup = '<iframe width="1000" height="700" frameborder="0" src="https://app.smartsheet.com/b/publish?EQBCT=f01b75e6050a45409a03f85cf81ac4c7"></iframe>';
    void Swal.fire({
      title: 'Published Sheet',
      html: iframeMarkup,
      width: '72rem',
      padding: '1.5rem',
      confirmButtonText: 'Close',
      showCloseButton: true,
      focusConfirm: false
    });
  }

  next() {
    if (this.animating) return;
    if (this.visibleStart + this.perView < this.stages.length) {
      this.slideTo(this.visibleStart + this.perView);
    }
  }

  private toNumberStrict(v: any): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isNaN(v) ? null : v;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') return null;
      const n = Number(t);
      return Number.isNaN(n) ? null : n;
    }
    return null;
  }

  prev() {
    if (this.animating) return;
    if (this.visibleStart - this.perView >= 0) {
      this.slideTo(this.visibleStart - this.perView);
    }
  }

  canPrev() {
    return this.visibleStart > 0;
  }

  canNext() {
  return this.visibleStart + this.perView < this.stages.length;
  }

  ngOnInit(): void {
    this.updatePerView();
    window.addEventListener('resize', this.resizeHandler);

    // Removed unused googleUser decryption (was dead code). If needed for migration, handle here.
    const legacyEncryptedUser = localStorage.getItem('user');
    if (legacyEncryptedUser && !localStorage.getItem('dw.auth.user')) {
      // Optionally decrypt and migrate to a unified profile key
      // const legacyProfile = this.crypto.decrypt(legacyEncryptedUser);
      console.debug('[Locations] Legacy user key found, prefer dw.auth.user');
    }

    const token = this.driveWhipCore.getCachedToken();
    const encryptedProfile = localStorage.getItem('dw.auth.user');
    if (encryptedProfile) {
      const profile = this.crypto.decrypt(encryptedProfile);
    }

  // Read previous selection from localStorage (encrypted)
    let restoredLocationId: string | null = null;
    try {
      const encryptedLoc = localStorage.getItem('dw.selectedLocationId');
      if (encryptedLoc) {
        const decrypted = this.crypto.decrypt(encryptedLoc);
        if (typeof decrypted === 'string' && decrypted.trim() !== '') {
          restoredLocationId = decrypted.trim();
        }
      }
    } catch (e) {
      console.warn('Error decrypting location id', e);
    }

    this.route.queryParamMap.subscribe(q => {
      this.idLocation = q.get('id_location');
  // If restored, use as preference if there is no query param
      if (restoredLocationId && (!this.idLocation || this.idLocation.trim() === '')) {
        this.idLocation = restoredLocationId;
      }
    });

    this.loadLocations();
  }

  ngAfterViewInit(): void {
    Promise.resolve().then(() => this.updateTransform());
  }

  private loadLocations(): void {
    this.loadingLocations = true;
    this.locationsError = null;
    this.locationsLimited = false;

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_locations_dropdown,
  // If your stored procedure supports filtering by id, uncomment below:
  // parameters: (this.idLocation && this.idLocation.trim() !== '') ? [Number(this.idLocation)] : []
      parameters: []
    };

    this.driveWhipCore.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        if (!res.ok) {
          this.locations = [];
          this.locationGroups = [];
          this.selectedLocationOption = null;
          this.locationsError = String(res.error || 'Failed to load locations');
          return;
        }

        
        let raw: any = [];
        if (Array.isArray(res.data)) {
          const top = res.data as any[];
          raw = (top.length > 0 && Array.isArray(top[0])) ? top[0] : top;
        }
        const list = Array.isArray(raw) ? raw : [];
        this.locationsLimited = list.length >= this.locationResultsCap;

        const mapped: LocationOption[] = [];
        for (const r of list) {
          const idRaw = r?.id_location ?? r?.ID_LOCATION ?? r?.id ?? r?.ID ?? r?.value ?? r?.val;
          const nameRaw = r?.name ?? r?.NAME ?? r?.label ?? r?.LABEL ?? '';
          const name = this.parseString(nameRaw);
          if (idRaw === undefined || idRaw === null || !name) continue;

          const idNum = typeof idRaw === 'number' ? idRaw : Number(String(idRaw));
          if (!Number.isFinite(idNum)) continue;

          const city = this.parseString(r?.city ?? r?.CITY ?? r?.city_name ?? r?.CITY_NAME);
          const state = this.parseString(r?.state ?? r?.STATE ?? r?.state_code ?? r?.STATE_CODE);
          const country = this.parseString(r?.country ?? r?.COUNTRY ?? r?.country_name ?? r?.COUNTRY_NAME);
          const locationParts = [city, state, country].filter(Boolean) as string[];
          const locationLine = locationParts.length > 0 ? locationParts.join(', ') : undefined;

          const groupSource = this.parseString(
            r?.market ?? r?.MARKET ??
            r?.region ?? r?.REGION ??
            r?.division ?? r?.DIVISION ??
            r?.group ?? r?.GROUP ??
            r?.territory ?? r?.TERRITORY ??
            city
          );
          const groupLabel = groupSource || 'Other locations';

          const applicantsRaw = this.toNumberStrict(
            r?.applicants_count ?? r?.APPLICANTS_COUNT ??
            r?.applicants ?? r?.APPLICANTS ??
            r?.total_applicants ?? r?.TOTAL_APPLICANTS ??
            r?.candidate_count ?? r?.CANDIDATE_COUNT
          );
          const applicantsLabel = this.formatApplicants(applicantsRaw);

          const isActive = this.normalizeBoolean(r?.is_active ?? r?.IS_ACTIVE ?? r?.active ?? r?.ACTIVE ?? true);

          mapped.push({
            id: idNum,
            name,
            groupLabel,
            locationLine,
            applicants: applicantsRaw ?? undefined,
            applicantsLabel: applicantsLabel ?? undefined,
            isActive
          });
        }

        this.locations = mapped;
        this.buildLocationGroups();

        if (this.locations.length === 0) {
          this.selectedLocationId = null;
          this.selectedLocationOption = null;
          return;
        }

        if (this.locations.length > 0) {
    // Preselection based on query param ?id_location=...
          let preselect: number | null = null;
          if (this.idLocation != null && this.idLocation.trim() !== '') {
            const qNum = Number(this.idLocation);
            if (Number.isFinite(qNum) && this.locations.some(x => x.id === qNum)) {
              preselect = qNum;
            }
          }

          this.selectedLocationId = preselect ?? this.locations[0].id;
          this.syncSelectedLocationOption();

    // Dependent load
          this.loadStagesForWorkflow();
        }
      },
      error: err => {
        console.error('[Locations] loadLocations error', err);
        this.locations = [];
        this.locationGroups = [];
        this.selectedLocationOption = null;
        this.locationsError = 'Failed to load locations';
      },
      complete: () => this.loadingLocations = false
    });
}

  onLocationChange(): void {
    this.visibleStart = 0;
    this.selectedCardId = null;
    this.selectedStageDetails = null;
    this.showGrid = false;
    this.loadStagesForWorkflow();
  }

  private loadStagesForWorkflow(): void {
    this.stagesLoading = true;
    this.stagesRequested = false;
  // Abort only if null or undefined; allow 0 as a valid id
    if (this.selectedLocationId === null || this.selectedLocationId === undefined) {
      this.stages = [];
      this.stagesLoading = false;
      return;
    }
  // Ensure number (should already be number if using [ngValue])
    const workflowId = this.toNumberStrict(this.selectedLocationId);
    if (workflowId === null || Number.isNaN(workflowId)) {
      console.warn('[HomeComponent] Invalid workflowId', this.selectedLocationId);
      this.stages = [];
      this.stagesLoading = false;
      return;
    }
    this.stagesRequested = true;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_stages_list,
      parameters: [ workflowId ]
    };
  
    this.driveWhipCore.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: res => {

        if (!res.ok) {
          this.stages = [];
          this.stagesLoading = false;
          return;
        }
        let raw: any = [];
        if (Array.isArray(res.data)) {
          const top = res.data as any[];
          if (top.length > 0 && Array.isArray(top[0])) raw = top[0]; else raw = top;
        }
        const list = Array.isArray(raw) ? raw : [];
  // Ensure ordering by sort_order
        this.stages = list.map((r: any) => ({
          id_stage: r.id_stage,
          id_workflow: r.id_workflow,
          name: r.name,
          sort_order: r.sort_order,
          id_stage_type: r.id_stage_type,
          type: r.type,
          applicants_count: r.applicants_count
        })).filter(s => s && s.name).sort((a,b)=> (a.sort_order ?? 0) - (b.sort_order ?? 0));
// Reset transform metrics
        this.visibleStart = 0;
        this.updateTransform();
        if (this.selectedCardId) {
          this.selectedStageDetails = this.stages.find(s => s.id_stage === this.selectedCardId) ?? null;
        } else {
          this.selectedStageDetails = null;
        }

// Hide grid
        this.showGrid = false;
        this.stagesLoading = false;
      },
      error: err => {
        console.error('[HomeComponent] loadStagesForWorkflow error', err);
        this.stages = [];
        this.stagesLoading = false;
      },
      complete: () => {
        this.stagesLoading = false;
      }
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
  }

  private updatePerView() {
    const w = window.innerWidth;
  // Keep these breakpoints in sync with rideShare.component.scss

    if (w < 576) {
      this.perView = 2;
    } else if (w < 768) {
      this.perView = 3;
    } else if (w < 992) {
      this.perView = 4;
    } else if (w < 1200) {
      this.perView = 5;
    } else if (w < 1400) {
      this.perView = 5;
    } else {
      this.perView = 7; // target for desktop
    }

    if (this.visibleStart + this.perView > this.stages.length) {
      this.visibleStart = Math.max(0, this.stages.length - this.perView);
    }

    this.updateTransform();
  }

  trackCard = (_: number, item: any) => item.id_stage ?? item.id;

  trackLocationGroup = (_: number, group: LocationGroup) => group.label;
  trackLocationOption = (_: number, option: LocationOption) => option.id;

  private slideTo(startIndex: number) {
    const distanceItems = Math.abs(startIndex - this.visibleStart);
    const base = 0.45;
    const factor = Math.min(1.4, Math.sqrt(distanceItems));
    const duration = (base * factor).toFixed(3);
    this.trackTransitionStyle = `transform ${duration}s cubic-bezier(.16,.84,.44,1)`;

    this.animating = true;
    this.visibleStart = startIndex;
    this.updateTransform();
    const timeout = parseFloat(duration) * 1000 + 30;
    setTimeout(() => {
      this.animating = false;
    }, timeout);
  }

  chooseLocation(option: LocationOption, dropdown: NgbDropdown): void {
    if (this.selectedLocationId === option.id) {
      dropdown.close();
      return;
    }
    this.selectedLocationId = option.id;
    this.syncSelectedLocationOption();
    // Guardar en localStorage encriptado
    try {
      const encrypted = this.crypto.encrypt(String(option.id));
      localStorage.setItem('dw.selectedLocationId', encrypted);
    } catch (e) {
      console.warn('Error encrypting location id', e);
    }
    dropdown.close();
    this.onLocationChange();
  }

  private buildLocationGroups(): void {
    const groups = new Map<string, LocationOption[]>();
    for (const option of this.locations) {
      const key = option.groupLabel || 'Other locations';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(option);
    }
    this.locationGroups = Array.from(groups.entries()).map(([label, items]) => ({
      label,
      items: items.sort((a, b) => a.name.localeCompare(b.name))
    }));
  }

  private syncSelectedLocationOption(): void {
    if (this.selectedLocationId === null) {
      this.selectedLocationOption = null;
      return;
    }
    this.selectedLocationOption = this.locations.find(loc => loc.id === this.selectedLocationId) ?? null;
  }

  private parseString(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str ? str : undefined;
  }

  private formatApplicants(value: number | null | undefined): string | undefined {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return undefined;
    }
    const formatted = this.numberFormatter.format(value);
    return `${formatted} applicant${value === 1 ? '' : 's'}`;
  }

  private normalizeBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      return ['true', '1', 'yes', 'y', 'active'].includes(lower);
    }
    return Boolean(value);
  }

  private updateTransform() {
    const track = this.trackEl?.nativeElement;
    if (!track) {
      return;
    }
    const firstCard = track.querySelector('.status-card') as HTMLElement | null;
    if (!firstCard) {
      return;
    }
    const cardWidth = firstCard.getBoundingClientRect().width;
    const offset = (cardWidth + this.gapPx) * this.visibleStart * -1;
    this.trackTransform = `translateX(${offset}px)`;
    this.endIndex = Math.min(this.visibleStart + this.perView, this.stages.length);
  }

  // Map: id_stage_type -> Feather icon
  private readonly stageIconMap: Record<number, string> = {
    1: 'icon-file-text', // Data collection / forms
  2: 'icon-sliders',   // Rules / filters / connections
  // add more if needed...
  };

  stageIcon(type?: number | string | null): string {
    if (type === null || type === undefined) return 'icon-layers';
    const t = (typeof type === 'string') ? Number(type) : type;
    if (!Number.isFinite(t)) return 'icon-layers';
    return this.stageIconMap[t as number] ?? 'icon-layers';
  }

}
