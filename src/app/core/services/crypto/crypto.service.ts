import { inject, Injectable } from '@angular/core';
import { AES, enc } from 'crypto-js';
import { AppConfigService } from '../app-config/app-config.service';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private readonly fallbackKey = 'D52CF166-EBDB-461E-8E3C-1A455F07F5DF';
  private appConfig = inject(AppConfigService);

  encrypt(value: unknown): string {
    const key = this.resolveKey();
    return AES.encrypt(JSON.stringify(value), key).toString();
  }

  decrypt<T = unknown>(cipherText: string): T | null {
    try {
      const key = this.resolveKey();
      const bytes = AES.decrypt(cipherText, key);
      const raw = bytes.toString(enc.Utf8);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn('[CryptoService] Unable to decrypt payload', err);
      return null;
    }
  }

  private resolveKey(): string {
    const configured = this.appConfig.get('driveWhipCryptoKey', this.fallbackKey);
    return configured || this.fallbackKey;
  }
}