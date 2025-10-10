import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { ThemeModeService } from '../../../core/services/theme-mode.service';
import { DOCUMENT, NgClass, NgFor, NgIf } from '@angular/common';

import { MENU } from './menu';
import { MenuItem } from './menu.model';
import { FeatherIconDirective } from '../../../core/feather-icon/feather-icon.directive';
import { Subscription } from 'rxjs';
import { CryptoService } from '../../../core/services/crypto/crypto.service';
import { AUTH_USER_STORAGE_KEY } from '../../../core/services/drivewhip-core/drivewhip-core.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [
    NgbDropdownModule,
    FeatherIconDirective,
    RouterLink,
    RouterLinkActive,
    NgFor,
    NgIf,
    NgClass
  ],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})

export class NavbarComponent implements OnInit, OnDestroy {

  currentTheme: string;
  menuItems: MenuItem[] = []

  currentlyOpenedNavItem: HTMLElement | undefined;

  private routerSub: Subscription | undefined;

  constructor(
    private router: Router,
    private themeModeService: ThemeModeService,
    private crypto: CryptoService
  ) {}

  ngOnInit(): void {
    this.themeModeService.currentTheme.subscribe( (theme) => {
      this.currentTheme = theme;
      this.showActiveTheme(this.currentTheme);
    });

    this.menuItems = MENU;

  // Load profile info from storage
  this.loadProfileFromStorage();

    /**
     * Close the header menu after a route change on tablet and mobile devices
     */
  // Robust subscription to navigation events (avoids missing the first NavigationEnd that could happen with forEach)
    this.routerSub = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.closeMobileMenuIfOpen();
      }
    });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
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

  /**
   * Change the theme on #theme-switcher checkbox changes
   */
  onThemeCheckboxChange(e: Event) {
    const checkbox = e.target as HTMLInputElement;
    const newTheme: string = checkbox.checked ? 'dark' : 'light';
    this.themeModeService.toggleTheme(newTheme);
    this.showActiveTheme(newTheme);
  }

  /**
   * Logout
   */
  onLogout(e: Event) {
    e.preventDefault();

    localStorage.setItem('isLoggedin', 'false');
    if (localStorage.getItem('isLoggedin') === 'false') {
      this.router.navigate(['/auth/login']);
    }
  }

  /**
   * Fixed header menu on scroll
   */
  @HostListener('window:scroll', ['$event']) getScrollHeight() {    
    if (window.matchMedia('(min-width: 992px)').matches) {
      let header: HTMLElement = document.querySelector('.horizontal-menu') as HTMLElement;
      if(window.pageYOffset >= 60) {
        header.parentElement!.classList.add('fixed-on-scroll')
      } else {
        header.parentElement!.classList.remove('fixed-on-scroll')
      }
    }
  }

  /**
   * Returns true or false depending on whether the given menu item has a child
   * @param item menuItem
   */
  hasItems(item: MenuItem) {
    return item.subMenus !== undefined ? item.subMenus.length > 0 : false;
  }

  /**
   * Toggle the header menu on tablet and mobile devices
   */
  toggleHeaderMenu() {
    // document.querySelector('.horizontal-menu .bottom-navbar')!.classList.toggle('header-toggled');

    const horizontalMenuToggleButton = document.querySelector('[data-toggle="horizontal-menu-toggle"]');
    const bottomNavbar = document.querySelector('.horizontal-menu .bottom-navbar');
    if (!bottomNavbar?.classList.contains('header-toggled')) {
      bottomNavbar?.classList.add('header-toggled');
      horizontalMenuToggleButton?.classList.add('open');
      document.body.classList.add('header-open'); // Used to create a backdrop"
    } else {
      bottomNavbar?.classList.remove('header-toggled');
      horizontalMenuToggleButton?.classList.remove('open');
      document.body.classList.remove('header-open');
    }
  }

  private closeMobileMenuIfOpen() {
    const bottomNavbar = document.querySelector('.horizontal-menu .bottom-navbar');
    const toggleButton = document.querySelector('[data-toggle="horizontal-menu-toggle"]');
    bottomNavbar?.classList.remove('header-toggled');
    toggleButton?.classList.remove('open');
    document.body.classList.remove('header-open');
  }

  // If the viewport is resized to desktop and the backdrop is still present, ensure it's closed
  @HostListener('window:resize')
  onResize() {
    if (window.innerWidth >= 992) {
      this.closeMobileMenuIfOpen();
    }
  }

  // Show or hide the submenu on mobile and tablet devices when a nav-item is clicked
  toggleSubmenuOnSmallDevices(navItem: HTMLElement) {
    if (window.matchMedia('(max-width: 991px)').matches) {
      if (this.currentlyOpenedNavItem === navItem) {
        this.currentlyOpenedNavItem = undefined;
      } else {
        this.currentlyOpenedNavItem = navItem;
      }
    }
  }

  // ==========================
  // Profile (Google / Local)
  // ==========================
  profileImageUrl: string | null = null; // decrypted url
  profileEmail: string | null = null;
  profileName: string | null = null;

  private loadProfileFromStorage(): void {
    try {
      const encPic = localStorage.getItem('google_picture');
      if (encPic) {
        const pic = this.crypto.decrypt<string>(encPic);
        if (pic && typeof pic === 'string') {
          this.profileImageUrl = pic;
          console.log("Profile image URL:", this.profileImageUrl);
        }
      }
    } catch { /* ignore */ }

    try {
      const encUser = localStorage.getItem(AUTH_USER_STORAGE_KEY);
      if (encUser) {
        const user: any = this.crypto.decrypt(encUser);
        if (user) {
          console.log(user);
          this.profileEmail = user.user;
          this.profileName = `${user.firstname} ${user.lastname}`.trim();
        }
      }
    } catch { /* ignore */ }
  }

  get profileInitials(): string {
    if (this.profileName) {
      const parts = this.profileName.split(/\s+/).filter(p=>p);
      return parts.slice(0,2).map(p=>p[0]?.toUpperCase()).join('');
    }
    if (this.profileEmail) return this.profileEmail[0].toUpperCase();
    return 'U';
  }

}
