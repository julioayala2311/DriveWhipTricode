import { Component, OnInit, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, map, switchMap, tap } from 'rxjs/operators';
import { of } from 'rxjs';
import { GoogleAuthService } from '../../../../../core/services/googleAccounts/google.service';
import { DriveWhipCoreService } from '../../../../../core/services/drivewhip-core/drivewhip-core.service';
import { Utilities } from '../../../../../Utilities/Utilities';
import { IDriveWhipCoreAPI, DriveWhipCommandResponse, IAuthResponseModel } from '../../../../../core/models/entities.model';
import { DriveWhipAdminCommand } from '../../../../../core/db/procedures';
import { CryptoService } from '../../../../../core/services/crypto/crypto.service';
import { HttpErrorResponse } from '@angular/common/http';

interface GoogleAuthPayload {
  email: string;
  firstName: string;
  lastName: string;
  jwt: string;
  picture?: string;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnInit, AfterViewInit {
  returnUrl: string = '/';
  coreLoginLoading = false;
  private pendingGooglePayload: GoogleAuthPayload | null = null;

  constructor(private router: Router,
              private route: ActivatedRoute,
              private googleAuthService: GoogleAuthService,
              private driveWhipCore: DriveWhipCoreService,
              private ngZone: NgZone,
              private crypto: CryptoService) {}

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';
  }

  ngAfterViewInit(): void {
    this.googleAuthService.loadGoogleScript().then(() => {
      this.googleAuthService.initializeGoogleSignIn(this.handleCredentialResponse.bind(this));
      this.googleAuthService.renderGoogleButton('googleButton');
    }).catch((error) => {
      console.error('Failed to load Google script:', error);
      Utilities.showToast('We could not load Google Sign-in. Please refresh and try again.', 'error');
    });
  }

  handleCredentialResponse(response: any): void {
    const payload = this.buildGooglePayload(response);
    if (!payload) {
      Utilities.showToast('Invalid Google response. Please try again.', 'error');
      return;
    }

    this.pendingGooglePayload = payload;
    this.startDriveWhipWorkflow(payload);
  }

  private buildGooglePayload(response: any): GoogleAuthPayload | null {
    if (!response || !response.credential) {
      console.warn('[GoogleAuth] Missing credential in response');
      return null;
    }

    const jwt = response.credential;
    let decoded: any = null;

    try {
      const [, payloadB64] = jwt.split('.');
      const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
      decoded = JSON.parse(payloadJson);
    } catch (err) {
      console.error('[GoogleAuth] Failed to decode JWT payload:', err);
    }

    const email = decoded?.email ?? '';
    const rawFullName: string = decoded?.name || '';
    const firstName = decoded?.given_name || (rawFullName ? rawFullName.split(/\s+/)[0] : '');
    const lastName = decoded?.family_name || (rawFullName ? rawFullName.split(/\s+/).slice(1).join(' ') : '');
    const picture = decoded?.picture || '';

    if(picture){
      localStorage.setItem('google_picture', this.crypto.encrypt(picture));
    }
    
    if (!email) {
      console.warn('[GoogleAuth] Missing email in Google token');
      return null;
    }

    return { email, firstName, lastName, jwt, picture };
  }

