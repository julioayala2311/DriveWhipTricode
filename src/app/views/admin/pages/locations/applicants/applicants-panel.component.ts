import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnInit, OnDestroy, ElementRef, ViewChild, HostListener, inject } from '@angular/core';
import Swal from 'sweetalert2';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DriveWhipCoreService } from '../../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../../core/models/entities.model';
import { DriveWhipAdminCommand } from '../../../../../core/db/procedures';
import { Utilities } from '../../../../../Utilities/Utilities';
import { AuthSessionService } from '../../../../../core/services/auth/auth-session.service';

@Component({
  selector: 'app-applicant-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './applicants-panel.component.html',
  styleUrls: ['./applicants-panel.component.scss']
})
export class ApplicantPanelComponent implements OnChanges, OnInit, OnDestroy {
  private readonly defaultSectionIds = ['info', 'status', 'notes', 'details'];
  openSections = new Set<string>(this.defaultSectionIds);
  menuOpen = false;
  stageMenuOpen = false;
  @ViewChild('moreActionsWrapper', { static: false }) moreActionsWrapper?: ElementRef;
  private authSession = inject(AuthSessionService);
  @Input() applicant: any;
  @Input() activeTab: 'messages' | 'history' | 'files' = 'messages';
  @Input() hasPrevious: boolean = false;
  @Input() hasNext: boolean = false;
  @Input() draftMessage: string = '';
  @Input() messages: ApplicantMessage[] | null = null;
  @Input() locationName: string | null = null;
  @Input() stageName: string | null = null;
  @Input() history: Array<{ type?: string; text?: string; time?: string }> | null = null;
  @Input() stageIcon: string = 'icon-layers';
  @Input() availableStages: any[] = [];
  @Input() currentStageId: number | null = null;
  @Output() draftMessageChange = new EventEmitter<string>();
  @Output() closePanel = new EventEmitter<void>();
  @Output() goToPrevious = new EventEmitter<void>();
  @Output() goToNext = new EventEmitter<void>();
  @Output() setTab = new EventEmitter<'messages' | 'history' | 'files'>();
  @Output() sendMessage = new EventEmitter<Event>();
  @Output() stageMoved = new EventEmitter<{ idApplicant: string; toStageId: number }>();
  @Output() applicantSaved = new EventEmitter<any>();
  // Notes state
  notes: Array<any> = [];
  notesLoading = false;
  notesSaving = false;
  movingStage = false;
  newNoteText = '';
  // Copy tooltip state
  copyFeedbackKey: string | null = null;
  private _copyFeedbackTimer: any = null;

  // Permission helpers - assumptions:
  // - authSession.user?.roles is an array of role strings (e.g. ['admin','reviewer']).
  // If your app uses a different shape, adjust hasRole/hasAnyRole accordingly.
  private userRoles(): string[] {
    const u: any = (this.authSession as any).user;
    // console.debug(u, 'datos de usuario');
    if (!u) return [];
    // Prefer an explicit roles array
    if (Array.isArray(u.roles) && u.roles.length > 0) return u.roles.map((r:any) => String(r));
    // Fallback to a single-string role property
    if (typeof u.role === 'string' && u.role.trim() !== '') return [u.role.trim()];
    // Some sessions provide `roles` as a comma-separated string or `role` claim in the token.
    if (typeof u.roles === 'string' && u.roles.trim() !== '') {
      return u.roles.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    // Try to parse JWT token payload (if present) to extract claims like `role` or `roles`
    try {
      const token = (u.token ?? (this.authSession as any).token) as string | undefined;
      if (token && typeof token === 'string') {
        const parts = token.split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(atob(parts[1]));
          if (payload) {
            if (Array.isArray(payload.roles) && payload.roles.length > 0) return payload.roles.map((r:any) => String(r));
            if (typeof payload.role === 'string' && payload.role.trim() !== '') return [payload.role.trim()];
            if (typeof payload.roles === 'string' && payload.roles.trim() !== '') return payload.roles.split(',').map((s:string)=>s.trim()).filter(Boolean);
          }
        }
      }
    } catch (e) {
      // ignore parse errors
    }
    return [];
  }

