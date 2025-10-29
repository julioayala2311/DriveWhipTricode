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
  private readonly joinedPhones = new Set<string>();
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

  async disconnectIfIdle(): Promise<void> {
    if (
      this.hubConnection &&
      this.hubConnection.state !== HubConnectionState.Disconnected &&
      !this.joinedPhones.size
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

    connection.on("ReceiveInboundMessage", (payload: unknown) =>
      this.handleInbound(payload)
    );
    connection.on("ReceiveOutboundMessage", (payload: unknown) =>
      this.handleOutbound(payload)
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
      this.debug('Reconnected; rejoining phone groups...', this.joinedPhones);
      const phones = Array.from(this.joinedPhones);
      phones.forEach((p) => {
        this.hubConnection?.invoke("JoinPhone", p).catch(() => {});
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
    const base = this.appConfig.apiBaseUrl || "";
    const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
    if (trimmed.toLowerCase().endsWith("/api")) {
      return `${trimmed}/hubs/sms-chat`;
    }
    return `${trimmed}/api/hubs/sms-chat`;
  }
  
  private handleInbound(payload: unknown): void {
    const normalized = this.normalizePayload(payload, "inbound");
    if (!normalized) return;
    this.debug('ReceiveInboundMessage <-', normalized);
    this.messagesSubject.next(normalized);
  }

  private handleOutbound(payload: unknown): void {
    const normalized = this.normalizePayload(payload, "outbound");
    if (!normalized) return;
    this.debug('ReceiveOutboundMessage <-', normalized);
    this.messagesSubject.next(normalized);
  }

  private normalizePayload(payload: any, fallbackDirection: "inbound" | "outbound"): ApplicantChatRealtimeMessage | null {
    if (!payload) {
      return null;
    }
    const directionRaw = (payload.direction ?? payload.Direction ?? fallbackDirection)
      .toString()
      .toLowerCase();
    const direction = directionRaw === "outbound" ? "outbound" : "inbound";

    return {
      applicantId: (payload.applicantId ?? payload.ApplicantId ?? "").toString(),
      body: (payload.body ?? payload.Body ?? "").toString(),
      direction,
      from: this.normalizePhone(payload.from ?? payload.From) ?? (payload.from ?? payload.From ?? "").toString(),
      to: this.normalizePhone(payload.to ?? payload.To) ?? (payload.to ?? payload.To ?? "").toString(),
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

  async joinPhone(phone: string | null | undefined): Promise<void> {
    const p = this.normalizePhone(phone);
    if (!p) return;
    await this.ensureConnection();
    if (this.joinedPhones.has(p)) return;
    this.debug('JoinPhone ->', p, 'group=sms:' + p);
    try {
      if (this.debugEnabled()) {
        console.log('[SmsChatSR] Joining SignalR group', `sms:${p}`);
      }
    } catch {}
    await this.hubConnection!.invoke("JoinPhone", p);
    this.joinedPhones.add(p);
  }

  async leavePhone(phone: string | null | undefined): Promise<void> {
    const p = this.normalizePhone(phone);
    if (!p || !this.hubConnection) return;
    try {
      this.debug('LeavePhone ->', p, 'group=sms:' + p);
      try {
        if (this.debugEnabled()) {
          console.log('[SmsChatSR] Leaving SignalR group', `sms:${p}`);
        }
      } catch {}
      await this.hubConnection.invoke("LeavePhone", p);
    } finally {
      this.joinedPhones.delete(p);
      if (!this.joinedPhones.size) {
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

  getJoinedPhones(): string[] {
    return Array.from(this.joinedPhones);
  }

  isSubscribedToPhone(phone: string | null | undefined): boolean {
    const p = this.normalizePhone(phone);
    return !!p && this.joinedPhones.has(p);
  }

  getConnectionState(): HubConnectionState | null {
    return this.hubConnection?.state ?? null;
  }
}
