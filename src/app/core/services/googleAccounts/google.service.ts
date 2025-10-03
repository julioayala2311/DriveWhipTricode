import { Injectable } from '@angular/core';
import { AppConfigService } from '../app-config/app-config.service';

// Declare global object provided by Google Identity Services script
declare const google: any;

/**
 * GoogleAuthService
 * Lightweight wrapper around Google Identity Services (GIS) for button rendering
 * and credential (ID token) handling. This keeps integration code centralized
 * and allows future expansion (real backend verification, refresh logic, etc.).
 */
@Injectable({ providedIn: 'root' })
export class GoogleAuthService {

  constructor(private appConfig: AppConfigService) {}

  private get clientId(): string {
    const id = this.appConfig.googleClientId;
    if (!id) {
      console.warn('[GoogleAuthService] No Google Client ID resolved for env', this.appConfig.googleEnv);
    }
    return id;
  }

  /**
   * Ensures the Google Identity Services script is loaded once.
   */
  loadGoogleScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof google !== 'undefined' && google?.accounts?.id) {
        // Script already present
        resolve();
        return;
      }

      // Avoid adding duplicate script tags
      if (document.querySelector('script[data-google-identity]')) {
        // Wait a tick to allow it to finish loading
        setTimeout(() => resolve(), 50);
        return;
      }

  const script = document.createElement('script');
  // Force English locale explicitly
  script.src = 'https://accounts.google.com/gsi/client?hl=en';
      script.async = true;
      script.defer = true;
      script.setAttribute('data-google-identity', 'true');
      script.onload = () => resolve();
      script.onerror = (error) => reject(error);
      document.head.appendChild(script);
    });
  }

  /**
   * (Mock) token verification. In production send the credential (JWT) to your backend
   * and verify its signature & audience with Google public keys.
   */
  verifyToken(token: string): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        const decoded = JSON.parse(atob(token.split('.')[1]));
        resolve(decoded);
      } catch (error) {
        reject('Invalid token format');
      }
    });
  }

  /**
   * Initializes the Google Accounts Id library. Must be called after script load.
   * @param callback - function invoked with response containing credential.
   */
  initializeGoogleSignIn(callback: (response: any) => void): void {
    if (typeof google === 'undefined' || !google?.accounts?.id) {
      console.error('[GoogleAuthService] Google library not available when initializing.');
      return;
    }

    const clientId = this.clientId;
    if (!clientId) {
      console.error('[GoogleAuthService] Aborting initialize: missing client id. Check app-config.json google section.');
      return;
    }

    google.accounts.id.initialize({
      client_id: clientId,
      callback,
      auto_select: false,              // Do not auto sign-in silently
      cancel_on_tap_outside: false,    // Prevent closing One Tap on outside click
      prompt_parent_id: 'googleButton',// Ensure it anchors correctly (if One Tap is used)
      prompt: 'select_account',        // Force account chooser
      error_callback: (error: any) => {
        console.error('[GoogleAuthService] Google Sign-In error:', error);
      }
    });
  }

  /**
   * Renders the Google Sign-In button inside the specified element.
   * @param elementId - ID of the container element for the button.
   */
  renderGoogleButton(elementId: string = 'googleButton'): void {
    if (typeof google === 'undefined' || !google?.accounts?.id) {
      console.error('[GoogleAuthService] Cannot render button: Google library not initialized.');
      return;
    }

    const el = document.getElementById(elementId);
    if (!el) {
      console.warn(`[GoogleAuthService] Element with id "${elementId}" not found.`);
      return;
    }

    google.accounts.id.renderButton(el, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      logo_alignment: 'center',
      locale: 'en'
    });
  }
}