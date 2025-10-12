import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-applicant-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './applicants-panel.component.html',
  styleUrls: ['./applicants-panel.component.scss']
})
export class ApplicantPanelComponent implements OnChanges {
  private readonly defaultSectionIds = ['info', 'status', 'notes', 'details'];
  openSections = new Set<string>(this.defaultSectionIds);
  menuOpen = false;
  stageMenuOpen = false;

  @Input() applicant: any;
  @Input() activeTab: 'messages' | 'history' | 'files' = 'messages';
  @Input() hasPrevious: boolean = false;
  @Input() hasNext: boolean = false;
  @Input() draftMessage: string = '';
  @Input() messages: ApplicantMessage[] | null = null;
  @Input() locationName: string | null = null;
  @Input() stageName: string | null = null;
  @Input() stageIcon: string = 'icon-layers';
  @Input() availableStages: any[] = [];
  @Input() currentStageId: number | null = null;
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
      body: 'Hi {{ applicant.name }}, your Whip is almost here! Finish your app now - full coverage, free maintenance, and unlimited miles included.',
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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages'] || changes['applicant']) {
      this.refreshResolvedMessages();
    }
    if (changes['applicant']) {
      this.openSections = new Set<string>(this.defaultSectionIds);
      this.closeMenus();
    }
    if (changes['availableStages']) {
      this.stageMenuOpen = false;
    }
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.closeMenus();
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    this.closeMenus();
  }

  isSectionOpen(section: string): boolean {
    return this.openSections.has(section);
  }

  toggleSection(section: string): void {
    if (this.openSections.has(section)) {
      this.openSections.delete(section);
    } else {
      this.openSections.add(section);
    }
    this.openSections = new Set(this.openSections);
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    if (!this.menuOpen) {
      this.stageMenuOpen = false;
    }
  }

  closeMenus(): void {
    this.menuOpen = false;
    this.stageMenuOpen = false;
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

  get stageMenuOptions(): StageMenuOption[] {
    const source = this.availableStages ?? [];
    return source.map((stage: any) => ({
      id: Number(stage?.id ?? stage?.id_stage ?? stage?.idStage ?? 0),
      name: (stage?.name ?? '').toString(),
      type: (stage?.type ?? 'Stage').toString()
    }));
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
      // Replace {{ applicant.name }} with actual name if present in body
      let body = msg.body ?? '';
      if (body.includes('{{ applicant.name }}') && this.applicant?.name) {
        body = body.replace(/{{\s*applicant\.name\s*}}/g, this.applicant.name);
      }
      return {
        ...msg,
        id: msg.id ?? `msg-${idx}`,
        direction,
        sender: msg.sender ?? (direction === 'outbound' ? 'You' : 'Whip'),
        body,
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


interface StageMenuOption {
  id: number;
  name: string;
  type: string;
}