  private hasAnyRole(roles: string[]): boolean {
    const ur = this.userRoles().map((r: string) => (r || '').toString().toLowerCase());
    return roles.some(rr => ur.includes(rr.toLowerCase()));
  }

  canMove(): boolean { return this.hasAnyRole(['ADMIN', 'Administrator','reviewer']); }
  canEditNotes(): boolean { return this.hasAnyRole(['ADMIN', 'Administrator','reviewer']); }
  canDeleteNotes(): boolean { return this.hasAnyRole(['ADMIN', 'Administrator']); }
  canEditApplicant(): boolean { return this.hasAnyRole(['ADMIN', 'Administrator','reviewer']); }
  canDeleteApplicant(): boolean { return this.hasAnyRole(['ADMIN', 'Administrator']); }
  // Note editing state
  private editingNoteId: any = null;
  editingNoteText: string = '';
  // Applicant editing state
  isEditingApplicant: boolean = false;
  editableApplicant: any = {};
  applicantSaving: boolean = false;

  constructor(private core: DriveWhipCoreService) {}

  startEditApplicant(): void {
    if (!this.canEditApplicant()) { Utilities.showToast('You do not have permission to edit applicants', 'warning'); return; }
    this.isEditingApplicant = true;
    // ensure editableApplicant is a fresh copy
    this.editableApplicant = this.applicant ? { ...this.applicant } : {};
    // close menu when editing begins
    this.closeMenus();
  }

  cancelEditApplicant(): void {
    this.isEditingApplicant = false;
    this.editableApplicant = this.applicant ? { ...this.applicant } : {};
  }

