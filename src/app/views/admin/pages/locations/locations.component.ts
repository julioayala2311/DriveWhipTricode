import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import Swal from 'sweetalert2';
import { ApplicantsGridComponent } from './applicants-grid.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { CryptoService } from '../../../../core/services/crypto/crypto.service';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    NgbDropdownModule,
    FormsModule,
    ApplicantsGridComponent
  ],
  templateUrl: './locations.component.html',
  styleUrl: './locations.component.scss'
})
export class LocationsComponent implements OnInit, AfterViewInit, OnDestroy {
  // Stages (carousel data) loaded from crm_stages_list
  stages: {
    id_stage: number;
    id_workflow: number;
    name: string;
    sort_order: number;
    id_stage_type: number;
    type: string;
    applicants_count: number;
  }[] = [];

  @ViewChild('track') trackEl?: ElementRef<HTMLElement>;
  
  idLocation!: string | null;
  visibleStart = 0;
  perView = 8; // target for desktop
  showGrid = false;
  selectedCardId: number | null = null;
  trackTransform = 'translateX(0px)';
  trackTransitionStyle = 'transform 0.55s cubic-bezier(.16,.84,.44,1)';
  private animating = false;
  endIndex = 0;
  private gapPx = 16; // 1rem default gap; update if SCSS changes
  private resizeHandler = () => this.updatePerView();

  // Locations dropdown (crm_locations_dropdown)
  locations: { id: number; name: string }[] = [];
  selectedLocationId: number | null = null;
  loadingLocations = false;
  locationsError: string | null = null;

  get totalStages() { return this.stages.length; }
  get visibleCards() { return this.stages.slice(this.visibleStart, this.visibleStart + this.perView); }
  get selectedStageApplicantsCount(): number | null {
    if (!this.selectedCardId) return null;
    const st = this.stages.find(s => s.id_stage === this.selectedCardId);
    return st ? st.applicants_count : null;
  }

  constructor(private driveWhipCore: DriveWhipCoreService, private crypto: CryptoService, private route: ActivatedRoute) {}

  onCardClick(stage: any) {
    this.selectedCardId = stage.id_stage ?? stage.id;
    this.showGrid = true;
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
      // Optionally decrypt & migrate to a unified profile key
      // const legacyProfile = this.crypto.decrypt(legacyEncryptedUser);
      console.debug('[Locations] Legacy user key found, prefer dw.auth.user');
    }

    const token = this.driveWhipCore.getCachedToken();
    const encryptedProfile = localStorage.getItem('dw.auth.user');
    if (encryptedProfile) {
      const profile = this.crypto.decrypt(encryptedProfile);
    }

    this.route.queryParamMap.subscribe(q => {
      this.idLocation = q.get('id_location');     
    });

    this.loadLocations();
  }

  ngAfterViewInit(): void {
    Promise.resolve().then(() => this.updateTransform());
  }

  private loadLocations(): void {
    this.loadingLocations = true;
    this.locationsError = null;

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
          this.locationsError = String(res.error || 'Failed to load locations');
          return;
        }

        
        let raw: any = [];
        if (Array.isArray(res.data)) {
          const top = res.data as any[];
          raw = (top.length > 0 && Array.isArray(top[0])) ? top[0] : top;
        }
        const list = Array.isArray(raw) ? raw : [];

        // Mapea EXCLUSIVAMENTE id_location -> id (number) y name -> name
        const mapped: { id: number; name: string }[] = [];
        for (const r of list) {
          const idRaw = r?.id_location ?? r?.ID_LOCATION ?? r?.id; // fallback suave
          const name  = (r?.name ?? r?.NAME ?? '').toString().trim();
          if (idRaw === undefined || idRaw === null || !name) continue;

          const idNum = typeof idRaw === 'number' ? idRaw : Number(String(idRaw));
          if (!Number.isFinite(idNum)) continue;

          mapped.push({ id: idNum, name });
        }

        this.locations = mapped;

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

          // Dependent load
          this.loadStagesForWorkflow();
        }
      },
      error: err => {
        console.error('[Locations] loadLocations error', err);
        this.locations = [];
        this.locationsError = 'Failed to load locations';
      },
      complete: () => this.loadingLocations = false
    });
}

onLocationChange(): void {
    this.visibleStart = 0;
    this.loadStagesForWorkflow();
  }

  private loadStagesForWorkflow(): void {
  // Abort only if null or undefined; allow 0 as a valid id
    if (this.selectedLocationId === null || this.selectedLocationId === undefined) {
      this.stages = [];
      return;
    }
  // Ensure number (should already be number if using [ngValue])
    const workflowId = this.toNumberStrict(this.selectedLocationId);
    if (workflowId === null || Number.isNaN(workflowId)) {
  console.warn('[HomeComponent] Invalid workflowId', this.selectedLocationId);
      this.stages = [];
      return;
    }
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_stages_list,
      parameters: [ workflowId ]
    };
  
    this.driveWhipCore.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: res => {

        if (!res.ok) {
          this.stages = [];
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

        //Hide Grid
        this.showGrid = false;
      },
      error: err => {
        console.error('[HomeComponent] loadStagesForWorkflow error', err);
        this.stages = [];
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