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
  selector: 'app-ride-share',
  standalone: true,
  imports: [
    CommonModule,
    NgbDropdownModule,
    FormsModule,
    ApplicantsGridComponent
  ],
  templateUrl: './rideShare.component.html',
  styleUrl: './rideShare.component.scss'
})
export class RideShareComponent implements OnInit, AfterViewInit, OnDestroy {
  cards = Array.from({ length: 20 }).map((_, i) => {
    const statuses = ['Approved', 'Rejected', 'Employee'];
    const subStatuses = ['Custom', 'Approved', 'Rejected'];
    return {
      id: i + 1,
      status: statuses[i % statuses.length],
      sub: subStatuses[(i + 1) % subStatuses.length],
      people: Math.floor(Math.random() * 120 + 10)
    };
  });

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

  get visibleCards() {
    return this.cards.slice(this.visibleStart, this.visibleStart + this.perView);
  }

  constructor(private driveWhipCore: DriveWhipCoreService, private crypto: CryptoService) {}

  onCardClick(card: any) {
    this.selectedCardId = card.id;
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
    if (this.visibleStart + this.perView < this.cards.length) {
      this.slideTo(this.visibleStart + this.perView);
    }
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
    return this.visibleStart + this.perView < this.cards.length;
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
  }

  ngAfterViewInit(): void {
    Promise.resolve().then(() => this.updateTransform());
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

    if (this.visibleStart + this.perView > this.cards.length) {
      this.visibleStart = Math.max(0, this.cards.length - this.perView);
    }

    this.updateTransform();
  }

  trackCard = (_: number, item: any) => item.id;

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
    this.endIndex = Math.min(this.visibleStart + this.perView, this.cards.length);
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