  private startDriveWhipWorkflow(googlePayload: GoogleAuthPayload): void {
    const serviceUser = googlePayload.email;
    const servicePassword = googlePayload.jwt;

    if (!serviceUser || !servicePassword) {
      Utilities.showToast('DriveWhip credentials are not configured.', 'error');
      return;
    }

    this.coreLoginLoading = true;

    this.driveWhipCore.login(serviceUser, servicePassword).pipe(
      map(response => {
        const accessToken = response?.data?.token;
        if (!accessToken) {
          throw new Error('DriveWhip login did not return a token.');
        }
        this.driveWhipCore.cacheToken(accessToken);
        return accessToken;
      }),
      switchMap(accessToken => {
        const driveWhipCoreAPI: IDriveWhipCoreAPI = {
          commandName: DriveWhipAdminCommand.auth_users_info,
          parameters: [
            googlePayload.email,
            accessToken,
            googlePayload.firstName,
            googlePayload.lastName
          ]
        };
        // 1) Get user profile
        return this.driveWhipCore.executeCommand<DriveWhipCommandResponse<IAuthResponseModel[]>>(driveWhipCoreAPI).pipe(
          switchMap(envelope => {
            if (!envelope?.ok) {
              throw new Error('DriveWhip authentication failed.');
            }

            const firstSet = (envelope.data?.[0] as IAuthResponseModel[] | undefined) ?? [];
            if (!firstSet.length) {
              throw new Error('This Google account is not linked to a DriveWhip user.');
            }

            const profile: any = firstSet[0];

            // Detect inactive user pattern from SP: object has throwMessageTricode
            if (profile && profile.throwMessageTricode) {
              // Show backend provided message and abort login flow
              Utilities.showToast(profile.throwMessageTricode, 'error');
              // Clear cached token/profile because we already stored token earlier
              this.driveWhipCore.clearCachedAuth();
              // Signal a specific error code to short‑circuit further handling
              throw new Error('INACTIVE_USER');
            }

            this.driveWhipCore.cacheUserProfile(profile);

            // 2) Fetch routes by role and persist dynamic menu
            const role: string = profile?.role ?? '';
            if (!role) {
              return of(profile);
            }
            const routesApi: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.auth_roles_routes, parameters: [ role ] };
            return this.driveWhipCore.executeCommand<DriveWhipCommandResponse<any>>(routesApi).pipe(
              map(routesRes => {
                if (routesRes?.ok) {
                  const rows = Array.isArray(routesRes.data) ? (Array.isArray(routesRes.data[0]) ? routesRes.data[0] : routesRes.data) : [];
                  try {
                    const menu = this.buildMenuFromRoutes(rows);
                    localStorage.setItem('dw.menu', this.crypto.encrypt(JSON.stringify(menu)));
                    localStorage.setItem('dw.routes', this.crypto.encrypt(JSON.stringify(rows)));
                  } catch (e) {
                    console.warn('[Login] Failed to serialize menu/routes', e);
                  }
                }
                return profile;
              })
            );
          })
        );
      }),
      finalize(() => {
        this.coreLoginLoading = false;
      })
    ).subscribe({
      next: profile => {
        if (this.pendingGooglePayload) {
          this.persistGoogleState();
          this.pendingGooglePayload = null;
        }
        Utilities.showToast(`Welcome, ${profile.firstname} ${profile.lastname}!`, 'success');
        this.redirectAfterLogin();
      },
      error: err => {
        // If we already handled inactive user with a toast, just exit silently
        if (err?.message === 'INACTIVE_USER') {
          this.pendingGooglePayload = null;
          return;
        }
        this.driveWhipCore.clearCachedAuth();
        this.pendingGooglePayload = null;

        // 1) toma el mensaje “grande” de donde venga
        const rawMsg =
          err?.raw?.error?.error ||
          err?.raw?.error?.message ||
          err?.error?.error ||
          err?.error?.message ||
          err?.message ||
          '';

        // 2) quédate solo con lo que va después de "Error:"
        const pretty =
          (String(rawMsg).match(/Error:\s*(.*)$/i)?.[1] ?? String(rawMsg)).trim();

        Utilities.showToast(pretty || 'Unhandled error.', 'error');
      }
    });
  }

  // Transform flat routes rows to MenuItem[]
  private buildMenuFromRoutes(rows: any[]): any[] {
    // Normalize rows
    const list = (rows || []).map(r => ({
      id_route: Number(r.id_route),
      parent_id: r.parent_id != null ? Number(r.parent_id) : null,
      path: String(r.path || ''),
      label: String(r.label || ''),
      icon: r.icon || null,
      is_menu: r.is_menu === 1 || r.is_menu === '1' || r.is_menu === true,
      is_active: r.is_active === 1 || r.is_active === '1' || r.is_active === true
    })).filter(r => r.is_active && r.is_menu);

    // Index by id
    const byId = new Map<number, any>();
    list.forEach(r => byId.set(r.id_route, r));
    // Build tree
    const roots: any[] = [];
    const childrenMap = new Map<number, any[]>();
    list.forEach(r => {
      if (r.parent_id) {
        if (!childrenMap.has(r.parent_id)) childrenMap.set(r.parent_id, []);
        childrenMap.get(r.parent_id)!.push(r);
      } else {
        roots.push(r);
      }
    });
    const toMenuItem = (node: any): any => {
      const sub = (childrenMap.get(node.id_route) || []).sort((a,b)=> (a.sort_order??0)-(b.sort_order??0));
      if (sub.length === 0) {
        return { label: node.label, icon: node.icon || undefined, link: node.path };
      }
      // Convert children to SubMenuItems with full path
      const subMenuItems = sub.map(child => ({ label: child.label, link: (node.path.endsWith('/') || child.path.startsWith('/')) ? (node.path + child.path) : (node.path + child.path) }));
      return { label: node.label, icon: node.icon || undefined, subMenus: [ { subMenuItems } ] };
    };
    // Sort roots by sort_order if present
    roots.sort((a,b)=> (a.sort_order??0)-(b.sort_order??0));
    return roots.map(toMenuItem);
  }

  private afterError(s: unknown): string {
    const txt = String(s ?? '');
    const i = txt.toLowerCase().indexOf('error:');
    return i >= 0 ? txt.slice(i + 'error:'.length).trim() : txt;
  }
  
  private extractApiError(err: any): string {
    // 1) Si viene HttpErrorResponse anidado en err.raw
    const httpErr: HttpErrorResponse | null =
      (err?.raw instanceof HttpErrorResponse) ? err.raw :
      (err?.raw && (err.raw as any)?.status && (err.raw as any)?.message && (err.raw as any)?.error ? err.raw as HttpErrorResponse : null);

    // 2) Intentar leer distintas rutas típicas
    const candidates: any[] = [
      // Dentro del HttpErrorResponse anidado
      httpErr?.error?.error,             // ← tu caso: string con “Failed executing stored procedure…”
      httpErr?.error?.message,
      httpErr?.error?.data?.error,

      // A veces el backend manda error como string JSON
      typeof httpErr?.error === 'string' ? httpErr.error : null,

      // Rutas alternativas por si el wrapper te lo pasó arriba
      err?.error?.error,
      err?.error?.message,
      err?.error?.data?.error,
      err?.raw?.error?.error,
      err?.raw?.error?.message,
      err?.raw?.error?.data?.error,

      // Fallbacks genéricos
      httpErr?.message,
      err?.message
    ];

    for (const c of candidates) {
      if (!c) continue;

      // Si es string JSON, intentar parsear para extraer .error
      if (typeof c === 'string') {
        const trimmed = c.trim();
        if (!trimmed) continue;

        // Si parece JSON, parsea y busca un .error adentro
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            const parsed = JSON.parse(trimmed);
            const deep = parsed?.error || parsed?.message || parsed?.data?.error;
            if (typeof deep === 'string' && deep.trim()) return deep.trim();
          } catch {
            // no es JSON válido; usa el string tal cual
            return trimmed;
          }
        }
        return trimmed;
      }

      if (typeof c === 'object') {
        const deep = c?.error || c?.message || c?.data?.error;
        if (typeof deep === 'string' && deep.trim()) return deep.trim();
      }
    }

    return 'DriveWhipCoreApi: Unhandled error.';
  }

  private persistGoogleState(): void {
    if (typeof window === 'undefined') return;
  }

  private redirectAfterLogin(): void {
    this.ngZone.run(() => this.router.navigateByUrl(this.returnUrl, { replaceUrl: true }));
  }

  logIn(){
    localStorage.setItem('dw.auth.session', 'true');
    this.router.navigateByUrl(this.returnUrl, { replaceUrl: true })
  }

}