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

  constructor(private driveWhipCore: DriveWhipCoreService, private crypto: CryptoService) {}

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

    const encryptedUser = localStorage.getItem('user');
    if (encryptedUser) {
      const googleUser = this.crypto.decrypt(encryptedUser);
    } else {
      console.log('No Google user in storage.');
    }

    const token = this.driveWhipCore.getCachedToken();
    const encryptedProfile = localStorage.getItem('dw.auth.user');
    if (encryptedProfile) {
      const profile = this.crypto.decrypt(encryptedProfile);
    }

    this.userList();
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
      parameters: [] 
    };
    this.driveWhipCore.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        if (!res.ok) {
          console.log(res);
          this.locations = [];
          this.locationsError = String(res.error || 'Failed to load locations');
          return;
        }
        let raw: any = [];
        if (Array.isArray(res.data)) {
          const top = res.data as any[];
          if (top.length > 0 && Array.isArray(top[0])) raw = top[0]; else raw = top;
        }
        const list = Array.isArray(raw) ? raw : [];
        // map flexible: try common field names; evitamos usar el idx para no introducir ids 0 falsos
        const mapped: { id: number; name: string }[] = [];
        list.forEach((r: any) => {
          const candidate = r.id ?? r.ID ?? r.id_workflow ?? r.workflow_id ?? r.value ?? r.val;
            const nameVal = (r.name ?? r.NAME ?? r.label ?? r.text ?? '').toString().trim();
          if (!nameVal) return;
          const num = this.toNumberStrict(candidate);
          if (num === null) {
            return;
          }
          mapped.push({ id: num, name: nameVal });
        });
        this.locations = mapped;
        if (this.locations.length === 0 && list.length > 0) {
          this.locations = list.map((r:any, idx:number) => ({ id: idx + 1, name: (r.name ?? r.NAME ?? r.label ?? r.text ?? ('Location '+(idx+1))).toString().trim() }))
            .filter(l => l.name);
        }
        if (this.locations.length > 0) {
          this.selectedLocationId = this.locations[0].id; // first always selected
          this.loadStagesForWorkflow();
        }
      },
      error: err => {
        console.error('[HomeComponent] loadLocations error', err);
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
    console.log('Loading stages for workflow', this.selectedLocationId);
    // Solo abortar si es null o undefined, permitir 0 como id válido
    if (this.selectedLocationId === null || this.selectedLocationId === undefined) {
      this.stages = [];
      return;
    }
    // Asegurar número (ya debería ser number si usamos [ngValue])
    const workflowId = this.toNumberStrict(this.selectedLocationId);
    if (workflowId === null || Number.isNaN(workflowId)) {
      console.warn('[HomeComponent] workflowId inválido', this.selectedLocationId);
      this.stages = [];
      return;
    }
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_stages_list,
      parameters: [ workflowId ]
    };
    console.log('[HomeComponent] Ejecutando crm_stages_list', api);
    this.driveWhipCore.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: res => {

        if (!res.ok) {
          this.stages = [];
          return;
        }
        console.log(res);
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
      this.perView = 6;
    } else {
      this.perView = 8; // target for desktop
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

  userList(){
    const driveWhipCoreAPI: IDriveWhipCoreAPI = {
    commandName: DriveWhipAdminCommand.auth_users_list,
    parameters: [
        'hmartinez@gmail.com'
      ]
    };

    this.driveWhipCore.executeCommand<DriveWhipCommandResponse>(driveWhipCoreAPI).subscribe(
      (response) => {
        if (response?.ok) {
          console.log(response.data); // Successful response data
        } else {
          console.error(response?.error); // Error information
        }
      },
      (error) => {
        console.error('Error occurred:', error);
      }
    );
  }

}