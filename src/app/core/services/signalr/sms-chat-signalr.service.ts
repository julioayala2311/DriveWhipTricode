import { Injectable, inject } from "@angular/core";
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from "@microsoft/signalr";
import { Observable, Subject } from "rxjs";
import { AppConfigService } from "../app-config/app-config.service";
import { DriveWhipCoreService } from "../drivewhip-core/drivewhip-core.service";

export interface ApplicantChatRealtimeMessage {
  applicantId: string;
  body: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  status?: string;
  messageSid?: string;
  smsSid?: string;
  chatId?: number;
  sentAtUtc?: string;
  createdAtUtc?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
}

@Injectable({ providedIn: "root" })
export class SmsChatSignalRService {
  private readonly appConfig = inject(AppConfigService);
  private readonly core = inject(DriveWhipCoreService);

  private hubConnection: HubConnection | null = null;
  private connectionPromise: Promise<void> | null = null;
  private readonly messagesSubject =
    new Subject<ApplicantChatRealtimeMessage>();
  private readonly joinedApplicants = new Set<string>();
  private readonly joinedPhonePairs = new Set<string>();
  // Lightweight debug toggle: enable by setting sessionStorage.smsChatDebug = '1'
  private debugEnabled(): boolean {
    try {
      const ss = (globalThis as any)?.sessionStorage;
      if (ss && ss.getItem('smsChatDebug') === '1') return true;
      const gg = (globalThis as any)?.SMS_CHAT_DEBUG;
      return gg === '1' || gg === true;
    } catch {
      return false;
    }
  }
  private debug(...args: any[]): void {
    if (this.debugEnabled()) {
      try { console.debug('[SmsChatSR]', ...args); } catch {}
    }
  }

  messages(): Observable<ApplicantChatRealtimeMessage> {
    return this.messagesSubject.asObservable();
  }

  async joinApplicant(applicantId: string | null | undefined): Promise<void> {
    const normalized = this.normalizeApplicantId(applicantId);
    if (!normalized) {
      return;
    }

    await this.ensureConnection();
    if (!this.hubConnection || this.joinedApplicants.has(normalized)) {
      this.joinedApplicants.add(normalized);
      return;
    }

    this.debug('JoinApplicant ->', normalized);
    await this.hubConnection.invoke("JoinApplicant", normalized);
    this.joinedApplicants.add(normalized);
  }

  async leaveApplicant(applicantId: string | null | undefined): Promise<void> {
    const normalized = this.normalizeApplicantId(applicantId);
    if (
      !normalized ||
      !this.hubConnection ||
      !this.joinedApplicants.has(normalized)
    ) {
      return;
    }

    try {
      this.debug('LeaveApplicant ->', normalized);
      await this.hubConnection.invoke("LeaveApplicant", normalized);
    } finally {
      this.joinedApplicants.delete(normalized);
      if (!this.joinedApplicants.size && !this.joinedPhonePairs.size) {
        await this.disconnectIfIdle();
      }
    }
  }

  async disconnectIfIdle(): Promise<void> {
    if (
      this.hubConnection &&
      this.hubConnection.state !== HubConnectionState.Disconnected &&
      !this.joinedApplicants.size &&
      !this.joinedPhonePairs.size
    ) {
      try {
        await this.hubConnection.stop();
      } finally {
        this.hubConnection = null;
        this.connectionPromise = null;
      }
    }
  }

  private async ensureConnection(): Promise<void> {
    if (
      this.hubConnection &&
      this.hubConnection.state === HubConnectionState.Connected
    ) {
      return;
    }
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    const hubUrl = this.resolveHubUrl();
    this.debug('Building connection', hubUrl);
    const connection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => this.core.getCachedToken() ?? "",
        withCredentials: false,
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(LogLevel.Error)
      .build();

    connection.on("ReceiveMessage", (payload: unknown) =>
      this.handleIncoming(payload)
    );
    connection.onreconnecting((err) => {
      this.debug('Reconnecting...', err);
    });
    connection.onclose(() => {
      this.debug('Connection closed');
      this.connectionPromise = null;
      this.hubConnection = null;
    });
    connection.onreconnected(() => {
      this.debug('Reconnected; rejoining groups...');
      const ids = Array.from(this.joinedApplicants);
      ids.forEach((id) => {
        this.debug('Rejoin applicant', id);
        this.hubConnection?.invoke("JoinApplicant", id).catch(() => {});
      });
      const pairs = Array.from(this.joinedPhonePairs);
      pairs.forEach((key) => {
        const [a, b] = key.split("|");
        if (a && b) {
          this.debug('Rejoin phonePair', key);
          this.hubConnection?.invoke("JoinPhonePair", a, b).catch(() => {});
        }
      });
    });

    this.hubConnection = connection;
    // Expose a minimal debug handle in window when debug is enabled
    try {
      if (this.debugEnabled()) {
        (globalThis as any).smsChatSR = this;
      }
    } catch {}
    const startPromise = connection.start().catch((err: unknown) => {
      this.debug('Start failed', err);
      this.connectionPromise = null;
      this.hubConnection = null;
      throw err;
    });
    this.connectionPromise = startPromise;

    return startPromise;
  }

  private resolveHubUrl(): string {
    const base = this.appConfig.apiBaseUrl;
    const trimmed = base.endsWith("/") ? base : `${base}/`;
    return `${trimmed}hubs/sms-chat`;
  }