  saveApplicant(): void {
    if (!this.applicant || !this.applicant.id) { Utilities.showToast('Applicant id missing', 'warning'); return; }
    const payload = { ...this.editableApplicant };
    this.applicantSaving = true;
    // Call the provided stored procedure app_applicants_crud
    // SP signature (IN order): p_action, p_first_name, p_last_name, p_date_birthday, p_email, p_phone_number, p_referral_name, p_state_code, p_street, p_city, p_zip_code, p_accept_terms, p_allow_msg_updates, p_allow_calls, p_is_active, p_state_code_location
    try {
      const params: any[] = [
        'U',
        payload.first_name ?? payload.name ?? null,
        payload.last_name ?? null,
        payload.date_birthday ?? null,
        payload.email ?? null,
        payload.phone_number ?? payload.phone ?? payload.phoneNumber ?? null,
        payload.referral_name ?? null,
        payload.state_code ?? null,
        payload.street ?? null,
        payload.city ?? null,
        payload.zip_code ?? payload.zip ?? null,
        payload.accept_terms ? 1 : 0,
        payload.allow_msg_updates ? 1 : 0,
        payload.allow_calls ? 1 : 0,
        (payload.is_active === undefined ? (payload.isActive ?? 1) : payload.is_active) ? 1 : 0,
        payload.state_code_location ?? payload.state_code_location ?? null
      ];
      const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.app_applicants_crud as any, parameters: params } as any;
      this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
        next: res => {
          if (!res.ok) { Utilities.showToast(String(res.error || 'Failed to save applicant'), 'error'); return; }
          Utilities.showToast('Applicant saved', 'success');
          // Update local applicant object with editable values so UI shows updated fields
          this.applicant = { ...this.applicant, ...this.editableApplicant };
          this.isEditingApplicant = false;
          // emit event to parent to allow refresh of lists/counts
          this.applicantSaved.emit({ id: this.applicant.id, payload: this.applicant });
        },
        error: err => { console.error('[ApplicantPanel] saveApplicant error', err); Utilities.showToast('Failed to save applicant', 'error'); },
        complete: () => { this.applicantSaving = false; }
      });
    } catch (e) {
      console.error('[ApplicantPanel] saveApplicant unexpected error', e);
      Utilities.showToast('Failed to save applicant', 'error');
      this.applicantSaving = false;
    }
  }


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
  private readonly fallbackHistory: Array<any> = [
    {
      id: 'hist-1',
      type: 'created',
      text: 'Application created via online form.',
      time: '2025-10-10T11:12:00-06:00',
      displayTime: 'Oct 10, 2025 • 11:12 AM MDT',
      actorName: 'DriveWhip Portal',
      actorRole: 'System',
      status: 'success'
    },
    {
      id: 'hist-2',
      type: 'transition',
      text: 'Moved from New Applicant to Insurance Questionnaire.',
      time: '2025-10-10T11:15:00-06:00',
      displayTime: 'Oct 10, 2025 • 11:15 AM MDT',
      actorName: 'Amanda Chen',
      actorRole: 'Admin',
      previousStage: 'New Applicant',
      newStage: 'Insurance Questionnaire',
      notes: 'Auto progression after completing personal info.'
    },
    {
      id: 'hist-3',
      type: 'email',
      text: 'Sent welcome email to applicant.',
      time: '2025-10-10T11:16:00-06:00',
      displayTime: 'Oct 10, 2025 • 11:16 AM MDT',
      actorName: 'DriveWhip Automation',
      actorRole: 'System',
      channel: 'Email',
      recipient: 'zamir.steed@example.com',
      subject: 'Welcome to DriveWhip',
      body: 'Hi Zamir, thanks for applying! Please upload your documents.',
      status: 'sent'
    },
    {
      id: 'hist-4',
      type: 'sms',
      text: 'SMS reminder sent with document upload link.',
      time: '2025-10-10T11:18:00-06:00',
      displayTime: 'Oct 10, 2025 • 11:18 AM MDT',
      actorName: 'DriveWhip Automation',
      actorRole: 'System',
      channel: 'SMS',
      target: '+1 (555) 123-4567',
      body: 'Reminder: upload your proof of insurance at https://drivewhip.app/doc/123',
      status: 'delivered'
    },
    {
      id: 'hist-5',
      type: 'upload',
      text: 'Proof of insurance uploaded.',
      time: '2025-10-10T11:22:00-06:00',
      displayTime: 'Oct 10, 2025 • 11:22 AM MDT',
      actorName: 'Zamir Steed',
      actorRole: 'Applicant',
      fileName: 'proof-of-insurance.pdf',
      fileType: 'PDF',
      fileSize: '1.2 MB',
      fileUrl: '#',
      notes: 'Document uploaded from mobile device.',
      status: 'success'
    },
    {
      id: 'hist-6',
      type: 'error',
      text: 'SMS delivery failed to backup number.',
      time: '2025-10-10T11:25:00-06:00',
      displayTime: 'Oct 10, 2025 • 11:25 AM MDT',
      actorName: 'DriveWhip Automation',
      actorRole: 'System',
      channel: 'SMS',
      target: '+1 (555) 987-6543',
      body: 'Reminder: upload your proof of insurance at https://drivewhip.app/doc/123',
      status: 'failed',
      errorMessage: 'Carrier rejected message. Try alternative channel.'
    }
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages'] || changes['applicant']) {
      this.refreshResolvedMessages();
    }
    if (changes['applicant']) {
      this.openSections = new Set<string>(this.defaultSectionIds);
      this.closeMenus();
      // prepare editable copy for inline editing
      this.editableApplicant = this.applicant ? { ...this.applicant } : {};
      // load notes for this applicant when panel opens / applicant changes
      if (this.applicant && this.applicant.id) {
        this.loadNotes(this.applicant.id);
      } else {
        this.notes = [];
      }
    }
    if (changes['availableStages']) {
      this.stageMenuOpen = false;
    }
  }

  // Capture-phase document click listener so we can reliably detect clicks outside
  // the actions menu even if inner elements call stopPropagation().
  private _outsideClickListener = (evt: Event) => {
    try {
      if (!this.menuOpen) return;
      const wrapperEl = this.moreActionsWrapper?.nativeElement as HTMLElement | undefined;
      // If we have a wrapper and the click target is inside it, do nothing.
      if (wrapperEl && wrapperEl.contains(evt.target as Node)) return;
      // Otherwise close menus
      this.closeMenus();
    } catch (e) {
      // swallow any errors
      console.error('[ApplicantPanel] outsideClickListener error', e);
    }
  };

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    this.closeMenus();
  }

  ngOnInit(): void {
    // use capture phase to avoid being canceled by stopPropagation on inner handlers
    document.addEventListener('click', this._outsideClickListener, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this._outsideClickListener, true);
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

  /** Returns the history array to render in the timeline (prefers explicit input, falls back to applicant.history) */
  get historyItems(): Array<{ type?: string; text?: string; time?: string }> {
    if (Array.isArray(this.history) && this.history.length) return this.history as any;
    if (Array.isArray(this.applicant?.history) && this.applicant.history.length) return this.applicant.history;
    return this.fallbackHistory;
  }

  // Filtering / searching state for the timeline
  filterType: string = 'all'; // 'all' | 'message' | 'transition' | 'email' | 'sms' | 'upload' | 'error'
  filterText: string = '';

  get filteredHistoryItems(): Array<any> {
    const items = this.historyItems || [];
    const type = (this.filterType || 'all').toString().toLowerCase();
    const text = (this.filterText || '').toString().trim().toLowerCase();
    const filtered = items.filter((it: any) => {
      if (type !== 'all') {
        if ((it.type || '').toString().toLowerCase() !== type) return false;
      }
      if (text) {
        const hay = ((it.text || '') + ' ' + (it.actorName || '')).toString().toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });

    return filtered
      .map(ev => ({ ...ev, __timestamp: this.resolveEventTimestamp(ev) }))
      .sort((a, b) => {
        const ta = a.__timestamp ?? 0;
        const tb = b.__timestamp ?? 0;
        return tb - ta;
      });
  }

  setFilterType(t: string) { this.filterType = t || 'all'; }
  clearFilters() { this.filterType = 'all'; this.filterText = ''; }

  get groupedHistoryItems(): Array<{ dayLabel: string; events: any[] }> {
    const groups: Array<{ dayLabel: string; events: any[] }> = [];
    for (const ev of this.filteredHistoryItems) {
      const dayLabel = this.resolveEventDay(ev);
      let bucket = groups.find(g => g.dayLabel === dayLabel);
      if (!bucket) {
        bucket = { dayLabel, events: [] };
        groups.push(bucket);
      }
      bucket.events.push(ev);
    }
    return groups;
  }

  openTimelineEvent(ev: any): void {
    if (!ev) return;
    const who = ev.actorName ? `<div><strong>By:</strong> ${this.escapeHtml(ev.actorName)}</div>` : '';
    let bodyHtml = '';
    switch ((ev.type || '').toString().toLowerCase()) {
      case 'email':
      case 'sms':
      case 'message':
        // message details
        bodyHtml = `
          ${who}
          <div class="mt-2"><strong>Channel:</strong> ${this.escapeHtml(ev.channel || ev.type)}</div>
          <div class="mt-2"><strong>To/From:</strong> ${this.escapeHtml(ev.target || ev.recipient || ev.actorName || '')}</div>
          <div class="mt-3"><pre style="white-space:pre-wrap;">${this.escapeHtml(ev.body || ev.text || '')}</pre></div>
          <div class="mt-2 text-muted small">Status: ${this.escapeHtml(ev.status || 'unknown')}</div>
        `;
        break;
      case 'transition':
        bodyHtml = `
          ${who}
          <div class="mt-2"><strong>From:</strong> ${this.escapeHtml(ev.from || ev.previousStage || '')}</div>
          <div class="mt-2"><strong>To:</strong> ${this.escapeHtml(ev.to || ev.newStage || '')}</div>
          <div class="mt-3">${this.escapeHtml(ev.notes || ev.text || '')}</div>
        `;
        break;
      case 'upload':
      case 'file':
        bodyHtml = `
          ${who}
          <div class="mt-2"><strong>File:</strong> ${this.escapeHtml(ev.fileName || ev.text || '')}</div>
          <div class="mt-2"><strong>Type:</strong> ${this.escapeHtml(ev.fileType || '')}</div>
          <div class="mt-2"><strong>Size:</strong> ${this.escapeHtml(ev.fileSize || '')}</div>
          <div class="mt-3">${this.escapeHtml(ev.notes || '')}</div>
          <div class="mt-3"><a href="${ev.fileUrl || '#'}" target="_blank">View / Download</a></div>
        `;
        break;
      default:
        bodyHtml = `${who}<div class="mt-2">${this.escapeHtml(ev.text || '')}</div>`;
    }
    void Swal.fire({
      title: this.escapeHtml(ev.type ? ev.type.toString().toUpperCase() : 'Event'),
      html: bodyHtml + `<div class="mt-2 text-muted small">${this.escapeHtml(ev.time || '')}</div>`,
      width: '720px',
      showCloseButton: true,
      showConfirmButton: false,
      customClass: { popup: 'history-event-modal' }
    });
  }

  // Simple HTML escaper for modal content
  private escapeHtml(input: any): string {
    if (input === null || input === undefined) return '';
    const s = input.toString();
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /** Map event type to a FontAwesome / marker classes */
  /** Map event type to a Feather icon class (project uses Feather icons) */
  timelineIcon(type?: string): string {
    switch ((type || '').toString().toLowerCase()) {
      case 'created': return 'icon-plus';
      case 'transition': return 'icon-arrow-right';
      case 'email': return 'icon-mail';
      case 'sms': return 'icon-message-circle';
      case 'note': return 'icon-file';
      case 'file': return 'icon-file-text';
      case 'upload': return 'icon-upload-cloud';
      case 'error': return 'icon-alert-circle';
      default: return 'icon-circle';
    }
  }

  timelineMarkerClass(type?: string): string {
    switch ((type || '').toString().toLowerCase()) {
      case 'created': return 'bg-primary text-white';
      case 'transition': return 'bg-info text-white';
      case 'email': return 'bg-success text-white';
      case 'sms': return 'bg-warning text-dark';
      case 'upload':
      case 'file': return 'bg-secondary text-white';
      case 'error': return 'bg-danger text-white';
      default: return 'bg-secondary text-white';
    }
  }

  timelineActorBadgeClass(role?: string): string {
    const normalized = (role || '').toString().toLowerCase();
    switch (normalized) {
      case 'system': return 'badge bg-secondary-subtle text-secondary';
      case 'admin':
      case 'reviewer': return 'badge bg-primary-subtle text-primary';
      case 'applicant':
      case 'user': return 'badge bg-success-subtle text-success';
      default: return 'badge bg-light text-secondary';
    }
  }

  timelineActorLabel(role?: string): string {
    if (!role) return 'User';
    const normalized = role.toString().toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  timelineDisplayTime(ev: any): string {
    if (ev.displayTime) return ev.displayTime;
    const ts = this.resolveEventTimestamp(ev);
    if (!ts) return ev.time ?? '';
    const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return formatter.format(new Date(ts));
  }

  private resolveEventTimestamp(ev: any): number | null {
    if (!ev) return null;
    if (ev.__timestamp && typeof ev.__timestamp === 'number') return ev.__timestamp;
    const raw = ev.time || ev.timestamp || ev.created_at || ev.createdAt;
    if (!raw) return null;
    const date = new Date(raw);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
  }

  private resolveEventDay(ev: any): string {
    if (ev.dayLabel) return ev.dayLabel;
    const ts = this.resolveEventTimestamp(ev);
    if (!ts) return 'Timeline';
    const date = new Date(ts);
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: '2-digit' }).format(date);
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

  private loadNotes(applicantId: string): void {
    this.notesLoading = true;
    this.notes = [];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_applicants_notes_crud, parameters: ['R', null, applicantId, null, null, null, null] };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        if (!res.ok) {
          Utilities.showToast('Failed to load notes', 'error');
          this.notes = [];
          return;
        }
        let raw: any = [];
        if (Array.isArray(res.data)) {
          const top = res.data as any[];
          if (top.length > 0 && Array.isArray(top[0])) raw = top[0]; else raw = top;
        }
        this.notes = Array.isArray(raw) ? raw : [];
      },
      error: err => {
        console.error('[ApplicantPanel] loadNotes error', err);
        Utilities.showToast('Failed to load notes', 'error');
        this.notes = [];
      },
      complete: () => { this.notesLoading = false; }
    });
  }

  onAddNote(ev: Event): void {
    ev.preventDefault();
    const text = (this.newNoteText ?? '').toString().trim();
    if (!text || !this.applicant || !this.applicant.id) return;
    this.notesSaving = true;
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_applicants_notes_crud, parameters: ['C', null, this.applicant.id, text, 1, (this.authSession.user?.user || 'system'), null] };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        if (!res.ok) {
          Utilities.showToast(String(res.error || 'Failed to save note'), 'error');
          return;
        }
        Utilities.showToast('Note added', 'success');
        this.newNoteText = '';
        // reload notes
        this.loadNotes(this.applicant.id);
      },
      error: err => {
        console.error('[ApplicantPanel] saveNote error', err);
        Utilities.showToast('Failed to save note', 'error');
      },
      complete: () => { this.notesSaving = false; }
    });
  }

  copyToClipboard(text: string | null | undefined, key?: string): void {
    if (!text) return;
    const setFeedback = (k?: string) => {
      this.copyFeedbackKey = k ?? null;
      if (this._copyFeedbackTimer) { clearTimeout(this._copyFeedbackTimer); this._copyFeedbackTimer = null; }
      if (k) this._copyFeedbackTimer = setTimeout(() => { this.copyFeedbackKey = null; this._copyFeedbackTimer = null; }, 2000);
    };
    try {
      void navigator.clipboard.writeText(String(text)).then(() => setFeedback(key), () => setFeedback(undefined));
    } catch (e) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = String(text);
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setFeedback(key); } catch { setFeedback(undefined); }
      document.body.removeChild(ta);
    }
  }

  isEditingNote(n: any): boolean { return this.editingNoteId !== null && this.editingNoteId === (n?.id || n?.id_note || n?.id_applicant_note || n?.id_note_applicant); }

  startEditNote(n: any): void {
    this.editingNoteId = n?.id ?? n?.id_note ?? n?.id_applicant_note ?? n?.id_note_applicant ?? null;
    this.editingNoteText = n?.note ?? '';
  }

  cancelEdit(): void { this.editingNoteId = null; this.editingNoteText = ''; }

  saveEditedNote(n: any): void {
    if (!this.applicant || !this.applicant.id) return;
    const noteId = this.editingNoteId;
    const text = (this.editingNoteText ?? '').toString().trim();
    if (!noteId || !text) { Utilities.showToast('Note must not be empty', 'warning'); return; }
    this.notesSaving = true;
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_applicants_notes_crud, parameters: ['U', noteId, this.applicant.id, text, 1, (this.authSession.user?.user || 'system'), null] };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        if (!res.ok) { Utilities.showToast(String(res.error || 'Failed to update note'), 'error'); return; }
        Utilities.showToast('Note updated', 'success');
        this.cancelEdit();
        if (this.applicant && this.applicant.id) this.loadNotes(this.applicant.id);
      },
      error: err => { console.error('[ApplicantPanel] updateNote error', err); Utilities.showToast('Failed to update note', 'error'); },
      complete: () => { this.notesSaving = false; }
    });
  }

  deleteNote(n: any): void {
    const noteId = n?.id ?? n?.id_note ?? n?.id_applicant_note ?? n?.id_note_applicant ?? null;
    if (!noteId) { Utilities.showToast('Note id not found', 'warning'); return; }
    void Swal.fire({ title: 'Delete note?', text: 'This will remove the note permanently.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Delete', cancelButtonText: 'Cancel' }).then(result => {
      if (!result.isConfirmed) return;
      this.notesSaving = true;
      const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_applicants_notes_crud, parameters: ['D', noteId, this.applicant?.id ?? null, null, null, (this.authSession.user?.user || 'system'), null] };
      this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
        next: res => {
          if (!res.ok) { Utilities.showToast(String(res.error || 'Failed to delete note'), 'error'); return; }
          Utilities.showToast('Note deleted', 'success');
          if (this.applicant && this.applicant.id) this.loadNotes(this.applicant.id);
        },
        error: err => { console.error('[ApplicantPanel] deleteNote error', err); Utilities.showToast('Failed to delete note', 'error'); },
        complete: () => { this.notesSaving = false; }
      });
    });
  }

  /** Confirm with the user and then move applicant to a specific stage id */
  moveToStage(stageId: number | null, note?: string): void {
    if (!this.applicant || !this.applicant.id) {
      Utilities.showToast('Applicant id not found', 'warning');
      return;
    }
    if (!stageId) {
      Utilities.showToast('Invalid target stage', 'warning');
      return;
    }

    // Find stage name for nicer confirmation text
    const stage = this.stageMenuOptions.find(s => Number(s.id) === Number(stageId));
    const stageName = stage?.name ?? 'selected stage';
    const applicantName = (this.applicant?.name ?? '').toString() || 'applicant';

    void Swal.fire({
      title: 'Move applicant?',
      text: `Move ${applicantName} to ${stageName}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Move',
      cancelButtonText: 'Cancel'
    }).then(result => {
      if (result.isConfirmed) {
        this.performMoveToStage(stageId, note);
      }
    });
  }

  /** Internal: perform the backend call to record the stage history */
  private performMoveToStage(stageId: number | null, note?: string): void {
    if (!this.applicant || !this.applicant.id) return;
    const movedBy = (this.authSession.user?.user) || 'system';
    const params = ['C', null, this.applicant.id, stageId, null, (note ?? null), movedBy, null];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_applicants_stages_history_crud, parameters: params };
    this.movingStage = true;
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        if (!res.ok) {
          Utilities.showToast(String(res.error || 'Failed to move applicant'), 'error');
          return;
        }
        Utilities.showToast('Applicant moved', 'success');
        this.closeMenus();
        // reload notes/history for visibility
        if (this.applicant && this.applicant.id) this.loadNotes(this.applicant.id);
        // notify parent to refresh lists if needed
        this.stageMoved.emit({ idApplicant: this.applicant.id, toStageId: Number(stageId) });
      },
      error: err => {
        console.error('[ApplicantPanel] performMoveToStage error', err);
        Utilities.showToast('Failed to move applicant', 'error');
      },
      complete: () => { this.movingStage = false; }
    });
  }

  /** Move applicant to the next stage based on availableStages' sort order */
  moveToNextStage(): void {
    const options = (this.availableStages ?? []).slice().sort((a,b)=> (a.sort_order ?? a.sortOrder ?? 0) - (b.sort_order ?? b.sortOrder ?? 0));
    if (!options || options.length === 0) { Utilities.showToast('No stage options available', 'warning'); return; }
    const currentId = Number(this.currentStageId ?? this.applicant?.stageId ?? this.applicant?.raw?.id_stage ?? this.applicant?.raw?.stage_id ?? 0);
    let idx = options.findIndex((s:any) => Number(s.id_stage ?? s.id ?? s.idStage ?? 0) === currentId);
    if (idx < 0) idx = -1; // treat as before first
    const next = options[idx + 1] ?? null;
    if (!next) { Utilities.showToast('No next stage available', 'info'); return; }
    const nextId = Number(next.id_stage ?? next.id ?? next.idStage ?? 0);
    this.moveToStage(nextId);
  }

  /** Move applicant to Rejected stage if present (by name 'Rejected' case-insensitive) */
  rejectApplicant(): void {
    const options = (this.availableStages ?? []);
    const rejected = options.find((s:any) => String(s.name || '').toLowerCase() === 'rejected')
      || options.find((s:any) => (String(s.name || '').toLowerCase()).includes('reject'));
    if (!rejected) { Utilities.showToast('No Rejected stage configured', 'warning'); return; }
    const rid = Number(rejected.id_stage ?? rejected.id ?? rejected.idStage ?? 0);
    this.moveToStage(rid);
  }

  // Wrapper to invoke move with permission check so confirmation modal always runs when allowed
  onStageClick(stageId: number | null): void {
    if (!this.canMove()) {
      Utilities.showToast('You do not have permission to move applicants', 'warning');
      return;
    }
    this.moveToStage(stageId);
  }

  onMoveNextClick(): void {
    if (!this.canMove()) {
      Utilities.showToast('You do not have permission to move applicants', 'warning');
      return;
    }
    this.moveToNextStage();
  }

  onRejectClick(): void {
    if (!this.canMove()) {
      Utilities.showToast('You do not have permission to move applicants', 'warning');
      return;
    }
    this.rejectApplicant();
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

