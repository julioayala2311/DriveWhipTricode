import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { ThemeModeService } from '../../../core/services/theme-mode.service';
import { DOCUMENT, NgClass, NgFor, NgIf } from '@angular/common';

import { MENU } from './menu';
import { MenuItem } from './menu.model';
import { FeatherIconDirective } from '../../../core/feather-icon/feather-icon.directive';
import { Subscription } from 'rxjs';

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
    private themeModeService: ThemeModeService
  ) {}

  ngOnInit(): void {
    this.themeModeService.currentTheme.subscribe( (theme) => {
      this.currentTheme = theme;
      this.showActiveTheme(this.currentTheme);
    });

    this.menuItems = MENU;

    /**
     * Close the header menu after a route change on tablet and mobile devices
     */
    // Suscripción robusta a eventos de navegación (evita forEach que podía perder el primer NavigationEnd)
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

  // En caso de que se redimensione a escritorio y el backdrop quede montado, lo eliminamos
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

}
