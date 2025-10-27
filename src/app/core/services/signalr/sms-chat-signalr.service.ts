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
      await this.hubConnection.invoke("LeaveApplicant", normalized);
    } finally {
      this.joinedApplicants.delete(normalized);
      if (!this.joinedApplicants.size) {
        await this.disconnectIfIdle();
      }
    }
  }

  async disconnectIfIdle(): Promise<void> {
    if (
      this.hubConnection &&
      this.hubConnection.state !== HubConnectionState.Disconnected &&
      !this.joinedApplicants.size
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

    const connection = new HubConnectionBuilder()
      .withUrl(this.resolveHubUrl(), {
        accessTokenFactory: () => this.core.getCachedToken() ?? "",
        withCredentials: false,
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(LogLevel.Error)
      .build();

    connection.on("ReceiveMessage", (payload: unknown) =>
      this.handleIncoming(payload)
    );
    connection.onclose(() => {
      this.connectionPromise = null;
      this.hubConnection = null;
    });
    connection.onreconnected(() => {
      const ids = Array.from(this.joinedApplicants);
      ids.forEach((id) => {
        this.hubConnection?.invoke("JoinApplicant", id).catch(() => {});
      });
    });

    this.hubConnection = connection;
    const startPromise = connection.start().catch((err: unknown) => {
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
    const normalized = this.normalizePayload(payload);
    if (!normalized) {
      return;
    }
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
}
