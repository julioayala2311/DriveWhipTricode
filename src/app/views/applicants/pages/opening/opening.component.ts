import { Component, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { NarikCustomValidatorsModule } from '@narik/custom-validators';
import { ThemeModeService } from '../../../../core/services/theme-mode.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-opening',
  standalone: true,
  imports: [
    CommonModule,
    NgbDropdownModule,
    FormsModule,
    NarikCustomValidatorsModule
  ],
  templateUrl: './opening.component.html',
  styleUrl: './opening.component.scss'
})
export class OpeningComponent implements OnInit, AfterViewInit {
  @ViewChild('firstNameInput') firstNameInput!: ElementRef<HTMLInputElement>;
  cards = Array.from({ length: 20 }).map((_, i) => {
    const statuses = ['Approved','Rejected','Employee'];
    const subStatuses = ['Custom','Approved','Rejected'];
    return {
      id: i + 1,
      status: statuses[i % statuses.length],
      sub: subStatuses[(i + 1) % subStatuses.length],
      people: Math.floor(Math.random()*120 + 10)
    }
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

  get visibleCards() { return this.cards.slice(this.visibleStart, this.visibleStart + this.perView); }

  onCardClick(card: any) {
    this.selectedCardId = card.id;
    this.showGrid = true;
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
  canPrev() { return this.visibleStart > 0; }
  canNext() { return (this.visibleStart + this.perView) < this.cards.length; }

  constructor(private themeModeService: ThemeModeService, private router: Router) {

    
  }

  ngOnInit(): void {
    this.updatePerView();
    window.addEventListener('resize', this.updatePerView.bind(this));

    const newTheme: string =  'light';
    this.themeModeService.toggleTheme(newTheme);
    this.showActiveTheme(newTheme);
  }  

    showActiveTheme(theme: string) {
    const themeSwitcher = document.querySelector('#theme-switcher') as HTMLInputElement;
    const box = document.querySelector('.box') as HTMLElement;

    if (!themeSwitcher) {
      return;
    }

    // Toggle the custom checkbox based on the theme
    if (theme === 'dark') {
      themeSwitcher.checked = true;
      box.classList.remove('light');
      box.classList.add('dark');
    } else if (theme === 'light') {
      themeSwitcher.checked = false;
      box.classList.remove('dark');
      box.classList.add('light');
    }
  }

  ngAfterViewInit(): void { this.updateTransform(); }

  private updatePerView() {
    const w = window.innerWidth;
  
    if (w < 576) this.perView = 3;        // xs 
    else if (w < 768) this.perView = 3;   // sm
    else if (w < 992) this.perView = 4;   // md
    else if (w < 1400) this.perView = 6;
    else this.perView = 8; // target for desktop

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
    setTimeout(() => { this.animating = false; }, timeout);
  }

  private updateTransform() {
    // We use widths defined in CSS media queries; to approximate we measure first card width
    const track = this.trackEl?.nativeElement;
    if (!track) { return; }
    const firstCard = track.querySelector('.status-card') as HTMLElement | null;
    if (!firstCard) { return; }
    const cardWidth = firstCard.getBoundingClientRect().width;
    const offset = (cardWidth + this.gapPx) * this.visibleStart * -1;
    this.trackTransform = `translateX(${offset}px)`;
    this.endIndex = Math.min(this.visibleStart + this.perView, this.cards.length);
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  focusFirstName(): void {
    this.firstNameInput.nativeElement.focus();
  }

  goToCatalog() {
    this.router.navigate(['/openings/catalog']);
  }

  onClickTestLink() {
    
  }
}
