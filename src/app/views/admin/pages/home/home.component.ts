import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';

import { HomeGridComponent } from './home-grid.component';

import { CryptoService } from '../../../../core/services/crypto/crypto.service';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';

@Component({
  selector: 'app-ride-share',
  standalone: true,
  imports: [CommonModule, NgbDropdownModule, FormsModule, HomeGridComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class LocationsComponent implements OnInit, AfterViewInit, OnDestroy {

  /** Filas para el grid hijo */
  locationsRows: any[] = [];

  /** Estado UI */
  loading = false;
  errorMsg: string | null = null;

  // (El resto de props del carrusel/maquetación si las necesitas)
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

    // (Opcional) Carga de perfil/usuario desde localStorage
    const encryptedUser = localStorage.getItem('user');
    if (encryptedUser) {
      try { this.crypto.decrypt(encryptedUser); } catch { /* noop */ }
    }
    const encryptedProfile = localStorage.getItem('dw.auth.user');
    if (encryptedProfile) {
      try { this.crypto.decrypt(encryptedProfile); } catch { /* noop */ }
    }

    this.locationsList();
  }

  ngAfterViewInit(): void {
    Promise.resolve().then(() => this.updateTransform());
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
  }

  /** Llama al SP crm_locations_list y normaliza data[0] */
  locationsList(): void {
    this.loading = true;
    this.errorMsg = null;

    const driveWhipCoreAPI: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_locations_list,
      parameters: []
    };

    this.driveWhipCore
      .executeCommand<DriveWhipCommandResponse>(driveWhipCoreAPI)
      .subscribe({
        next: (response) => {
          if (response?.ok) {
            const raw = response.data;
            const rows = Array.isArray(raw)
              ? (Array.isArray(raw[0]) ? raw[0] : raw)
              : [];
            this.locationsRows = rows ?? [];
          } else {
            this.locationsRows = [];
            //this.errorMsg = response?.error ?? 'Unknown error';
          }
          this.loading = false;
        },
        error: (err) => {
          console.error('Error occurred:', err);
          this.locationsRows = [];
          this.errorMsg = 'Request failed';
          this.loading = false;
        }
      });
  }

  /** --------- utilidades de layout opcionales --------- */
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
