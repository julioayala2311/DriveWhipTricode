import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-applicant-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="applicant-panel-backdrop" (click)="closePanel.emit()">
    <aside class="applicant-panel" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
      <header class="panel-header">
        <div class="d-flex align-items-center gap-1">
          <button type="button" class="btn btn-link btn-sm text-secondary px-2" (click)="closePanel.emit()" aria-label="Close panel">
            <i class="feather icon-x"></i>
          </button>
          <button type="button" class="btn btn-link btn-sm panel-nav px-2" (click)="goToPrevious.emit()" [disabled]="!hasPrevious" aria-label="Previous applicant">
            <i class="feather icon-chevron-left"></i>
          </button>
          <button type="button" class="btn btn-link btn-sm panel-nav px-2" (click)="goToNext.emit()" [disabled]="!hasNext" aria-label="Next applicant">
            <i class="feather icon-chevron-right"></i>
          </button>
        </div>
        <div class="panel-tabs">
          <button type="button" class="panel-tab" [class.active]="activeTab==='messages'" (click)="setTab.emit('messages')"><i class="feather icon-message-circle me-1"></i>Messages</button>
          <button type="button" class="panel-tab" [class.active]="activeTab==='history'" (click)="setTab.emit('history')"><i class="feather icon-clock me-1"></i>History</button>
          <button type="button" class="panel-tab" [class.active]="activeTab==='files'" (click)="setTab.emit('files')"><i class="feather icon-file-text me-1"></i>Files</button>
        </div>
      </header>
      <div class="panel-body" *ngIf="applicant">
        <section class="panel-column panel-info">
          <div class="panel-scroll">
            <h5 class="panel-title mb-1">{{ applicant.name }}</h5>
            <div class="panel-section">
              <div class="section-title d-flex justify-content-between align-items-center">
                <span>Information</span>
              </div>
              <ul class="list-unstyled panel-list">
                <li *ngIf="applicant.email">
                  <i class="feather icon-mail me-2 text-primary"></i>{{ applicant.email }}
                </li>
                <li *ngIf="applicant.phone">
                  <i class="feather icon-phone me-2 text-primary"></i>{{ applicant.phone }}
                </li>
                <li *ngIf="displayLocation">
                  <i class="feather icon-map-pin me-2 text-primary"></i>{{ displayLocation }}
                </li>
                <li *ngIf="displayStage">
                  <i class="feather me-2 text-primary" [ngClass]="stageIconClass"></i>{{ displayStage }}
                </li>
              </ul>
            </div>
            <div class="panel-section">
              <div class="section-title">Status</div>
              <span class="status-chip badge d-inline-flex align-items-center gap-1"
                    [ngClass]="statusBadgeClass(applicant?.status)">
                <i class="feather" [ngClass]="statusBadgeIcon(applicant?.status)"></i>
                <span>{{ applicant.status?.stage || 'Stage' }} - {{ (applicant.status?.statusName || 'incomplete') | titlecase }}</span>
              </span>
              <div class="text-secondary small mt-2">Stage completion</div>
            </div>
            <div class="panel-section">
              <div class="section-title d-flex justify-content-between align-items-center">
                <span>Notes</span>
                <button type="button" class="btn btn-link btn-xs px-0">Add Note</button>
              </div>
              <div class="text-secondary small">No notes yet.</div>
            </div>
            <div class="panel-section">
              <div class="section-title">Details</div>
              <dl class="detail-grid">
                <ng-container *ngFor="let item of applicant.details">
                  <dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd>
                </ng-container>
              </dl>
            </div>
          </div>
          <div class="panel-actions">
            <button type="button" class="btn btn-primary btn-sm">Move to next stage</button>
            <button type="button" class="btn btn-outline-secondary btn-sm">Reject</button>
            <button type="button" class="btn btn-outline-secondary btn-sm">More actions</button>
          </div>
        </section>
        <section class="panel-column panel-chat">
          <div class="panel-chat-body messages" *ngIf="activeTab==='messages'">
            <ng-container *ngFor="let message of resolvedMessages; let i = index">
              <div class="chat-day text-secondary small" *ngIf="message.dayLabel && shouldRenderDay(message.dayLabel, i)">
                {{ message.dayLabel }}
              </div>
              <div class="chat-message" [ngClass]="message.direction">
                <div class="chat-avatar" *ngIf="message.direction === 'inbound'">
                  <span>{{ message.avatar ?? (message.sender | slice:0:1) }}</span>
                </div>
                <div class="chat-content">
                  <div class="chat-bubble" [ngClass]="message.direction">
                    <div class="chat-title fw-semibold mb-1" *ngIf="message.sender">{{ message.sender }}</div>
                    <div class="chat-text" [innerHTML]="message.body"></div>
                  </div>
                  <div class="chat-meta small">
                    <span>{{ message.timestamp }}</span>
                    <span class="dot">•</span>
                    <span>{{ message.channel }}</span>
                    <span class="dot" *ngIf="message.statusLabel">•</span>
                    <!-- <span
                      *ngIf="message.statusLabel"
                      [ngClass]="statusMetaClass(message.status)"
                      class="d-inline-flex align-items-center gap-1"
                    >
                      <i class="feather" [ngClass]="statusMetaIcon(message.status)"></i>{{ message.statusLabel }}
                    </span> -->
                    <button
                      type="button"
                      class="btn btn-link btn-xxs px-1 text-secondary"
                      *ngIf="message.automated"
                    >
                      Hide automated messages
                    </button>
                  </div>
                </div>
              </div>
            </ng-container>
          </div>
          <div class="panel-chat-body" *ngIf="activeTab==='history'">
            <div class="text-secondary small">No history available yet.</div>
          </div>
          <div class="panel-chat-body" *ngIf="activeTab==='files'">
            <div class="text-secondary small">No files uploaded.</div>
          </div>
          <form class="chat-input" (submit)="sendMessage.emit($event)">
            <div class="input-group">
              <button type="button" class="btn btn-link text-secondary px-2" aria-label="Add attachment"><i class="feather icon-plus"></i></button>
              <input type="text" class="form-control" placeholder="Enter your message" [(ngModel)]="draftMessage" (ngModelChange)="onDraftMessageChange($event)" name="messageInput" />
              <button type="submit" class="btn btn-primary" [disabled]="!draftMessage.trim()">Send</button>
            </div>
          </form>
        </section>
      </div>
    </aside>
  </div>
  `,
  styles: [`
    :host { position: fixed; inset:0; display:flex; justify-content:flex-end; z-index:1050; }
    .applicant-panel-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15,23,42,.35);
      backdrop-filter: blur(2px);
      display:flex;
      justify-content:flex-end;
    }
    .applicant-panel {
      width: min(960px, 95vw);
      max-height: 100vh;
      background: var(--bs-body-bg);
      box-shadow: -4px 0 24px rgba(15,23,42,.25);
      display:flex;
      flex-direction:column;
      border-top-left-radius: 18px;
      border-bottom-left-radius: 18px;
      overflow:hidden;
    }
    .panel-header {
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:.75rem 1.25rem .5rem;
      border-bottom:1px solid var(--bs-border-color, rgba(0,0,0,.1));
      background: var(--bs-body-bg);
      position:sticky;
      top:0;
      z-index:2;
      gap:1rem;
    }
    .panel-nav { color: var(--bs-secondary-color, rgba(0,0,0,.6)); text-decoration:none; }
    .panel-nav:disabled { opacity:.35; pointer-events:none; }
    .panel-tabs { display:flex; gap:.25rem; }
    .panel-tab {
      border:none;
      background:transparent;
      padding:.45rem .85rem;
      border-radius:999px;
      font-size:.85rem;
      display:flex;
      align-items:center;
      gap:.35rem;
      color: var(--bs-secondary-color, rgba(0,0,0,.6));
      transition:background .2s ease, color .2s ease;
    }
    .panel-tab.active {
      background: rgba(var(--bs-primary-rgb,13,110,253),.12);
      color: var(--bs-primary,#0d6efd);
      font-weight:600;
    }
    .panel-body { display:flex; flex:1 1 auto; overflow:hidden; }
    .panel-column { flex:1 1 50%; display:flex; flex-direction:column; }
    .panel-info { border-right:1px solid var(--bs-border-color, rgba(0,0,0,.08)); }
    .panel-scroll { padding:1.25rem; overflow-y:auto; flex:1 1 auto; }
    .panel-title { font-size:1.25rem; font-weight:600; }
    .panel-section { margin-bottom:1.5rem; }
    .section-title { font-weight:600; font-size:.85rem; text-transform:uppercase; letter-spacing:.25px; color: var(--bs-secondary-color, rgba(0,0,0,.55)); margin-bottom:.75rem; }
    .panel-list li { display:flex; align-items:center; font-size:.92rem; margin-bottom:.5rem; color: var(--bs-body-color); }
    .panel-list i { font-size:.95rem; }
    .stage-pill { display:inline-flex; align-items:center; gap:.55rem; padding:.45rem .9rem; border-radius:1rem; background: rgba(var(--bs-primary-rgb,13,110,253),.12); color: var(--bs-primary,#0d6efd); font-weight:600; font-size:.85rem; }
    .stage-pill-icon { width:28px; height:28px; border-radius:12px; display:flex; align-items:center; justify-content:center; background: linear-gradient(135deg, rgba(var(--bs-primary-rgb,13,110,253),.18), rgba(var(--bs-primary-rgb,13,110,253),.05)); box-shadow: inset 0 0 0 1px rgba(var(--bs-primary-rgb,13,110,253),.2); color: var(--bs-primary,#0d6efd); }
    .stage-pill-icon i { font-size:.9rem; }
    .stage-pill-text { font-size:.88rem; white-space:nowrap; }
    .detail-grid { display:grid; grid-template-columns: minmax(120px,1fr) 2fr; gap:.35rem .75rem; font-size:.85rem; }
    .detail-grid dt { font-weight:600; color: var(--bs-secondary-color, rgba(0,0,0,.6)); }
    .detail-grid dd { margin:0; color: var(--bs-body-color); word-break:break-word; }
    .panel-actions { display:flex; gap:.5rem; padding:1rem 1.25rem; border-top:1px solid var(--bs-border-color, rgba(0,0,0,.08)); background: var(--bs-body-bg); }
    .panel-chat { background: var(--bs-body-bg); }
    .panel-chat-body { flex:1 1 auto; padding:0; overflow-y:auto; display:flex; flex-direction:column; gap:0; background: linear-gradient(180deg, rgba(13,110,253,.06) 0%, rgba(13,110,253,0) 120px); }
    .panel-chat-body.messages { padding:2rem 2.25rem; }
    .chat-day { text-align:center; text-transform:uppercase; font-weight:600; letter-spacing:.3px; color: rgba(15,23,42,.45); margin-bottom:1.5rem; }
    .chat-message { max-width: 88%; display:flex; flex-direction:row; gap:.85rem; align-items:flex-start; margin-bottom:1.5rem; }
    .chat-message.outbound { margin-left:auto; justify-content:flex-end; }
    .chat-message.outbound .chat-content { align-items:flex-end; }
    .chat-message.outbound .chat-bubble { background: linear-gradient(
      180deg,
      rgba(var(--bs-primary-rgb, 13, 110, 253), 1) 0%,
      rgba(var(--bs-primary-rgb, 13, 110, 253), 0.8) 100%); color:#fff; border-color: rgba(var(--bs-primary-rgb,13,110,253),.55); box-shadow:0 24px 36px -20px rgba(var(--bs-primary-rgb,13,110,253),.45); }
    .chat-message.outbound .chat-bubble a { color:#fff; text-decoration:underline; }
    .chat-message.outbound .chat-title { color: rgba(255,255,255,.75); }
    .chat-message.outbound .chat-meta { justify-content:flex-end; color: rgba(255,255,255,.75); }
    .chat-message.outbound .chat-meta .dot { color: rgba(255,255,255,.65); }
    .chat-message.outbound .chat-meta button { color: rgba(255,255,255,.8) !important; }
    .chat-message.outbound .chat-meta button:hover { color:#ffffff !important; }
    .chat-content { display:flex; flex-direction:column; gap:.75rem; }
    .chat-bubble {
      background: linear-gradient(180deg, var(--bs-body-bg) 0%, var(--bs-body-bg) 100%);
      border-radius:18px;
      padding:1.15rem 1.3rem;
      box-shadow: 0 24px 44px -28px rgba(15,23,42,.45), 0 6px 18px rgba(15,23,42,.08);
      border:1px solid rgba(15,23,42,.08);
    }
    .chat-title { color: rgba(15,23,42,.52); font-size:.76rem; letter-spacing:.28px; text-transform:uppercase; }
    .chat-text { line-height:1.45; }
    .chat-bubble a { color: var(--bs-primary,#0d6efd); font-weight:600; }
    .chat-meta { margin-top:.25rem; display:flex; align-items:center; gap:.5rem; color: rgba(15,23,42,.55); flex-wrap:wrap; }
    .chat-meta .dot { font-size:.65rem; opacity:.65; }
    .btn-xxs { font-size:.7rem; padding:0 .35rem; }
    .btn-xxs:hover { text-decoration:underline; }
    .chat-avatar { width:32px; height:32px; border-radius:50%; background: rgba(var(--bs-primary-rgb,13,110,253),.16); color: var(--bs-primary,#0d6efd); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:.85rem; flex-shrink:0; box-shadow: inset 0 0 0 1px rgba(var(--bs-primary-rgb,13,110,253),.35); }
    .chat-input { padding:1rem 1.5rem; border-top:1px solid var(--bs-border-color, rgba(0,0,0,.08)); background: var(--bs-body-bg); }
    .chat-input .form-control { border-radius:999px; }
    .chat-input .btn-primary { border-radius:999px; padding-inline:1.5rem; }
    .btn-xs { font-size:.75rem; }
    .status-chip { border-radius:999px; padding:.45rem .75rem; font-size:.78rem; font-weight:600; }

    @media (max-width: 992px) {
      :host { justify-content:center; }
      .applicant-panel { width:100%; border-radius:0; }
      .panel-body { flex-direction:column; }
      .panel-column { flex-basis:auto; }
      .panel-info { border-right:none; border-bottom:1px solid var(--bs-border-color, rgba(0,0,0,.08)); }
    }

    body.dark .applicant-panel { background:#1b2027; box-shadow:-4px 0 24px rgba(0,0,0,.55); }
    body.dark .panel-info { border-color: rgba(255,255,255,.08); }
    body.dark .panel-header { background:#1b2027; border-color: rgba(255,255,255,.08); }
    body.dark .panel-actions { background:#1b2027; border-color: rgba(255,255,255,.08); }
    body.dark .panel-chat { background:#1b2027; }
    body.dark .panel-tab { color: rgba(255,255,255,.65); }
    body.dark .panel-tab.active { color:#fff; }
    body.dark .panel-list li { color:#fff; }
    body.dark .chat-bubble { background: rgba(var(--bs-primary-rgb,13,110,253),.2); }
    body.dark .stage-pill { background: rgba(var(--bs-primary-rgb,13,110,253),.25); color:#fff; }
    body.dark .stage-pill-icon { background: rgba(var(--bs-primary-rgb,13,110,253),.35); color:#fff; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
    body.dark .chat-avatar { background: rgba(var(--bs-primary-rgb,13,110,253),.35); color:#fff; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
    body.dark .chat-message.outbound .chat-bubble { background: linear-gradient(
      180deg,
      rgba(var(--bs-primary-rgb, 13, 110, 253), 1) 0%,
      rgba(var(--bs-primary-rgb, 13, 110, 253), 0.8) 100%); border-color: rgba(var(--bs-primary-rgb,13,110,253),.6); }
    body.dark .chat-message.outbound .chat-meta { color: rgba(255,255,255,.82); }
  `]
})
export class ApplicantPanelComponent implements OnChanges {
  @Input() applicant: any;
  @Input() activeTab: 'messages' | 'history' | 'files' = 'messages';
  @Input() hasPrevious: boolean = false;
  @Input() hasNext: boolean = false;
  @Input() draftMessage: string = '';
  @Input() messages: ApplicantMessage[] | null = null;
  @Input() locationName: string | null = null;
  @Input() stageName: string | null = null;
  @Input() stageIcon: string = 'icon-layers';
  @Output() draftMessageChange = new EventEmitter<string>();
  @Output() closePanel = new EventEmitter<void>();
  @Output() goToPrevious = new EventEmitter<void>();
  @Output() goToNext = new EventEmitter<void>();
  @Output() setTab = new EventEmitter<'messages' | 'history' | 'files'>();
  @Output() sendMessage = new EventEmitter<Event>();

  private readonly fallbackMessages: ApplicantMessage[] = [
    {
      id: 'msg-1',
      direction: 'inbound',
      sender: 'Whip',
      body: 'Hi Julius, your Whip is almost here! Finish your app now - full coverage, free maintenance, and unlimited miles included. <a href="#">web.fountain.com/apply/drivewhip</a>',
      timestamp: '10:06 PM EDT',
      channel: 'SMS',
      status: 'not_delivered',
      statusLabel: 'Not delivered',
      dayLabel: 'Sunday, October 5',
      automated: true,
      avatar: 'W'
    },
    {
      id: 'msg-2',
      direction: 'outbound',
      sender: 'You',
      body: 'Thanks! I will complete the application now.',
      timestamp: '10:07 PM EDT',
      channel: 'SMS',
      status: 'delivered',
      statusLabel: 'Delivered',
      dayLabel: 'Sunday, October 5',
      automated: false
    }
  ];

  private _resolvedMessages: ApplicantMessage[] = [];

  constructor() {
    this.refreshResolvedMessages();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages'] || changes['applicant']) {
      this.refreshResolvedMessages();
    }
  }

  onDraftMessageChange(value: string) {
    this.draftMessage = value;
    this.draftMessageChange.emit(value);
  }

  get resolvedMessages(): ApplicantMessage[] {
    return this._resolvedMessages;
  }

  shouldRenderDay(day: string, index: number): boolean {
    if (!day) return false;
    if (index === 0) return true;
    const previous = this._resolvedMessages[index - 1];
    return (previous?.dayLabel ?? '') !== day;
  }

  get displayLocation(): string | null {
    const fromInput = (this.locationName ?? '').toString().trim();
    if (fromInput) return fromInput;
    const fromApplicant = (this.applicant?.locationName ?? '').toString().trim();
    return fromApplicant || null;
  }

  get displayStage(): string | null {
    const fromInput = (this.stageName ?? '').toString().trim();
    if (fromInput) return fromInput;
    const fromApplicant = (this.applicant?.stageName ?? '').toString().trim();
    if (fromApplicant) return fromApplicant;
    const fromStatus = (this.applicant?.status?.stage ?? '').toString().trim();
    return fromStatus || null;
  }

  get stageIconClass(): string {
    const icon = (this.stageIcon ?? '').trim() || (this.applicant?.stageIcon ?? '').trim();
    return icon || 'icon-layers';
  }

  statusBadgeClass(status: ApplicantStatus | null | undefined): string {
    if (!status) {
      return 'bg-secondary-subtle text-secondary';
    }
    return status.isComplete ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary';
  }

  statusBadgeIcon(status: ApplicantStatus | null | undefined): string {
    if (!status) return 'icon-shield';
    return status.isComplete ? 'icon-check-circle' : 'icon-shield';
  }

  statusMetaClass(status: MessageStatus | undefined): string {
    switch (status) {
      case 'not_delivered':
        return 'text-warning';
      case 'delivered':
        return 'text-success';
      case 'pending':
      case 'sending':
        return 'text-secondary';
      default:
        return 'text-secondary';
    }
  }

  statusMetaIcon(status: MessageStatus | undefined): string {
    switch (status) {
      case 'not_delivered':
        return 'icon-alert-triangle';
      case 'delivered':
        return 'icon-check-circle';
      case 'pending':
      case 'sending':
        return 'icon-refresh-cw';
      default:
        return 'icon-message-circle';
    }
  }

  private refreshResolvedMessages(): void {
    const source = (this.messages && this.messages.length > 0)
      ? this.messages
      : (Array.isArray(this.applicant?.messages) && this.applicant.messages.length > 0
        ? this.applicant.messages as ApplicantMessage[]
        : this.fallbackMessages);

    this._resolvedMessages = source.map((msg, idx) => {
      const direction = (msg.direction ?? 'inbound') as 'inbound' | 'outbound';
      return {
        ...msg,
        id: msg.id ?? `msg-${idx}`,
        direction,
        sender: msg.sender ?? (direction === 'outbound' ? 'You' : 'Whip'),
        body: msg.body ?? '',
        timestamp: msg.timestamp ?? '',
        channel: msg.channel ?? 'SMS',
        status: msg.status,
        statusLabel: msg.statusLabel ?? this.defaultStatusLabel(msg.status),
        automated: msg.automated ?? false,
        dayLabel: msg.dayLabel ?? (idx === 0 ? 'Sunday, October 5' : ''),
        avatar: msg.avatar ?? (direction === 'inbound' ? (msg.sender ?? '').slice(0, 1) : undefined)
      };
    });
  }

  private defaultStatusLabel(status: MessageStatus | undefined): string | undefined {
    switch (status) {
      case 'not_delivered':
        return 'Not delivered';
      case 'delivered':
        return 'Delivered';
      case 'pending':
        return 'Pending';
      case 'sending':
        return 'Sending';
      default:
        return undefined;
    }
  }
}

interface ApplicantStatus {
  stage: string;
  statusName: string;
  isComplete: boolean;
}

type MessageStatus = 'delivered' | 'not_delivered' | 'pending' | 'sending' | undefined;

interface ApplicantMessage {
  id?: string;
  direction?: 'inbound' | 'outbound';
  sender?: string;
  body?: string;
  timestamp?: string;
  channel?: string;
  status?: MessageStatus;
  statusLabel?: string;
  automated?: boolean;
  dayLabel?: string;
  avatar?: string;
}

