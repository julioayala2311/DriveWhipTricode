import { Component, OnInit, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, map, switchMap, tap } from 'rxjs/operators';
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

        return this.driveWhipCore.executeCommand<DriveWhipCommandResponse<IAuthResponseModel[]>>(driveWhipCoreAPI).pipe(
          map(envelope => {
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
            return profile;
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