import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { ThemeModeService } from '../../../core/services/theme-mode.service';
import { NgClass, NgIf } from '@angular/common';

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

    // Prefer dynamic menu from storage (dw.menu) but filter by dw.routes is_assigned; fallback to static MENU
    try {
      const storedMenu = localStorage.getItem('dw.menu');
      const storedRoutes = localStorage.getItem('dw.routes');
      let assigned: Set<string> | null = null;
      // Maps for ordering by sort_order from dw.routes
      let topOrder: Map<string, number> | null = null; // parent_id NULL -> path -> sort_order
      let orderByFullPath: Map<string, number> | null = null; // fullPath (parent+child) -> sort_order
      if (storedRoutes) {
        try {
          const rows = JSON.parse(storedRoutes);
          if (Array.isArray(rows)) {
            const all = rows.map((r: any) => ({
              path: String(r.path || ''),
              parent_id: r.parent_id != null ? Number(r.parent_id) : null,
              id_route: Number(r.id_route),
              is_active: (r.is_active === 1 || r.is_active === '1' || r.is_active === true),
              is_assigned: (r.is_assigned === 0 || r.is_assigned === '0' || r.is_assigned === false) ? false : true,
              sort_order: Number(r.sort_order ?? 0)
            }));
            const byId = new Map<number, any>();
            all.forEach(r => byId.set(r.id_route, r));
            const activeAssigned = all.filter(r => r.is_active && r.is_assigned);
            const paths = new Set<string>();
            // Build fullPath map for all rows (active or not) to compute order reliably
            const fullPathById = new Map<number, string>();
            for (const r of all) {
              if (!r.parent_id) {
                fullPathById.set(r.id_route, r.path);
              } else {
                const parent = byId.get(r.parent_id);
                const full = parent ? ((parent.path.endsWith('/') || r.path.startsWith('/')) ? (parent.path + r.path) : (parent.path + r.path)) : r.path;
                fullPathById.set(r.id_route, full);
              }
            }
            // Assigned paths set for filtering menu visibility
            for (const r of activeAssigned) {
              const full = fullPathById.get(r.id_route) || r.path;
              paths.add(full);
            }
            assigned = paths;
            // Build order maps
            topOrder = new Map<string, number>();
            for (const r of activeAssigned) {
              if (!r.parent_id) {
                topOrder.set(r.path, r.sort_order || 0);
              }
            }
            orderByFullPath = new Map<string, number>();
            for (const r of activeAssigned) {
              const full = fullPathById.get(r.id_route) || r.path;
              orderByFullPath.set(full, r.sort_order || 0);
            }
          }
        } catch { /* ignore */ }
      }
      if (storedMenu) {
        const parsed = JSON.parse(storedMenu);
        if (Array.isArray(parsed)) {
          const menu = parsed as MenuItem[];
          const filtered = assigned ? this.filterMenuByAssigned(menu, assigned) : menu;
          this.menuItems = (topOrder && orderByFullPath) ? this.sortMenuByRoutes(filtered, topOrder, orderByFullPath) : filtered;
        } else {
          this.menuItems = MENU;
        }
      } else {
        this.menuItems = MENU;
      }
    } catch {
      this.menuItems = MENU;
    }

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
    // Clear session and related cached items
    try {
      localStorage.removeItem('dw.auth.session');
      localStorage.removeItem('dw.menu');
      localStorage.removeItem('dw.routes');
      localStorage.removeItem('dw.auth.user');
      localStorage.removeItem('google_picture');
    } catch { /* ignore */ }
    this.router.navigate(['/auth/login']);
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
        }
      }
    } catch { /* ignore */ }

    try {
      const encUser = localStorage.getItem(AUTH_USER_STORAGE_KEY);
      if (encUser) {
        const user: any = this.crypto.decrypt(encUser);
        if (user) {
          this.profileEmail = user.user;
          this.profileName = `${user.firstname} ${user.lastname}`.trim();
        }
      }
    } catch { /* ignore */ }
  }

  // Hide menu items and submenu links that aren't assigned in dw.routes
  private filterMenuByAssigned(menu: MenuItem[], assignedPaths: Set<string>): MenuItem[] {
    const clone = (obj: any) => JSON.parse(JSON.stringify(obj));
    const menuCopy = clone(menu) as MenuItem[];
    const filterItem = (item: MenuItem): MenuItem | null => {
      // If item has direct link
      if ((item as any).link) {
        const link = (item as any).link as string;
        if (!assignedPaths.has(link)) {
          return null;
        }
      }
      // If item has subMenus/subMenuItems
      if (item.subMenus && item.subMenus.length) {
        const newSubMenus = item.subMenus.map(group => {
          const newItems = (group.subMenuItems || []).filter(si => assignedPaths.has(si.link || ''));
          return { ...group, subMenuItems: newItems };
        }).filter(group => (group.subMenuItems || []).length > 0);
        const withSubs = { ...item, subMenus: newSubMenus };
        // If no direct link and no submenus remain, drop it
        if (!(withSubs as any).link && newSubMenus.length === 0) return null;
        return withSubs;
      }
      return item;
    };
    const filtered = menuCopy.map(filterItem).filter(Boolean) as MenuItem[];
    return filtered;
  }

  // Sort menu and submenu items by sort_order from dw.routes
  private sortMenuByRoutes(menu: MenuItem[], topOrder: Map<string, number>, orderByFullPath: Map<string, number>): MenuItem[] {
    const clone = (obj: any) => JSON.parse(JSON.stringify(obj));
    const copy = clone(menu) as MenuItem[];
    const getTopOrder = (item: MenuItem): number => {
      const link = (item as any).link as string | undefined;
      if (link && topOrder.has(link)) return topOrder.get(link)!;
      // If no direct link, derive order from the first submenu item order (min across groups)
      if (item.subMenus && item.subMenus.length) {
        let minOrder = Number.MAX_SAFE_INTEGER;
        for (const group of item.subMenus) {
          for (const si of (group.subMenuItems || [])) {
            const ord = orderByFullPath.get(si.link || '') ?? Number.MAX_SAFE_INTEGER;
            if (ord < minOrder) minOrder = ord;
          }
        }
        return minOrder === Number.MAX_SAFE_INTEGER ? 999999 : minOrder;
      }
      return 999999;
    };
    const sortSubMenus = (item: MenuItem) => {
      if (item.subMenus && item.subMenus.length) {
        item.subMenus = item.subMenus.map(group => {
          const items = (group.subMenuItems || []).slice().sort((a, b) => {
            const oa = orderByFullPath.get(a.link || '') ?? 999999;
            const ob = orderByFullPath.get(b.link || '') ?? 999999;
            if (oa !== ob) return oa - ob;
            return (a.label || '').localeCompare(b.label || '');
          });
          return { ...group, subMenuItems: items };
        });
      }
    };
    // Sort top-level
    copy.sort((a, b) => {
      const oa = getTopOrder(a);
      const ob = getTopOrder(b);
      if (oa !== ob) return oa - ob;
      const la = (a as any).label || '';
      const lb = (b as any).label || '';
      return la.localeCompare(lb);
    });
    // Sort children for each item
    copy.forEach(sortSubMenus);
    return copy;
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
