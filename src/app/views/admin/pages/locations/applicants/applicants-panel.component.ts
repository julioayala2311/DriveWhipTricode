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
  @ViewChild('messagesScroll', { static: false }) messagesScroll?: ElementRef<HTMLDivElement>;
  private authSession = inject(AuthSessionService);
  @Input() applicant: any;
  @Input() applicantId: string | null = null;
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
  @Input() status: ApplicantStatus | null = null;
  @Input() statuses: Array<ApplicantStatus & { order?: number }> | null = null;
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
  applicantDetailsLoading = false;
  applicantDetailsError: string | null = null;
  // Answers (registration)
  answersLoading = false;
  answersError: string | null = null;
  answers: Array<{ id_question?: any; answer_text?: string; answered_at?: any; created_at?: any }> = [];
  showAllAnswers = false;
  private lastLoadedApplicantId: string | null = null;
  // Documents (files)
  docsLoading = false;
  docsError: string | null = null;
  documentGroups: DocumentGroup[] = [];
  private docsLoadedForApplicantId: string | null = null;
  // Copy tooltip state
  copyFeedbackKey: string | null = null;
  private _copyFeedbackTimer: any = null;
  // Image viewer state
  imageViewerOpen = false;
  viewerDocs: ApplicantDocument[] = [];
  viewerIndex = 0;
  viewerCurrentUrl: string = '';
  viewerLoading = false;
  viewerZoom = 1;
  viewerRotate = 0;
  // Panning state for image viewer
  isPanning = false;
  viewerPanX = 0;
  viewerPanY = 0;
  private _panLastX = 0;
  private _panLastY = 0;

  // Chat (SMS) state
  chatLoading = false;
  chatSending = false;
  chatError: string | null = null;
  chatPage = 1;
  private chatLoadedForApplicantId: string | null = null;

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
    const applicantId = this.resolveApplicantId(this.applicant);
    if (!applicantId) { Utilities.showToast('Applicant id missing', 'warning'); return; }
    const payload = { ...this.editableApplicant };
    this.applicantSaving = true;

   // console.log(payload);

    const fullName = (payload.name ?? '').toString().trim();
    const firstName = (payload.first_name ?? this.applicant?.first_name ?? fullName.split(' ').shift() ?? '').toString().trim();
    const lastName = (payload.last_name ?? this.applicant?.last_name ?? fullName.split(' ').slice(1).join(' ')).toString().trim();
    const email = (payload.email ?? this.applicant?.email ?? '').toString().trim();
    const phone = (payload.phone ?? '').toString().trim();
    const referral = payload.referral_name ?? this.applicant?.referral_name ?? null;
    const acceptTerms = payload.accept_terms ?? this.applicant?.accept_terms ?? false;
    const allowMsgUpdates = payload.allow_msg_updates ?? this.applicant?.allow_msg_updates ?? false;
    const allowCalls = payload.allow_calls ?? this.applicant?.allow_calls ?? false;
    const isActive = payload.is_active ?? this.applicant?.is_active ?? true;
    const countryCode = payload.country_code ?? this.applicant?.country_code ?? null;
    const stateCode = payload.state_code ?? this.applicant?.state_code ?? null;
    const street = payload.street ?? this.applicant?.street ?? null;
    const city = payload.city ?? this.applicant?.city ?? null;
    const zip = payload.zip_code ?? this.applicant?.zip_code ?? null;
    const createdBy = this.applicant?.created_by ?? this.currentUserIdentifier();
    const updatedBy = this.currentUserIdentifier();

    try {
      const params: any[] = [
        'U',
        applicantId,
        firstName || null,
        lastName || null,
        email || null,
        phone || null,
        referral || null,
        acceptTerms ? 1 : 0,
        allowMsgUpdates ? 1 : 0,
        allowCalls ? 1 : 0,
        isActive ? 1 : 0,
        countryCode || null,
        stateCode || null,
        street || null,
        city || null,
        zip || null,
        createdBy || null,
        updatedBy || null
      ];
      const api: IDriveWhipCoreAPI = {
        commandName: DriveWhipAdminCommand.crm_applicants_crud as any,
        parameters: params
      } as any;
      this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
        next: res => {
          if (!res.ok) { Utilities.showToast(String(res.error || 'Failed to save applicant'), 'error'); return; }
          Utilities.showToast('Applicant saved', 'success');
          this.isEditingApplicant = false;
          this.loadApplicantDetails(applicantId);
          this.applicantSaved.emit({ id: applicantId, payload: { ...this.applicant, ...payload } });
        },
        error: err => {
          console.error('[ApplicantPanel] saveApplicant error', err);
          Utilities.showToast('Failed to save applicant', 'error');
          this.applicantSaving = false;
        },
        complete: () => { this.applicantSaving = false; }
      });
    } catch (e) {
      console.error('[ApplicantPanel] saveApplicant unexpected error', e);
      Utilities.showToast('Failed to save applicant', 'error');
      this.applicantSaving = false;
    }
  }

  private currentUserIdentifier(): string {
    try {
      const user: any = this.authSession.user;
      if (!user) return 'system';
      return user.user;
    } catch {
      return 'system';
    }
  }

  private readonly fallbackMessages: ApplicantMessage[] = [
    {
      id: 'msg-1',
      direction: 'inbound',
      sender: 'Whip',
      body: 'Hi {{ applicant.first_name }} {{ applicant.last_name }}, your Whip is almost here! Finish your app now - full coverage, free maintenance, and unlimited miles included.',
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
    if (changes['applicant'] || changes['applicantId']) {
      this.openSections = new Set<string>(this.defaultSectionIds);
      this.closeMenus();
      // prepare editable copy for inline editing
      this.editableApplicant = this.applicant ? { ...this.applicant } : {};
      // load notes for this applicant when panel opens / applicant changes
      const idFromApplicant = this.resolveApplicantId(this.applicant);
      const id = (this.applicantId || idFromApplicant || null) as string | null;
      if (id) {
        this.loadNotes(id);
      } else {
        this.notes = [];
      }
      if (id && id !== this.lastLoadedApplicantId) {
        this.loadApplicantDetails(id);
        // If opening with only ID, ensure there is a lightweight stub so header and info placeholders render
        if (!this.applicant) {
          this.applicant = { id };
        }
        // Reset docs cache when applicant changes
        this.docsLoadedForApplicantId = null;
      }
      // If Files tab is active, load documents for current applicant id
      if (this.activeTab === 'files' && id) {
        this.loadApplicantDocuments(id);
      }
      // If Messages tab is active, load chat history
      if (this.activeTab === 'messages' && id) {
        this.loadChatHistory(id, 1);
      }
    }
    if (changes['availableStages']) {
      this.stageMenuOpen = false;
    }
    // Load documents when switching into Files tab and we have an applicant id
    if (changes['activeTab'] && this.activeTab === 'files') {
      const idFromApplicant = this.resolveApplicantId(this.applicant);
      const id = (this.applicantId || idFromApplicant || null) as string | null;
      if (id) {
        this.loadApplicantDocuments(id);
      }
    }
    // Load chat when switching into Messages tab
    if (changes['activeTab'] && this.activeTab === 'messages') {
      const idFromApplicant = this.resolveApplicantId(this.applicant);
      const id = (this.applicantId || idFromApplicant || null) as string | null;
      if (id) {
        this.loadChatHistory(id, 1);
      }
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
    if (this.imageViewerOpen) {
      this.closeImageViewer();
      return;
    }
    this.closeMenus();
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(ev: KeyboardEvent): void {
    if (!this.imageViewerOpen) return;
    const key = ev.key.toLowerCase();
    if (key === 'arrowright') { ev.preventDefault(); this.nextImage(); }
    else if (key === 'arrowleft') { ev.preventDefault(); this.prevImage(); }
    else if (key === '+') { ev.preventDefault(); this.zoomIn(); }
    else if (key === '-') { ev.preventDefault(); this.zoomOut(); }
    else if (key === '0') { ev.preventDefault(); this.resetZoom(); }
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(ev: MouseEvent): void {
    if (!this.imageViewerOpen || !this.isPanning) return;
    const x = ev.clientX;
    const y = ev.clientY;
    const dx = x - this._panLastX;
    const dy = y - this._panLastY;
    this.viewerPanX += dx;
    this.viewerPanY += dy;
    this._panLastX = x;
    this._panLastY = y;
    ev.preventDefault();
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void { if (this.isPanning) this.isPanning = false; }

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

  /** Submit and send an SMS chat message via API, then reload chat history */
  onSendMessage(ev: Event): void {
    ev.preventDefault();
    const text = (this.draftMessage || '').trim();
    const id = this.resolveApplicantId(this.applicant) || this.applicantId;
    const to = this.getApplicantPhone(this.applicant);
    if (!text) { return; }
    if (!id) { Utilities.showToast('Applicant id not found', 'warning'); return; }
    if (!to) { Utilities.showToast('Applicant phone not found', 'warning'); return; }
    if (this.chatSending) return;
    // Optimistic message so user sees it immediately
    const optimistic: ApplicantMessage = {
      id: 'temp-' + Date.now(),
      direction: 'outbound',
      sender: 'You',
      body: text,
      timestamp: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()),
      channel: 'SMS',
      status: 'sending',
      statusLabel: 'Sending',
      automated: false,
      dayLabel: ''
    };
    this.messages = [...(this.messages ?? []), optimistic];
    this.refreshResolvedMessages();
    this.scrollMessagesToBottomSoon();

    this.chatSending = true;
    const fromNumber = '8774142766';
    this.core.sendChatSms({ from: fromNumber, to, message: text, id_applicant: String(id) }).subscribe({
      next: (_res) => {
        // Clear composer, mark optimistic as delivered and refresh history (force) after a tiny delay
        this.draftMessage = '';
        this.markOptimisticDelivered(optimistic.id!);
        this.scrollMessagesToBottomSoon();
        setTimeout(() => {
          this.loadChatHistory(String(id), 1, true);
          // extra cleanup shortly after to catch late-arriving persistence
          setTimeout(() => {
            try {
              const outboundBodies = new Set((this.messages || []).filter(m => (m.id||'').toString().startsWith('temp-') === false && m.direction==='outbound').map(m => (m.body||'').toString().trim()));
              this.messages = (this.messages || []).filter(m => !( (m.id||'').toString().startsWith('temp-') && outboundBodies.has((m.body||'').toString().trim()) ));
              this.refreshResolvedMessages();
            } catch {}
          }, 400);
        }, 350);
        Utilities.showToast('Message sent', 'success');
      },
      error: (err) => {
        console.error('[ApplicantPanel] sendChatSms error', err);
        Utilities.showToast('Failed to send message', 'error');
        this.removeOptimistic(optimistic.id!);
      },
      complete: () => { this.chatSending = false; }
    });
  }

  private getApplicantPhone(applicant: any): string | null {
    if (!applicant) return null;
    const phone = applicant.phone_number || applicant.phone || null;
    return phone ? String(phone) : null;
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

  get resolvedStatus(): ApplicantStatus | null {
    // Prefer the applicant object if it already has status
    const appStatus = this.applicant?.status as ApplicantStatus | undefined;
    if (appStatus && (appStatus.stage || appStatus.statusName)) return appStatus;
    // Fallback to input status from grid
    const inStatus = this.status as ApplicantStatus | null;
    if (inStatus && (inStatus.stage || inStatus.statusName)) return inStatus;
    // Build minimal status from available inputs
    const stage = this.displayStage || '';
    if (!stage) return null;
    const statusName = 'incomplete';
    return { stage, statusName, isComplete: false } as ApplicantStatus;
  }

  /** Returns a deduplicated list of statuses to render as badges, similar to the grid column logic. */
  get resolvedStatuses(): Array<ApplicantStatus & { order?: number }> {
    // Priority: explicit input -> applicant.statuses -> single resolvedStatus
    const src = (Array.isArray(this.statuses) && this.statuses.length)
      ? this.statuses
      : (Array.isArray((this.applicant as any)?.statuses) && (this.applicant as any).statuses.length
        ? (this.applicant as any).statuses as Array<ApplicantStatus & { order?: number }>
        : (this.resolvedStatus ? [this.resolvedStatus] : []));
    if (!Array.isArray(src) || !src.length) return [] as any;
    // Deduplicate keeping last occurrence
    const seen = new Set<string>();
    const result: Array<ApplicantStatus & { order?: number }> = [];
    for (let i = src.length - 1; i >= 0; i--) {
      const it: any = src[i] || {};
      const stage = String(it.stage || '').toLowerCase();
      const statusName = String(it.statusName || (it.isComplete ? 'complete' : 'incomplete')).toLowerCase();
      const key = `${stage}|${statusName}|${(it as any).order ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        const orderVal = typeof (it as any).order === 'number' ? (it as any).order : undefined;
        result.unshift({ stage: it.stage || 'Stage', statusName: statusName || 'incomplete', isComplete: !!it.isComplete, order: orderVal });
      }
    }
    return result;
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

  private resolveApplicantId(applicant: any): string | null {
    if (!applicant) return null;
    return (applicant.id ?? applicant.id_applicant ?? applicant.ID_APPLICANT ?? applicant.uuid ?? applicant.guid ?? null) ? String(applicant.id ?? applicant.id_applicant ?? applicant.ID_APPLICANT ?? applicant.uuid ?? applicant.guid) : null;
  }

  private loadApplicantDetails(applicantId: string): void {
    this.applicantDetailsLoading = true;
    this.applicantDetailsError = null;
    const params: any[] = [
      'R',
      applicantId,
      null, null, null, null, null, null, null, null, null,
      null, null, null, null, null,
      null, null
    ];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_crud as any,
      parameters: params
    } as any;

    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: res => {
        console.log('[ApplicantPanel] loadApplicantDetails response', res);
        if (!res.ok) {
          const err = String(res.error || 'Failed to load applicant details');
          this.applicantDetailsError = err;
          Utilities.showToast(err, 'error');
          this.applicantDetailsLoading = false;
          return;
        }
        const record = this.extractSingleRecord(res.data);
        if (record) {
          this.applyApplicantRecord(record);
          this.lastLoadedApplicantId = applicantId;
          this.applicantDetailsLoading = false;
          this.applicantDetailsError = null;
        } else {
          this.applicantDetailsError = 'Applicant not found';
          this.applicantDetailsLoading = false;
        }
      },
      error: err => {
        console.error('[ApplicantPanel] loadApplicantDetails error', err);
        this.applicantDetailsError = 'Failed to load applicant details';
        Utilities.showToast(this.applicantDetailsError, 'error');
        this.applicantDetailsLoading = false;
      },
      complete: () => {
        this.editableApplicant = this.applicant ? { ...this.applicant } : {};
      }
    });
    // Load answers in parallel
    this.loadApplicantAnswers(applicantId);
  }

  private loadApplicantAnswers(applicantId: string): void {
    this.answersLoading = true;
    this.answersError = null;
    this.answers = [];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_answers_registration as any,
      parameters: [ applicantId ]
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.answers = [];
          this.answersError = String(res?.error || 'Failed to load answers');
          return;
        }
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const list = Array.isArray(raw) ? raw : [];
        this.answers = list.map((r:any) => ({
          id_question: r.id_question ?? r.ID_QUESTION ?? null,
          answer_text: r.answer_text ?? r.ANSWER_TEXT ?? '',
          answered_at: r.answered_at ?? r.ANSWERED_AT ?? null,
          created_at: r.created_at ?? r.CREATED_AT ?? null
        }));
      },
      error: (err) => {
        console.error('[ApplicantPanel] loadApplicantAnswers error', err);
        this.answers = [];
        this.answersError = 'Failed to load answers';
      },
      complete: () => { this.answersLoading = false; }
    });
  }

  /** Load documents for applicant and build groups by data_key */
  private loadApplicantDocuments(applicantId: string): void {
    if (!applicantId) return;
    if (this.docsLoadedForApplicantId === applicantId && this.documentGroups && this.documentGroups.length) return;
    this.docsLoading = true;
    this.docsError = null;
    this.documentGroups = [];
    const params: any[] = [
      'R',
      null,                 // p_id_applicant_document 
      applicantId,       // p_id_applicant
      null, null, null,  // p_data_key, p_document_name, p_status
      null, null,        // p_approved_at, p_approved_by
      null, null         // p_disapproved_at, p_disapproved_by
    ];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_documents_crud as any,
      parameters: params
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.docsError = String(res?.error || 'Failed to load files');
          this.documentGroups = [];
          return;
        }
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const rows = Array.isArray(raw) ? raw : [];
        const docs: ApplicantDocument[] = rows.map(r => this.normalizeDocRecord(r)).filter(Boolean) as ApplicantDocument[];
        // attach S3 URL
        for (const d of docs) {
          this.core.fetchFile(d.folder || '', d.document_name || '').subscribe({
            next: (response) => {
              d.url = response.data.url;
            },
            error: (err) => {
              console.error('[ApplicantPanel] fetchFile error', err);
            }
          });
        }
        this.documentGroups = this.groupDocuments(docs);
        this.docsLoadedForApplicantId = applicantId;
      },
      error: (err) => {
        console.error('[ApplicantPanel] loadApplicantDocuments error', err);
        this.docsError = 'Failed to load files';
        this.documentGroups = [];
      },
      complete: () => { this.docsLoading = false; }
    });
  }

  /** Load SMS chat history for the applicant using SP crm_applicant_chat_history */
  private loadChatHistory(applicantId: string, page: number = 1, force: boolean = false): void {
    if (!applicantId) return;
    if (!force && this.chatLoadedForApplicantId === applicantId && this.chatPage === page && this._resolvedMessages.length) return;
    this.chatLoading = true;
    this.chatError = null;
    this.chatPage = page;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicant_chat_history as any,
      parameters: [applicantId, page]
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.chatError = String(res?.error || 'Failed to load chat');
          this.messages = [];
          this.refreshResolvedMessages();
          return;
        }
        let rows: any[] = [];
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        rows = Array.isArray(raw) ? raw : [];
        // Normalize and reverse to chronological order (oldest first)
        const normalized = rows.map(r => this.normalizeChatRecord(r));
        const chronological = normalized.slice().reverse();
        // Keep any optimistic messages that are still temp but only if there isn't a matching persisted outbound with same body
        const optimistic = (this.messages || []).filter(m => (m.id || '').toString().startsWith('temp-'));
        const outboundBodies = new Set(
          chronological.filter(m => m.direction === 'outbound').map(m => (m.body || '').toString().trim())
        );
        const keepOptimistic = optimistic.filter(m => !outboundBodies.has((m.body || '').toString().trim()));
        this.messages = [...chronological, ...keepOptimistic];
        this.refreshResolvedMessages();
        this.chatLoadedForApplicantId = applicantId;
        this.scrollMessagesToBottomSoon();
      },
      error: (err) => {
        console.error('[ApplicantPanel] loadChatHistory error', err);
        this.chatError = 'Failed to load chat';
        this.messages = [];
        this.refreshResolvedMessages();
      },
      complete: () => { this.chatLoading = false; }
    });
  }

  private normalizeChatRecord(r: any): ApplicantMessage {
    const directionRaw = (r.Direction ?? r.message_direction ?? '').toString().toLowerCase();
    const direction: 'inbound' | 'outbound' = directionRaw === 'outbound' ? 'outbound' : 'inbound';
    const body = String(r.Message ?? r.message_text ?? '');
    const sent = r.Sent ?? r.sent_at ?? r.create ?? r.created_at ?? null;
    const ts = sent ? new Date(sent) : null;
    const timeLabel = ts && !Number.isNaN(ts.getTime()) ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(ts) : '';
    return {
      id: String(r.ID ?? r.id_chat ?? ''),
      direction,
      // sender: direction === 'outbound' ? 'You' : (this.applicant?.first_name || 'Applicant'),
      sender: direction === 'outbound' ? '' : (this.applicant?.first_name || 'Applicant'),
      body,
      timestamp: timeLabel,
      channel: 'SMS',
      status: undefined,
      statusLabel: undefined,
      automated: false,
      dayLabel: ''
    };
  }

  private markOptimisticDelivered(tempId: string): void {
    if (!this.messages || !tempId) return;
    this.messages = this.messages.map(m => (m.id === tempId ? { ...m, status: 'delivered' as any, statusLabel: 'Delivered' } : m));
    // If a non-temp outbound with same body exists, drop the temp one to avoid duplicates
    const temp = this.messages.find(m => m.id === tempId);
    if (temp && temp.direction === 'outbound') {
      const hasPersisted = this.messages.some(m => (m.id || '').toString().startsWith('temp-') === false && m.direction === 'outbound' && (m.body || '').toString().trim() === (temp.body || '').toString().trim());
      if (hasPersisted) {
        this.messages = this.messages.filter(m => m.id !== tempId);
      }
    }
    this.refreshResolvedMessages();
  }

  private removeOptimistic(tempId: string): void {
    if (!this.messages || !tempId) return;
    this.messages = this.messages.filter(m => m.id !== tempId);
    this.refreshResolvedMessages();
  }

  private scrollMessagesToBottomSoon(): void {
    setTimeout(() => {
      try {
        const el = this.messagesScroll?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      } catch {}
    }, 50);
  }

  private normalizeDocRecord(r: any): ApplicantDocument {
    return {
      id_applicant_document: Number(r.id_applicant_document ?? r.ID_APPLICANT_DOCUMENT ?? r.id ?? 0),
      id_applicant: String(r.id_applicant ?? r.ID_APPLICANT ?? r.idApplicant ?? ''),
      data_key: String(r.data_key ?? r.DATA_KEY ?? ''),
      document_name: String(r.document_name ?? r.DOCUMENT_NAME ?? ''),
      status: (r.status ?? r.STATUS ?? null) ? String(r.status ?? r.STATUS) : null,
      created_at: r.created_at ?? r.CREATED_AT ?? null,
      approved_at: r.approved_at ?? r.APPROVED_AT ?? null,
      approved_by: r.approved_by ?? r.APPROVED_BY ?? null,
      disapproved_at: r.disapproved_at ?? r.DISAPPROVED_AT ?? null,
      disapproved_by: r.disapproved_by ?? r.DISAPPROVED_BY ?? null,
      folder: r.folder ?? r.FOLDER ?? null,
      url: ''
    };
  }

  private groupDocuments(docs: ApplicantDocument[]): DocumentGroup[] {
    const map = new Map<string, ApplicantDocument[]>();
    for (const d of docs) {
      const key = d.data_key || 'Files';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    // sort docs by created_at desc inside each group
    const groups: DocumentGroup[] = Array.from(map.entries()).map(([dataKey, items]) => ({
      dataKey,
      items: items.slice().sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      })
    }));
    // sort groups alphabetically by dataKey
    groups.sort((a, b) => a.dataKey.localeCompare(b.dataKey));
    return groups;
  }

  private isImageDocument(doc: ApplicantDocument | null | undefined): boolean {
    if (!doc) return false;
    const name = (doc.document_name || '').toLowerCase();
    return /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.bmp|\.svg)$/.test(name);
  }

  /** Open the in-app image viewer for the selected group/doc (falls back to openDocument for non-images) */
  openImageViewer(group: DocumentGroup, doc?: ApplicantDocument, ev?: Event): void {
    try {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      const images = (group?.items || []).filter(d => this.isImageDocument(d));
      if (!images.length) {
        // No images in this group, fallback to open in new tab if doc provided
        if (doc) { this.openDocument(doc); }
        return;
      }
      const startId = doc?.id_applicant_document;
      const idx = startId ? Math.max(0, images.findIndex(d => d.id_applicant_document === startId)) : 0;
      this.viewerDocs = images;
      this.viewerIndex = idx >= 0 ? idx : 0;
      this.viewerZoom = 1;
      this.viewerRotate = 0;
  this.viewerPanX = 0; this.viewerPanY = 0;
      this.imageViewerOpen = true;
      this.loadViewerUrl();
    } catch (e) {
      console.error('[ApplicantPanel] openImageViewer error', e);
    }
  }

  loadViewerUrl(): void {
    const cur = this.viewerDocs[this.viewerIndex];
    if (!cur) { this.viewerCurrentUrl = ''; return; }
    this.viewerLoading = true;
    this.core.fetchFile(cur.folder || '', cur.document_name || '').subscribe({
      next: (resp: any) => {
        const fresh = resp?.data?.url || cur.url || '';
        cur.url = fresh;
        this.viewerCurrentUrl = fresh;
        this.viewerLoading = false;
        // reset pan each time we load a new image
        this.viewerPanX = 0;
        this.viewerPanY = 0;
        // Optional: preload next
        const next = this.viewerDocs[this.viewerIndex + 1];
        if (next) {
          this.core.fetchFile(next.folder || '', next.document_name || '').subscribe({ next: (r:any)=> { next.url = r?.data?.url || next.url || ''; }, error: ()=>{} });
        }
      },
      error: (err) => {
        console.error('[ApplicantPanel] loadViewerUrl error', err);
        this.viewerLoading = false;
        Utilities.showToast('Unable to load image', 'error');
      }
    });
  }

  nextImage(): void {
    if (!this.viewerDocs.length) return;
    this.viewerIndex = (this.viewerIndex + 1) % this.viewerDocs.length;
    this.viewerZoom = 1; this.viewerRotate = 0; this.viewerPanX = 0; this.viewerPanY = 0;
    this.loadViewerUrl();
  }

  prevImage(): void {
    if (!this.viewerDocs.length) return;
    this.viewerIndex = (this.viewerIndex - 1 + this.viewerDocs.length) % this.viewerDocs.length;
    this.viewerZoom = 1; this.viewerRotate = 0; this.viewerPanX = 0; this.viewerPanY = 0;
    this.loadViewerUrl();
  }

  closeImageViewer(): void {
    this.imageViewerOpen = false;
    this.viewerCurrentUrl = '';
    this.viewerDocs = [];
    this.viewerIndex = 0;
    this.viewerZoom = 1;
    this.viewerRotate = 0;
    this.viewerPanX = 0; this.viewerPanY = 0; this.isPanning = false;
  }

  zoomIn(): void { this.viewerZoom = Math.min(this.viewerZoom + 0.25, 5); }
  zoomOut(): void {
    this.viewerZoom = Math.max(this.viewerZoom - 0.25, 0.25);
    if (this.viewerZoom <= 1) { this.viewerPanX = 0; this.viewerPanY = 0; }
  }
  resetZoom(): void { this.viewerZoom = 1; this.viewerRotate = 0; this.viewerPanX = 0; this.viewerPanY = 0; }
  rotateClockwise(): void { this.viewerRotate = (this.viewerRotate + 90) % 360; }

  onViewerMouseDown(ev: MouseEvent): void {
    if (!this.imageViewerOpen || this.viewerZoom <= 1) return;
    this.isPanning = true;
    this._panLastX = ev.clientX;
    this._panLastY = ev.clientY;
    ev.preventDefault();
  }

  onViewerTouchStart(ev: TouchEvent): void {
    if (!this.imageViewerOpen || this.viewerZoom <= 1) return;
    if (ev.touches && ev.touches.length > 0) {
      const t = ev.touches[0];
      this.isPanning = true;
      this._panLastX = t.clientX;
      this._panLastY = t.clientY;
      ev.preventDefault();
    }
  }

  onViewerTouchMove(ev: TouchEvent): void {
    if (!this.imageViewerOpen || !this.isPanning) return;
    if (ev.touches && ev.touches.length > 0) {
      const t = ev.touches[0];
      const dx = t.clientX - this._panLastX;
      const dy = t.clientY - this._panLastY;
      this.viewerPanX += dx;
      this.viewerPanY += dy;
      this._panLastX = t.clientX;
      this._panLastY = t.clientY;
      ev.preventDefault();
    }
  }

  onViewerTouchEnd(_ev: TouchEvent): void { if (this.isPanning) this.isPanning = false; }

  downloadDocument(doc: ApplicantDocument): void {
    try {
      const name = doc.document_name || 'download';
      // Always fetch a fresh signed URL to avoid 403 due to short-lived tokens
      this.core.fetchFile(doc.folder || '', doc.document_name || '').subscribe({
        next: (response: any) => {
          const freshUrl = response?.data?.url || doc.url || this.core.getFileUrl(String(doc.folder || ''), String(doc.document_name || ''));
          if (!freshUrl) { Utilities.showToast('File URL not available', 'warning'); return; }
          this.forceDownload(freshUrl, name);
        },
        error: (err) => {
          console.error('[ApplicantPanel] downloadDocument fetchFile error', err);
          Utilities.showToast('Unable to download file', 'error');
        }
      });
    } catch {
      Utilities.showToast('Unable to download file', 'error');
    }
  }

  /** Open the document in a new tab using a fresh signed URL (avoids stale links) */
  openDocument(doc: ApplicantDocument, ev?: Event): void {
    try {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      this.core.fetchFile(doc.folder || '', doc.document_name || '').subscribe({
        next: (response: any) => {
          const freshUrl = response?.data?.url || doc.url || this.core.getFileUrl(String(doc.folder || ''), String(doc.document_name || ''));
          if (!freshUrl) { Utilities.showToast('File URL not available', 'warning'); return; }
          // If it is an image, open in viewer; otherwise, open in new tab
          if (this.isImageDocument(doc)) {
            // Ensure list includes only this doc to avoid navigating to other groups unexpectedly
            this.viewerDocs = [ { ...doc, url: freshUrl } ];
            this.viewerIndex = 0;
            this.viewerZoom = 1; this.viewerRotate = 0; this.viewerPanX = 0; this.viewerPanY = 0;
            this.viewerCurrentUrl = freshUrl;
            this.imageViewerOpen = true;
          } else {
            window.open(freshUrl, '_blank', 'noopener');
          }
        },
        error: (err) => {
          console.error('[ApplicantPanel] openDocument fetchFile error', err);
          Utilities.showToast('Unable to open file', 'error');
        }
      });
    } catch {
      Utilities.showToast('Unable to open file', 'error');
    }
  }

  /** Refresh a document's signed URL (useful for preview <img> on error) */
  refreshDocUrl(doc: ApplicantDocument): void {
    try {
      this.core.fetchFile(doc.folder || '', doc.document_name || '').subscribe({
        next: (response: any) => { doc.url = response?.data?.url || doc.url || ''; },
        error: (err) => { console.warn('[ApplicantPanel] refreshDocUrl error', err); }
      });
    } catch { /* noop */ }
  }

  private async forceDownload(url: string, fileName: string): Promise<void> {
    try {
      // Use CORS-friendly fetch without credentials; many storage providers (e.g., S3)
      // will reject cross-origin requests with credentials, causing a redirect fallback.
      const res = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store' });
      if (!res.ok || res.status === 0) throw new Error(`HTTP ${res.status || 0}`);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
      }, 0);
    } catch (e) {
      // Fallback that avoids redirecting the current page: try loading in a hidden iframe.
      // If the server serves Content-Disposition: attachment, the browser will download it.
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = url;
        document.body.appendChild(iframe);
        // Clean up iframe later; if no download is triggered, this is a no-op
        setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* noop */ } }, 30000);
      } catch {
        Utilities.showToast('Download failed', 'error');
      }
    }
  }

  approveDocument(doc: ApplicantDocument): void {
    this.updateDocumentStatus(doc, 'APPROVED');
  }

  disapproveDocument(doc: ApplicantDocument): void {
    this.updateDocumentStatus(doc, 'DISAPPROVED');
  }

  private updateDocumentStatus(doc: ApplicantDocument, status: string): void {
    if (!doc || !doc.id_applicant_document) return;
    const now = new Date();
    const fmt = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,19).replace('T',' ');
    const approved_at = status.toUpperCase() === 'APPROVED' ? fmt(now) : null;
    const approved_by = status.toUpperCase() === 'APPROVED' ? this.currentUserIdentifier() : null;
    const disapproved_at = status.toUpperCase() === 'DISAPPROVED' ? fmt(now) : null;
    const disapproved_by = status.toUpperCase() === 'DISAPPROVED' ? this.currentUserIdentifier() : null;
    const params: any[] = [
      'U',
      doc.id_applicant_document,
      doc.id_applicant,
      null,
      null,
      status,
      approved_at,
      approved_by,
      disapproved_at,
      disapproved_by
    ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_applicants_documents_crud as any, parameters: params } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) { Utilities.showToast(String(res?.error || 'Failed to update document'), 'error'); return; }
        Utilities.showToast('Document updated', 'success');
        const id = this.resolveApplicantId(this.applicant) || this.applicantId;
        if (id) {
          // force reload
          this.docsLoadedForApplicantId = null;
          this.loadApplicantDocuments(String(id));
        }
      },
      error: (err) => { console.error('[ApplicantPanel] updateDocumentStatus error', err); Utilities.showToast('Failed to update document', 'error'); },
      complete: () => {}
    });
  }

  docStatusLabel(doc: ApplicantDocument): string {
    const s = (doc.status || '').toString().toUpperCase();
    if (s === 'APPROVED') return 'Approved';
    if (s === 'DISAPPROVED') return 'Disapproved';
    if (s === 'RECOLLECTING' || s === 'RE-COLLECTING') return 'Re-collecting File';
    return s ? s.charAt(0) + s.slice(1).toLowerCase() : 'Pending';
  }

  docStatusClass(doc: ApplicantDocument): string {
    const s = (doc.status || '').toString().toUpperCase();
    if (s === 'APPROVED') return 'text-success';
    if (s === 'DISAPPROVED') return 'text-danger';
    if (s === 'RECOLLECTING' || s === 'RE-COLLECTING') return 'text-warning';
    return 'text-secondary';
  }

  private extractSingleRecord(data: any): any | null {
    if (!data) return null;
    if (Array.isArray(data)) {
      if (data.length === 0) return null;
      if (Array.isArray(data[0])) {
        return data[0].length ? data[0][0] : null;
      }
      return data[0];
    }
    if (typeof data === 'object') return data;
    return null;
  }

  private applyApplicantRecord(record: any): void {
    if (!record) return;
    const normalized = this.normalizeApplicantRecord(record);
    this.applicant = { ...this.applicant, ...normalized };
    this.editableApplicant = { ...this.applicant };
  }

  private normalizeApplicantRecord(record: any): any {
    const firstName = this.coalesce(record.first_name, record.FIRST_NAME, record.firstName, '');
    const lastName = this.coalesce(record.last_name, record.LAST_NAME, record.lastName, '');
    const email = this.coalesce(record.email, record.EMAIL, '');
    const phone = this.coalesce(record.phone_number, record.PHONE_NUMBER, '');
    const id = this.coalesce(record.id_applicant, record.ID_APPLICANT, record.id, this.resolveApplicantId(record), this.resolveApplicantId(this.applicant));
    const countryCode = this.coalesce(record.country_code, record.COUNTRY_CODE, '');
    const stateCode = this.coalesce(record.state_code, record.STATE_CODE, '');
    const street = this.coalesce(record.street, record.STREET, '');
    const city = this.coalesce(record.city, record.CITY, '');
    const zip = this.coalesce(record.zip_code, record.ZIP_CODE, '');
    const createdAt = this.coalesce(record.created_at, record.CREATED_AT, null);
    const updatedAt = this.coalesce(record.updated_at, record.UPDATED_AT, null);
    const referral = this.coalesce(record.referral_name, record.REFERRAL_NAME, '');
    const acceptTerms = this.booleanize(record.accept_terms ?? record.ACCEPT_TERMS);
    const allowMsgUpdates = this.booleanize(record.allow_msg_updates ?? record.ALLOW_MSG_UPDATES);
    const allowCalls = this.booleanize(record.allow_calls ?? record.ALLOW_CALLS);
    const isActive = this.booleanize(record.is_active ?? record.IS_ACTIVE ?? true);

    const detailItems: { label: string; value: string }[] = [];
    const addDetail = (label: string, value: any) => {
      if (value === null || value === undefined || value === '') return;
      detailItems.push({ label, value: String(value) });
    };
    addDetail('Referral', referral);
    addDetail('Phone', phone);
    addDetail('Email', email);
    addDetail('Address', [street, city, stateCode, zip].filter(Boolean).join(', '));
    addDetail('Country', countryCode);
    addDetail('Accept terms', acceptTerms ? 'Yes' : 'No');
    addDetail('Allow messaging updates', allowMsgUpdates ? 'Yes' : 'No');
    addDetail('Allow calls', allowCalls ? 'Yes' : 'No');
    if (createdAt) addDetail('Created at', createdAt);
    if (updatedAt) addDetail('Updated at', updatedAt);

    return {
      id,
      id_applicant: id,
      first_name: firstName,
      last_name: lastName,
      name: [firstName, lastName].filter(Boolean).join(' ').trim() || (this.applicant?.name ?? ''),
      email,
      phone,
      phone_number: phone,
      referral_name: referral,
      accept_terms: acceptTerms,
      allow_msg_updates: allowMsgUpdates,
      allow_calls: allowCalls,
      is_active: isActive,
      country_code: countryCode,
      state_code: stateCode,
      street,
      city,
      zip_code: zip,
      created_at: createdAt,
      updated_at: updatedAt,
      details: detailItems,
      updated_by: record.updated_by ?? record.UPDATED_BY ?? this.applicant?.updated_by ?? null,
      created_by: record.created_by ?? record.CREATED_BY ?? this.applicant?.created_by ?? null
    };
  }

  private coalesce<T>(...values: T[]): T | null {
    for (const v of values) {
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  }

  private booleanize(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const lowered = value.toLowerCase();
      return lowered === '1' || lowered === 'true' || lowered === 'yes' || lowered === 'y';
    }
    return Boolean(value);
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
      // Interpolate any {{ ... }} placeholders using applicant fields (supports dotted paths)
      body = this.interpolateTemplate(body, { applicant: this.applicant || {} });
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

  // Simple template interpolation: replaces {{ path.to.value }} using values from ctx
  private interpolateTemplate(template: string, ctx: any): string {
    if (!template || typeof template !== 'string') return template as any;
    return template.replace(/{{\s*([\w\.]+)\s*}}/g, (_match, path) => {
      const value = this.resolvePath(ctx, path);
      return value !== undefined && value !== null ? String(value) : '';
    });
    }

  private resolvePath(obj: any, path: string): any {
    try {
      if (!obj || !path) return undefined;
      const parts = path.split('.');
      let cur = obj;
      for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    } catch {
      return undefined;
    }
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

interface ApplicantDocument {
  id_applicant_document: number;
  id_applicant: string;
  data_key: string;
  document_name: string;
  status: string | null;
  created_at?: any;
  approved_at?: any;
  approved_by?: string | null;
  disapproved_at?: any;
  disapproved_by?: string | null;
  folder?: string | null;
  url?: string;
}

interface DocumentGroup {
  dataKey: string;
  items: ApplicantDocument[];
}