  private handleIncoming(payload: unknown): void {
    console.log("Incoming payload:", payload);
    const normalized = this.normalizePayload(payload);
    if (!normalized) {
      return;
    }
    // Compute local phone-pair key and compare with server metadata for diagnostics
    const [na, nb] = this.normalizePhonePair(normalized.from, normalized.to);
    const localPairKey = na && nb ? `${na}|${nb}` : null;
    const localPairGroup = localPairKey ? `smspair:${localPairKey}` : null;
    const meta = (payload as any)?.metadata || (payload as any)?.Metadata || {};
    const metaPairGroup = meta.phonePairGroup || meta.PhonePairGroup || meta.phonepairgroup || null;
    const metaApplicantGroup = meta.applicantGroup || meta.ApplicantGroup || meta.applicantgroup || null;
    const subscribed = localPairKey ? this.joinedPhonePairs.has(localPairKey) : false;

    this.debug('ReceiveMessage <-', {
      applicantId: normalized.applicantId,
      from: normalized.from,
      to: normalized.to,
      dir: normalized.direction,
      sid: normalized.messageSid || normalized.smsSid,
      meta: { phonePairGroup: metaPairGroup, applicantGroup: metaApplicantGroup },
      localPairGroup,
      subscribedToPair: subscribed,
    });
    this.messagesSubject.next(normalized);
  }

  private normalizeApplicantId(
    applicantId: string | null | undefined
  ): string | null {
    const value = (applicantId ?? "").toString().trim();
    return value ? value.toLowerCase() : null;
  }

  private normalizePayload(payload: any): ApplicantChatRealtimeMessage | null {
    if (!payload) {
      return null;
    }
    const applicantId = this.normalizeApplicantId(
      payload.applicantId ?? payload.ApplicantId
    );
    const directionRaw = (payload.direction ?? payload.Direction ?? "")
      .toString()
      .toLowerCase();
    const direction = directionRaw === "outbound" ? "outbound" : "inbound";

    return {
      applicantId: applicantId ?? "",
      body: (payload.body ?? payload.Body ?? "").toString(),
      direction,
      from: (payload.from ?? payload.From ?? "").toString(),
      to: (payload.to ?? payload.To ?? "").toString(),
      status: (payload.status ?? payload.Status ?? undefined)?.toString(),
      messageSid:
        (payload.messageSid ?? payload.MessageSid ?? "").toString() ||
        undefined,
      smsSid: (payload.smsSid ?? payload.SmsSid ?? "").toString() || undefined,
      chatId: this.toNumber(payload.chatId ?? payload.ChatId),
      sentAtUtc: this.toIsoString(
        payload.sentAtUtc ??
          payload.SentAtUtc ??
          payload.sentAt ??
          payload.SentAt
      ),
      createdAtUtc: this.toIsoString(
        payload.createdAtUtc ??
          payload.CreatedAtUtc ??
          payload.createdAt ??
          payload.CreatedAt
      ),
      channel:
        (payload.channel ?? payload.Channel ?? "SMS").toString() || "SMS",
      metadata: payload.metadata ?? payload.Metadata,
    };
  }

  private toNumber(value: unknown): number | undefined {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }

  private toIsoString(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }
    const date = value instanceof Date ? value : new Date(value as any);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  // --- Phone-pair subscriptions (fallback when applicantId is unknown) ---
  async joinPhonePair(phoneA: string | null | undefined, phoneB: string | null | undefined): Promise<void> {
    const [a, b] = this.normalizePhonePair(phoneA, phoneB);
    if (!a || !b) return;
    await this.ensureConnection();
    const key = `${a}|${b}`;
    if (this.joinedPhonePairs.has(key)) return;
    this.debug('JoinPhonePair ->', key);
    await this.hubConnection!.invoke("JoinPhonePair", a, b);
    this.joinedPhonePairs.add(key);
  }

  async leavePhonePair(phoneA: string | null | undefined, phoneB: string | null | undefined): Promise<void> {
    const [a, b] = this.normalizePhonePair(phoneA, phoneB);
    if (!a || !b || !this.hubConnection) return;
    const key = `${a}|${b}`;
    try {
      this.debug('LeavePhonePair ->', key);
      await this.hubConnection.invoke("LeavePhonePair", a, b);
    } finally {
      this.joinedPhonePairs.delete(key);
      if (!this.joinedApplicants.size && !this.joinedPhonePairs.size) {
        await this.disconnectIfIdle();
      }
    }
  }

  private normalizePhone(input: string | null | undefined): string | null {
    const raw = (input ?? "").trim();
    if (!raw) return null;
    // Strict E.164-like normalization: '+' + digits only; collapse extra '+'
    const digits = raw
      .split("")
      .filter((ch) => /\d/.test(ch))
      .join("");
    return digits ? `+${digits}` : null;
  }

  private normalizePhonePair(a?: string | null, b?: string | null): [string | null, string | null] {
    const na = this.normalizePhone(a);
    const nb = this.normalizePhone(b);
    if (!na || !nb) return [null, null];
    return na <= nb ? [na, nb] : [nb, na];
  }

  // --- Public helpers for components to reason about current subscriptions ---
  isSubscribedToPhonePair(phoneA: string | null | undefined, phoneB: string | null | undefined): boolean {
    const [a, b] = this.normalizePhonePair(phoneA, phoneB);
    if (!a || !b) return false;
    return this.joinedPhonePairs.has(`${a}|${b}`);
  }

  getJoinedPhonePairs(): string[] {
    return Array.from(this.joinedPhonePairs);
  }

  getConnectionState(): HubConnectionState | null {
    return this.hubConnection?.state ?? null;
  }
}
