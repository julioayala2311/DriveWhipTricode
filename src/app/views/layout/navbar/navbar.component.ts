import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
  // If a top-level menu labeled 'Create' exists, we lift it to the top bar
  topCreate: MenuItem | null = null;

  currentlyOpenedNavItem: HTMLElement | undefined;

  private routerSub: Subscription | undefined;
  private specialPaths: Set<string> = new Set<string>();
  private routePropsByFull: Map<string, { sort_order: number; action?: string | null; code?: string | null }> = new Map();

  constructor(
    private router: Router,
    private themeModeService: ThemeModeService,
    private crypto: CryptoService,
    private sanitizer: DomSanitizer
  ) {}

  private normalizePath(p: string | null | undefined): string {
    if (!p) return '';
    let s = String(p).trim();
    // collapse multiple slashes
    s = s.replace(/\/+/g, '/');
    // ensure starts with '/'
    if (!s.startsWith('/')) s = '/' + s;
    // remove trailing slash except root
    if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  }

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
  let routePropsByFull: Map<string, { sort_order: number; action?: string | null; code?: string | null }>|null = null;
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
              sort_order: Number(r.sort_order ?? 0),
              action: typeof r.action === 'string' ? r.action : (r.action == null ? null : String(r.action)),
              code: typeof r.code === 'string' ? r.code : (r.code == null ? null : String(r.code))
            }));
            const byId = new Map<number, any>();
            all.forEach(r => byId.set(r.id_route, r));
            const activeAssigned = all.filter(r => r.is_active && r.is_assigned);
            const paths = new Set<string>();
            // Build fullPath map for all rows (active or not) to compute order reliably
            const fullPathById = new Map<number, string>();
            for (const r of all) {
              if (!r.parent_id) {
                fullPathById.set(r.id_route, this.normalizePath(r.path));
              } else {
                const parent = byId.get(r.parent_id);
                const full = parent
                  ? ((parent.path.endsWith('/') || r.path.startsWith('/'))
                      ? (parent.path + r.path)
                      : (parent.path + '/' + r.path))
                  : r.path;
                fullPathById.set(r.id_route, this.normalizePath(full));
              }
            }
            // Assigned paths set for filtering menu visibility
            for (const r of activeAssigned) {
              const full = fullPathById.get(r.id_route) || this.normalizePath(r.path);
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
            routePropsByFull = new Map<string, { sort_order: number; action?: string|null; code?: string|null }>();
            for (const r of activeAssigned) {
              const full = fullPathById.get(r.id_route) || this.normalizePath(r.path);
              orderByFullPath.set(full, r.sort_order || 0);
              routePropsByFull.set(full, { sort_order: r.sort_order || 0, action: r.action, code: r.code });
              if (r.action && String(r.action).trim().length > 0) this.specialPaths.add(full);
            }
          }
        } catch { /* ignore */ }
      }
      if (storedMenu) {
        const parsed = JSON.parse(storedMenu);
        if (Array.isArray(parsed)) {
          let menu = parsed as MenuItem[];
          // Enrich menu items with action, code, and sort_order from dw.routes if available
          if (routePropsByFull) {
            const enrich = (items: any[]) => {
              for (const it of items) {
                // top-level items
                const itLink = this.normalizePath(it.link as any);
                if (itLink && routePropsByFull.has(itLink)) {
                  const p = routePropsByFull.get(itLink)!;
                  if (p.action) it.action = p.action;
                  if (p.code) it.code = p.code;
                  if (typeof p.sort_order === 'number') it.sort_order = p.sort_order;
                }
                if (Array.isArray(it.subMenus)) {
                  for (const group of it.subMenus) {
                    if (Array.isArray(group.subMenuItems)) {
                      for (const si of group.subMenuItems) {
                        const link = this.normalizePath((si && typeof si.link === 'string') ? si.link : '');
                        if (link && routePropsByFull.has(link)) {
                          const p = routePropsByFull.get(link)!;
                          if (p.action) si.action = p.action;
                          if (p.code) si.code = p.code;
                          if (typeof p.sort_order === 'number') si.sort_order = p.sort_order;
                        }
                      }
                    }
                  }
                }
              }
            };
            try { enrich(menu as any[]); } catch { /* ignore */ }
            // Persist the props map for runtime lookups in onSpecialMenu
            try { this.routePropsByFull = routePropsByFull; } catch { /* ignore */ }
          }
          const filtered = assigned ? this.filterMenuByAssigned(menu, assigned) : menu;
          this.menuItems = (topOrder && orderByFullPath) ? this.sortMenuByRoutes(filtered, topOrder, orderByFullPath) : filtered;
          // Promote a top-level 'Create' entry (if present) to the top navbar and hide it from bottom menu
          this.extractTopCreate();
        } else {
          this.menuItems = MENU;
          this.extractTopCreate();
        }
      } else {
        this.menuItems = MENU;
        this.extractTopCreate();
      }
    } catch {
      this.menuItems = MENU;
      this.extractTopCreate();
    }

    this.ensureMessengerMenuEntry();

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

  // Find a top-level item labeled 'Create' and move it to topCreate, removing it from bottom menu
  private extractTopCreate(): void {
    try {
      if (!Array.isArray(this.menuItems)) return;
      const idx = this.menuItems.findIndex(mi => (mi?.label || '').trim().toLowerCase() === 'create');
      if (idx >= 0) {
        this.topCreate = this.menuItems[idx];
        this.menuItems = [
          ...this.menuItems.slice(0, idx),
          ...this.menuItems.slice(idx + 1)
        ];
      }
    } catch { /* ignore */ }
  }

  // Helper to treat an item as special even if menu enrichment missed it
  isSpecialLink(link?: string | null): boolean {
    if (!link) return false;
    return this.specialPaths.has(this.normalizePath(link));
  }

  // Root click guard to ensure special items never trigger router navigation
  onRootMenuClick(ev: Event) {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    // If click originated inside an element marked as special (data-menu-action), stop it
    const specialEl = target.closest('[data-menu-action]');
    if (specialEl) {
      try { ev.preventDefault(); ev.stopPropagation(); } catch { /* ignore */ }
      return;
    }
  }

  private ensureMessengerMenuEntry(): void {
    try {
      const normalizedTarget = this.normalizePath('/messenger');
      const hasMessenger = this.menuItems.some((item) => {
        const direct = this.normalizePath(item.link);
        if (direct === normalizedTarget) return true;
        if (Array.isArray(item.subMenus)) {
          for (const group of item.subMenus) {
            if (!group?.subMenuItems) continue;
            for (const sub of group.subMenuItems) {
              if (this.normalizePath(sub.link) === normalizedTarget) {
                return true;
              }
            }
          }
        }
        return false;
      });

      if (!hasMessenger) {
        this.menuItems = [
          ...this.menuItems,
          {
            label: 'Messenger',
            icon: 'message-square',
            link: '/messenger'
          }
        ];
      }
    } catch (err) {
      console.warn('[Navbar] Unable to ensure messenger menu entry', err);
    }
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
    const isSpecial = (o: any) => !!o && typeof o === 'object' && typeof o.action === 'string' && o.action.trim().length > 0;
    const filterItem = (item: MenuItem): MenuItem | null => {
      // If item has subMenus/subMenuItems
      if (item.subMenus && item.subMenus.length) {
        const newSubMenus = item.subMenus.map(group => {
          const newItems = (group.subMenuItems || []).filter((si: any) => {
            // Keep if link is assigned OR it's a special action item (popup/new_tab)
            if (isSpecial(si)) return true;
            return assignedPaths.has(si.link || '');
          });
          return { ...group, subMenuItems: newItems };
        }).filter(group => (group.subMenuItems || []).length > 0);
        const withSubs = { ...item, subMenus: newSubMenus };
        // If no submenus remain AND the item's own link isn't assigned, drop it
        if (newSubMenus.length === 0) {
          const link = (withSubs as any).link as string | undefined;
          if (!link || !assignedPaths.has(link)) return null;
        }
        return withSubs;
      }
      // No submenus: enforce assigned link if present
      if ((item as any).link) {
        const link = (item as any).link as string;
        if (!assignedPaths.has(link)) return null;
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
    const toNum = (v: any): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };
    const childOrder = (si: any): number => {
      const so = toNum(si?.sort_order);
      if (!Number.isNaN(so)) return so;
      const byLink = orderByFullPath.get((si?.link as string) || '')
      return typeof byLink === 'number' ? byLink : 999999;
    };
    const parentOrderFromChildLink = (link: string | undefined): number => {
      if (!link) return 999999;
      // Extract first path segment: '/segment'
      const m = String(link).match(/^\/[^/]+/);
      const parentPath = m ? m[0] : '';
      if (parentPath && topOrder.has(parentPath)) return topOrder.get(parentPath)!;
      return 999999;
    };
    const getTopOrder = (item: MenuItem): number => {
      const link = (item as any).link as string | undefined;
      if (link && topOrder.has(link)) return topOrder.get(link)!;
      // If no direct link, derive order from the parent path of its children (min across groups)
      if (item.subMenus && item.subMenus.length) {
        let minOrder = Number.MAX_SAFE_INTEGER;
        for (const group of item.subMenus) {
          for (const si of (group.subMenuItems || [])) {
            // Prefer parent order based on the first segment of the child's link
            const ord = parentOrderFromChildLink((si as any)?.link) ?? childOrder(si);
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
            const ao: any = a as any;
            const bo: any = b as any;
            const oa = childOrder(ao);
            const ob = childOrder(bo);
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

// ==========================
// Special menu: popup/new_tab
// ==========================
export interface SpecialMenuItemLike {
  label?: string;
  link?: string | null;
  code?: string | null; // may contain an <iframe ...>
  action?: 'popup' | 'new_tab' | string | null;
}

// Extend NavbarComponent with special menu handling
export interface IframeModalState {
  visible: boolean;
  title: string | null;
  safeHtml: SafeHtml | null;
}

declare module './navbar.component' {}

// Add fields and methods to the class via declaration merging pattern
// (The TS compiler will merge these into NavbarComponent at emit time.)
export interface NavbarComponent {
  iframeModalVisible: boolean;
  iframeModalTitle: string | null;
  iframeModalHtml: SafeHtml | null;
  iframeModalFullscreen: boolean;
  onSpecialMenu(item: SpecialMenuItemLike, ev?: Event): void;
  closeIframeModal(): void;
  toggleIframeModalFullscreen(ev?: Event): void;
}

NavbarComponent.prototype.onSpecialMenu = function(this: NavbarComponent, item: SpecialMenuItemLike, ev?: Event) {
  // Prevent any default link behavior or parent click handlers from routing
  try { ev?.preventDefault(); ev?.stopPropagation(); } catch { /* ignore */ }
  const action = (item.action || '').toString().toLowerCase();
  // For special actions, DO NOT use router link/path as a source. Prefer explicit code or url fields.
  let src = (item.code || (item as any).url || '').toString().trim();
  if (!src) {
    // Fallback: fetch code from routePropsByFull using the item's link
    try {
      const link = this['normalizePath']?.(((item as any).link || '') as string) || '';
      if (link && this['routePropsByFull'] && this['routePropsByFull'].has(link)) {
        const p = this['routePropsByFull'].get(link)!;
        if (p?.code) src = String(p.code);
      }
    } catch { /* ignore */ }
  }
  if (action === 'new_tab') {
    const url = extractUrlFromCode(src);
    if (url) window.open(url, '_blank');
    return;
  }
  // default to popup
  const html = buildIframeHtml(src);
  this.iframeModalTitle = item.label || 'Preview';
  this.iframeModalHtml = this['sanitizer']?.bypassSecurityTrustHtml(html) as SafeHtml;
  this.iframeModalFullscreen = false;
  this.iframeModalVisible = true;
};

NavbarComponent.prototype.closeIframeModal = function(this: NavbarComponent) {
  this.iframeModalVisible = false;
  this.iframeModalTitle = null;
  this.iframeModalHtml = null;
  this.iframeModalFullscreen = false;
};

// Initialize fields on component instances
Object.defineProperties(NavbarComponent.prototype, {
  iframeModalVisible: { value: false, writable: true, configurable: true },
  iframeModalTitle: { value: null, writable: true, configurable: true },
  iframeModalHtml: { value: null, writable: true, configurable: true },
  iframeModalFullscreen: { value: false, writable: true, configurable: true }
});

NavbarComponent.prototype.toggleIframeModalFullscreen = function(this: NavbarComponent, ev?: Event) {
  try { ev?.preventDefault(); ev?.stopPropagation(); } catch { /* ignore */ }
  this.iframeModalFullscreen = !this.iframeModalFullscreen;
};

function extractUrlFromCode(codeOrUrl: string): string | null {
  if (!codeOrUrl) return null;
  // If looks like full URL
  if (/^https?:\/\//i.test(codeOrUrl)) return codeOrUrl;
  // Try to parse from iframe
  const m = codeOrUrl.match(/src\s*=\s*"([^"]+)"/i) || codeOrUrl.match(/src\s*=\s*'([^']+)'/i);
  return m ? m[1] : null;
}

function buildIframeHtml(codeOrUrl: string): string {
  if (!codeOrUrl) return '';
  if (/^\s*<\/?iframe/i.test(codeOrUrl)) {
    // Already iframe code; ensure responsive wrapper styles are applied via container
    return codeOrUrl;
  }
  const url = extractUrlFromCode(codeOrUrl) || codeOrUrl;
  // Default size; container scrolls
  return `<iframe src="${url}" frameborder="0" allowfullscreen style="display:block;width:100%;height:100%;"></iframe>`;
}

