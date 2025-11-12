import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, ElementRef } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';
import { AppConfigService } from '../../../../core/services/app-config/app-config.service';
import { SmsChatSignalRService, ApplicantChatRealtimeMessage } from '../../../../core/services/signalr/sms-chat-signalr.service';
import { Utilities } from '../../../../Utilities/Utilities';

interface MessengerLocation {
  id: number;
  name: string;
  totalApplicants?: number;
}

interface MessengerChatThread {
  id_applicant: string;
  name_applicant: string;
  hours_since_last_message: string;
  last_message: string;
}

interface MessengerHistoryEvent {
  id: string;
  type: string;
  text: string;
  time: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  channel?: string | null;
  event_table?: string | null;
  id_event_table?: string | null;
  with_detail?: boolean;
  __timestamp?: number | null;
  previousStage?: string | null;
  newStage?: string | null;
  from?: string | null;
  to?: string | null;
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

@Component({
  selector: 'app-messenger',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './messenger.component.html',
  styleUrls: ['./messenger.component.scss']
})
export class MessengerComponent implements OnInit, OnDestroy {
  @ViewChild('messagesScroll') messagesScroll?: ElementRef<HTMLDivElement>;
  @ViewChild('historyDetailRef') historyDetailRef?: ElementRef<HTMLElement>;
  @ViewChild('historyDetailBody') historyDetailBody?: ElementRef<HTMLDivElement>;

  locations: MessengerLocation[] = [];
  locationsLoading = false;
  locationsError: string | null = null;

  chatThreads: MessengerChatThread[] = [];
  chatsLoading = false;
  chatsError: string | null = null;

  // UI filters and sorting
  locationSearch: string = '';
  threadSearch: string = '';
  threadSortOrder: 'newest' | 'oldest' = 'newest';

  selectedLocationId: number | null = null;
  selectedApplicantId: string | null = null;
  selectedApplicantName: string | null = null;

  draftMessage = '';
  activeTab: 'general' | 'messages' | 'history' | 'files' = 'general';

  private destroy$ = new Subject<void>();
  // Applicant detail / panel clone state
  applicant: any = null;
  applicantLoading = false;
  applicantError: string | null = null;

  // Notes (read-only in Messenger)
  notes: Array<any> = [];
  notesLoading = false;
  notesError: string | null = null;

  // Registration answers (Details) - read-only
  answersLoading = false;
  answersError: string | null = null;
  answers: Array<{ id_question?: any; answer_text?: string; answered_at?: any; created_at?: any; question?: string }>= [];

  // Chat (messages) state for cloned panel
  panelMessages: any[] = [];
  panelMessagesLoading = false;
  panelMessagesError: string | null = null;

  // Unread tracking (Option A - frontend only)
  private readonly UNREAD_STORAGE_KEY = 'dw.messenger.unread.map';
  private readonly LASTSEEN_STORAGE_KEY = 'dw.messenger.lastSeen.map';
  unreadByApplicant: Record<string, boolean> = {};
  private lastSeenByApplicant: Record<string, number> = {};

  // History state
  panelHistory: MessengerHistoryEvent[] = [];
  panelHistoryLoading = false;
  panelHistoryError: string | null = null;

  // Documents state
  documentGroups: DocumentGroup[] = [];
  panelDocsLoading = false;
  panelDocsError: string | null = null;

  // History detail sidebar state (mirrors Applicants panel behavior)
  eventSidebarOpen = false;
  selectedHistoryEvent: MessengerHistoryEvent | null = null;
  eventDetailLoading = false;
  eventDetailError: string | null = null;
  eventDetailText: string = '';
  eventDocLoading = false;
  eventDocError: string | null = null;
  eventDoc: ApplicantDocument | null = null;

  // Internal doc-preview loader control
  private _eventDocSub: Subscription | null = null;
  private _eventDocLoadSeq = 0;
  private _activeEventDocToken = 0;

  private _panelSubs: Subscription[] = [];
  private _scrollTimer: any;

  // Realtime chat
  private destroyRealtime$ = new Subject<void>();
  private currentRealtimePhone: string | null = null;
  chatSending = false;
  // Handle incoming navbar search (?q=...)
  private pendingThreadQuery: string | null = null;

  constructor(
    private core: DriveWhipCoreService,
    private appConfig: AppConfigService,
    private smsRealtime: SmsChatSignalRService,
    private sanitizer: DomSanitizer,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.loadUnreadFromStorage();
    this.loadLastSeenFromStorage();
    this.loadLocations();
    this.loadChats();
    // React to navbar search (?q=...) and auto-select a matching thread
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      try {
        const qRaw = params?.['q'];
        const q = (qRaw == null ? '' : String(qRaw)).trim();
        if (q) {
          this.pendingThreadQuery = q.toLowerCase();
          this.trySelectMatchingThread();
        } else {
          this.pendingThreadQuery = null;
        }
      } catch { /* ignore */ }
    });
    // Listen to global inbound notifications to flag threads as unread
    // (Navbar is responsible for joining the notifications group)
    this.smsRealtime
      .notifications()
      .pipe(takeUntil(this.destroy$))
      .subscribe((evt) => {
        try {
          const eid = (evt?.applicantId || '').toString();
          // Debug hint (opt-in): set sessionStorage.smsChatDebug='1' to see console logs
          try {
            if ((globalThis as any)?.sessionStorage?.getItem('smsChatDebug') === '1') {
              console.debug('[Messenger] Inbound notification for applicantId=', eid, evt);
            }
          } catch {}
          if (!eid) return;
          const isViewingThisApplicant = !!(
            this.selectedApplicantId &&
            this.selectedApplicantId.toString() === eid &&
            this.activeTab === 'messages'
          );
          if (!isViewingThisApplicant) {
            this.setUnread(eid, true);
            // If this applicant exists in the current chat list, bubble it up and update preview
            try {
              const idx = this.chatThreads.findIndex((t) => t.id_applicant === eid);
              if (idx >= 0) {
                const updated: MessengerChatThread = {
                  ...this.chatThreads[idx],
                  last_message: (evt?.body || '').toString()
                };
                const next = [...this.chatThreads];
                next.splice(idx, 1);
                this.chatThreads = [updated, ...next];
              }
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      });
  }

  /** If a navbar search query is present, select the first matching thread */
  private trySelectMatchingThread(): void {
    const q = (this.pendingThreadQuery || '').trim().toLowerCase();
    if (!q) return;
    const threads = this.chatThreads || [];
    if (!threads.length) return;

    // Sort helper by recency (same logic as filteredThreads)
    const toMinutes = (s: string | null | undefined): number => {
      const raw = (s || '').toString().trim().toLowerCase();
      if (!raw) return Number.POSITIVE_INFINITY;
      const m = raw.match(/^(\d+(?:\.\d+)?)\s*([hmd])$/i) || raw.match(/^(\d+(?:\.\d+)?)/);
      if (!m) return Number.POSITIVE_INFINITY;
      const val = parseFloat(m[1]);
      const unit = (m[2] || 'h').toLowerCase();
      if (!Number.isFinite(val)) return Number.POSITIVE_INFINITY;
      if (unit === 'm') return val; // minutes
      if (unit === 'd') return val * 24 * 60; // days to minutes
      return val * 60; // default hours to minutes
    };

    const byName = threads
      .filter((t) => (t?.name_applicant || '').toLowerCase().includes(q))
      .sort((a, b) => toMinutes(a?.hours_since_last_message) - toMinutes(b?.hours_since_last_message));

    const byLast = threads
      .filter((t) => (t?.last_message || '').toLowerCase().includes(q))
      .sort((a, b) => toMinutes(a?.hours_since_last_message) - toMinutes(b?.hours_since_last_message));

    const candidate = byName[0] || byLast[0];
    if (!candidate) return;

    if (this.selectedApplicantId !== candidate.id_applicant) {
      this.selectThread(candidate);
    }
    // Clear pending query so list remains unfiltered; user sees full list
    this.pendingThreadQuery = null;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.destroyRealtime$.next();
    this.destroyRealtime$.complete();
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = undefined as any;
    }
    // Best-effort: leave phone group on destroy
    if (this.currentRealtimePhone) {
      this.smsRealtime.leavePhone(this.currentRealtimePhone).catch(() => {});
      this.currentRealtimePhone = null;
    }
    try { this._eventDocSub?.unsubscribe(); } catch {}
    this._eventDocSub = null;
  }

  trackByLocation = (_: number, item: MessengerLocation) => item.id;
  trackByThread = (_: number, item: MessengerChatThread) => item.id_applicant;

  // Filtered views for lists
  get filteredLocations(): MessengerLocation[] {
    const q = (this.locationSearch || '').trim().toLowerCase();
    if (!q) return this.locations;
    return (this.locations || []).filter((l) => (l?.name || '').toLowerCase().includes(q));
  }

  get filteredThreads(): MessengerChatThread[] {
    const q = (this.threadSearch || '').trim().toLowerCase();
    const base = (this.chatThreads || []).filter((t) => {
      if (!q) return true;
      const name = (t?.name_applicant || '').toLowerCase();
      const last = (t?.last_message || '').toLowerCase();
      return name.includes(q) || last.includes(q);
    });
    // Sort by recency based on hours_since_last_message (supports h/m/d)
    const toMinutes = (s: string | null | undefined): number => {
      const raw = (s || '').toString().trim().toLowerCase();
      if (!raw) return Number.POSITIVE_INFINITY;
      const m = raw.match(/^(\d+(?:\.\d+)?)\s*([hmd])$/i) || raw.match(/^(\d+(?:\.\d+)?)/);
      if (!m) return Number.POSITIVE_INFINITY;
      const val = parseFloat(m[1]);
      const unit = (m[2] || 'h').toLowerCase();
      if (!Number.isFinite(val)) return Number.POSITIVE_INFINITY;
      if (unit === 'm') return val; // minutes
      if (unit === 'd') return val * 24 * 60; // days to minutes
      return val * 60; // default hours to minutes
    };
    base.sort((a, b) => {
      const am = toMinutes(a?.hours_since_last_message);
      const bm = toMinutes(b?.hours_since_last_message);
      return this.threadSortOrder === 'newest' ? am - bm : bm - am;
    });
    return base;
  }

  selectLocation(location: MessengerLocation): void {
    if (!location) return;
    this.selectedLocationId = location.id;
    // Future: pass location id once the SP supports filtering.
    this.loadChats();
  }

  selectThread(thread: MessengerChatThread): void {
    if (!thread) return;
    this.selectedApplicantId = thread.id_applicant;
    this.selectedApplicantName = thread.name_applicant;
  // Reset composer state so messaging starts fresh per applicant
  this.draftMessage = '';
  // Always land on General first
  this.activeTab = 'general';
    // Clear unread flag for this applicant as user is opening it
    this.clearUnread(thread.id_applicant);
    // Load cloned panel data
    this.loadApplicantContext(this.selectedApplicantId);
  }

  /** Returns the currently selected location name or null (used from template) */
  getSelectedLocationName(): string | null {
    try {
      const loc = this.locations.find((l) => l.id === this.selectedLocationId);
      return loc ? String(loc.name) : null;
    } catch {
      return null;
    }
  }

  refresh(): void {
    // Clear selected location highlight and reload without filter
    this.selectedLocationId = null;
    this.loadLocations(true);
    // Force NULL parameter to crm_applicants_chat_list_location on refresh
    this.loadChats(null);
  }

  onDraftMessageChange(value: string): void {
    this.draftMessage = value;
  }

  onTabChange(tab: 'general' | 'messages' | 'history' | 'files'): void {
    this.activeTab = tab;
    if (tab === 'messages') {
      // Always show the most recent messages at the bottom when returning to Messages
      this.scrollMessagesToBottomSoon(0, true);
      // Ensure realtime sub is active when viewing messages
      this.updatePhoneSubscription().catch(() => {});
      // Mark current thread as read when switching to Messages tab
      if (this.selectedApplicantId) {
        this.markThreadRead(this.selectedApplicantId);
      }
    }
    if (tab === 'files') {
      // Refresh files every time user returns to Files tab
      if (this.selectedApplicantId) {
        this.loadPanelDocuments(this.selectedApplicantId);
      }
    }
  }

  onClosePanel(): void {
    this.selectedApplicantId = null;
    this.selectedApplicantName = null;
    this.applicant = null;
    this.panelMessages = [];
    this.panelHistory = [];
    this.documentGroups = [];
    this.draftMessage = '';
    this._panelSubs.forEach((s) => s.unsubscribe());
    this._panelSubs = [];
    // Leave phone group when closing
    if (this.currentRealtimePhone) {
      this.smsRealtime.leavePhone(this.currentRealtimePhone).catch(() => {});
      this.currentRealtimePhone = null;
    }
  }

  get hasSelectedApplicant(): boolean {
    return !!this.selectedApplicantId;
  }

  get applicantDisplayName(): string {
    const first = this.readApplicantProp('first_name', 'FIRST_NAME', 'firstName');
    const last = this.readApplicantProp('last_name', 'LAST_NAME', 'lastName');
    const full = [first, last].filter(Boolean).join(' ').trim();
    return full || this.selectedApplicantName || 'Applicant';
  }

  get applicantInitials(): string {
    const name = this.applicantDisplayName.trim();
    if (!name) return 'A';
    const parts = name.split(/\s+/);
    const first = parts[0]?.charAt(0).toUpperCase() ?? '';
    const second = parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : '';
    return (first + second).trim() || first || 'A';
  }

  get applicantEmail(): string | null {
    return this.readApplicantProp('email', 'EMAIL');
  }

  get applicantPhone(): string | null {
    return this.readApplicantProp('phone_number', 'PHONE_NUMBER', 'phone', 'PHONE', 'phone_mobile', 'PHONE_MOBILE');
  }

  get applicantLocation(): string | null {
    return (
      this.readApplicantProp('location_name', 'LOCATION_NAME', 'location', 'LOCATION') ||
      this.getSelectedLocationName()
    );
  }

  get applicantStage(): string | null {
    return this.readApplicantProp('stage_name', 'STAGE_NAME', 'stage', 'STAGE');
  }

  get applicantStatus(): string | null {
    return this.readApplicantProp('status_name', 'STATUS_NAME', 'status', 'STATUS');
  }

  get generalInfoRows(): Array<{ label: string; value: string; kind?: 'email' | 'phone' }> {
    const rows: Array<{ label: string; value: string; kind?: 'email' | 'phone' }> = [];
    const email = this.applicantEmail;
    if (email) rows.push({ label: 'Email', value: email, kind: 'email' });
    const phone = this.applicantPhone;
    if (phone) rows.push({ label: 'Phone', value: phone, kind: 'phone' });
    const location = this.applicantLocation;
    if (location) rows.push({ label: 'Location', value: location });
    const stage = this.applicantStage;
    if (stage) rows.push({ label: 'Stage', value: stage });
    const status = this.applicantStatus;
    if (status) rows.push({ label: 'Status', value: status });
    // if (this.selectedApplicantId) {
    //   rows.push({ label: 'Applicant ID', value: this.selectedApplicantId });
    // }
    return rows;
  }

  get selectedThread(): MessengerChatThread | null {
    if (!this.selectedApplicantId) return null;
    return this.chatThreads.find((t) => t.id_applicant === this.selectedApplicantId) ?? null;
  }

  get latestMessage(): { body: string; timestamp: string; channel: string } | null {
    const items = Array.isArray(this.panelMessages) ? [...this.panelMessages] : [];
    if (!items.length) return null;
    items.sort((a, b) => {
      const dateA = this.tryParseDate(a?.timestamp);
      const dateB = this.tryParseDate(b?.timestamp);
      if (dateA && dateB) return dateB.getTime() - dateA.getTime();
      if (dateB) return 1;
      if (dateA) return -1;
      return 0;
    });
    return items[0] ?? null;
  }

  /** Group history events by day for the timeline view */
  get panelHistoryGroups(): Array<{ dayLabel: string; events: MessengerHistoryEvent[] }> {
    const items = Array.isArray(this.panelHistory) ? this.panelHistory : [];
    if (!items.length) return [];
    const groups: Array<{ dayLabel: string; events: MessengerHistoryEvent[] }> = [];
    for (const ev of items) {
      const dayLabel = this.resolveEventDay(ev);
      let bucket = groups.find((g) => g.dayLabel === dayLabel);
      if (!bucket) {
        bucket = { dayLabel, events: [] };
        groups.push(bucket);
      }
      bucket.events.push(ev);
    }
    return groups;
  }

  formatMessageTimestamp(value: string | null | undefined): string {
    const date = this.tryParseDate(value);
    if (!date) return value ? String(value) : '';
    const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timePart = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `${datePart} · ${timePart}`;
  }

  private normalizeHistoryEvent(row: any, refMap?: Record<string, any>): MessengerHistoryEvent {
    if (!row || typeof row !== 'object') {
      return {
        id: `history-${Math.random().toString(36).slice(2)}`,
        type: 'event',
        text: '',
        time: null
      };
    }

    const rawId = row.event_id ?? row.id ?? row.id_event ?? row.uuid ?? row.ID ?? null;
    const id = String(rawId ?? `history-${Math.random().toString(36).slice(2)}`);

    let eventTable = String(row.event_table ?? row.table ?? '').toLowerCase();
    let idEventTable = row.id_event_table != null ? String(row.id_event_table) : null;
    if ((!eventTable || !idEventTable) && refMap && id) {
      const ref = refMap[id];
      if (ref) {
        if (!eventTable) eventTable = String(ref.event_table ?? '').toLowerCase();
        if (!idEventTable && ref.id_event_table != null) {
          idEventTable = String(ref.id_event_table);
        }
      }
    }

    const typeRaw = String(
      row.event_type ?? row.type ?? this.mapEventTableToType(eventTable)
    ).toLowerCase();
    const type = typeRaw === 'mail' ? 'email' : typeRaw || 'event';

    const text = String(
      row.event_title ??
        row.title ??
        row.event_text ??
        row.text ??
        row.description ??
        row.note ??
        row.document_name ??
        this.defaultTitleForEventTable(eventTable) ??
        ''
    );

    const timeValue =
      row.event_date ?? row.date ?? row.created_at ?? row.createdAt ?? row.time ?? null;

    const actorRaw = row.event_user ?? row.user ?? row.actorName ?? row.actor ?? null;
    const actorName = actorRaw ? String(actorRaw).trim() || null : null;
    const actorRole = row.actorRole
      ? String(row.actorRole).toLowerCase()
      : actorName && actorName.toLowerCase().includes('system')
      ? 'system'
      : null;

    const channel = type === 'sms' ? 'SMS' : type === 'email' ? 'Email' : null;

    const withDetail = this.coerceWithDetailFlag(
      row.with_detail ??
        row.with_details ??
        (row as any).width_details ??
        row.withDetail ??
        row.withDetails
    );

    return {
      id,
      type,
      text,
      time: timeValue ? String(timeValue) : null,
      actorName,
      actorRole,
      channel,
      event_table: eventTable || null,
      id_event_table: idEventTable,
      with_detail: withDetail,
      previousStage:
        (row.previousStage ?? row.previous_stage ?? row.from_stage ?? row.stage_from ?? null) != null
          ? String(row.previousStage ?? row.previous_stage ?? row.from_stage ?? row.stage_from)
          : null,
      newStage:
        (row.newStage ?? row.new_stage ?? row.to_stage ?? row.stage_to ?? null) != null
          ? String(row.newStage ?? row.new_stage ?? row.to_stage ?? row.stage_to)
          : null,
      from:
        (row.from ?? row.source ?? row.old_value ?? row.previous_value ?? null) != null
          ? String(row.from ?? row.source ?? row.old_value ?? row.previous_value)
          : null,
      to:
        (row.to ?? row.destination ?? row.new_value ?? row.next_value ?? null) != null
          ? String(row.to ?? row.destination ?? row.new_value ?? row.next_value)
          : null
    };
  }

  private mapEventTableToType(eventTable: string): string {
    const table = (eventTable || '').toLowerCase();
    if (table.startsWith('notifications-sms') || table.startsWith('chats')) return 'sms';
    if (table.startsWith('notifications')) return 'email';
    if (table.startsWith('documents')) return 'document';
    if (table.startsWith('notes')) return 'note';
    if (table.startsWith('stages-history') || table.startsWith('stage')) return 'stage';
    return 'event';
  }

  private defaultTitleForEventTable(eventTable: string): string {
    const table = (eventTable || '').toLowerCase();
    if (table.startsWith('documents-create')) return 'Document uploaded';
    if (table.startsWith('documents-approved')) return 'Document approved';
    if (table.startsWith('documents-disapproved')) return 'Document disapproved';
    if (table.startsWith('notifications-sms')) return 'SMS notification sent';
    if (table.startsWith('notifications')) return 'Email notification sent';
    if (table === 'chats') return 'SMS sent from chat screen';
    if (table.startsWith('chats')) return 'SMS message';
    if (table.startsWith('notes')) return 'Note added';
    if (table.startsWith('stages-history')) return 'Stage updated';
    return 'Event';
  }

  private coerceWithDetailFlag(raw: any): boolean {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw === 1;
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'si';
    }
    return false;
  }

  private resolveEventTimestamp(ev: MessengerHistoryEvent): number | null {
    if (!ev) return null;
    if (typeof ev.__timestamp === 'number') return ev.__timestamp;
    const date = this.tryParseDate(ev.time ?? undefined);
    if (!date) return null;
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
  }

  private resolveEventDay(ev: MessengerHistoryEvent): string {
    if ((ev as any)?.dayLabel) return String((ev as any).dayLabel);
    const ts = this.resolveEventTimestamp(ev);
    if (!ts) return ev.time ? this.formatDayLabel(ev.time) : 'Timeline';
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: '2-digit'
    }).format(new Date(ts));
  }

  timelineIcon(type?: string): string {
    switch ((type || '').toLowerCase()) {
      case 'created':
        return 'icon-plus';
      case 'transition':
        return 'icon-arrow-right';
      case 'stage':
        return 'icon-corner-up-right';
      case 'email':
      case 'mail':
        return 'icon-mail';
      case 'sms':
        return 'icon-message-circle';
      case 'note':
        return 'icon-file-text';
      case 'document':
      case 'file':
        return 'icon-file-text';
      case 'error':
        return 'icon-alert-circle';
      default:
        return 'icon-circle';
    }
  }

  timelineMarkerClass(type?: string): string {
    switch ((type || '').toLowerCase()) {
      case 'created':
        return 'bg-primary text-white';
      case 'transition':
      case 'stage':
        return 'bg-info text-white';
      case 'email':
      case 'mail':
        return 'bg-success text-white';
      case 'sms':
        return 'bg-warning text-dark';
      case 'note':
        return 'bg-primary text-white';
      case 'document':
      case 'file':
        return 'bg-secondary text-white';
      case 'error':
        return 'bg-danger text-white';
      default:
        return 'bg-secondary text-white';
    }
  }

  timelineActorBadgeClass(role?: string | null): string {
    const normalized = (role || '').toString().toLowerCase();
    switch (normalized) {
      case 'system':
        return 'badge bg-secondary-subtle text-secondary';
      case 'admin':
      case 'reviewer':
        return 'badge bg-primary-subtle text-primary';
      case 'applicant':
      case 'user':
        return 'badge bg-success-subtle text-success';
      default:
        return 'badge bg-secondary-subtle text-secondary';
    }
  }

  timelineActorLabel(role?: string | null): string {
    if (!role) return 'User';
    const normalized = role.toString().toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  timelineDisplayTime(ev: MessengerHistoryEvent): string {
    const ts = this.resolveEventTimestamp(ev);
    if (!ts) return ev.time ?? '';
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return formatter.format(new Date(ts));
  }

  docStatusClass(doc: ApplicantDocument | null | undefined): string {
    const status = (doc?.status || '').toString().toUpperCase();
    if (status === 'APPROVED') return 'status-badge status-badge--approved';
    if (status === 'DISAPPROVED') return 'status-badge status-badge--rejected';
    if (status === 'RE-COLLECTING FILE' || status === 'RECOLLECTING' || status === 'RE-COLLECTING') {
      return 'status-badge status-badge--pending';
    }
    return 'status-badge status-badge--default';
  }

  docStatusLabel(status: string | null | undefined): string {
    if (!status) return 'Pending';
    const normalized = status.toString().replace(/[_-]+/g, ' ').trim();
    return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Minimal mapping without a doc object */
  private docStatusClassByStatus(status: string | null | undefined): string {
    const s = (status || '').toString().toUpperCase();
    if (s === 'APPROVED') return 'status-badge status-badge--approved';
    if (s === 'DISAPPROVED') return 'status-badge status-badge--rejected';
    if (s.includes('RE-COLLECT')) return 'status-badge status-badge--pending';
    if (s === 'PENDING' || !s) return 'status-badge status-badge--default';
    return 'status-badge status-badge--default';
  }

  /** Aggregate group status considering all items */
  getGroupStatus(group: DocumentGroup | null | undefined): string {
    const items = group?.items || [];
    if (!items.length) return 'PENDING';
    const statuses = items.map((d) => (d?.status || '').toString().toUpperCase());
    // Priority: Re-collecting > Disapproved > Pending/Unknown > Approved
    if (statuses.some((s) => s.includes('RE-COLLECT'))) return 'RE-COLLECTING FILE';
    if (statuses.some((s) => s === 'DISAPPROVED')) return 'DISAPPROVED';
    if (statuses.some((s) => s === '' || s === 'PENDING' || s === 'NULL' || s === 'UNKNOWN')) return 'PENDING';
    // if all approved
    if (statuses.every((s) => s === 'APPROVED')) return 'APPROVED';
    return 'PENDING';
  }

  groupStatusClass(group: DocumentGroup | null | undefined): string {
    const status = this.getGroupStatus(group || undefined);
    return this.docStatusClassByStatus(status);
  }

  isImageDocument(doc: ApplicantDocument | null | undefined): boolean {
    if (!doc?.document_name) return false;
    return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(doc.document_name);
  }

  documentExtension(doc: ApplicantDocument | null | undefined): string {
    if (!doc?.document_name) return '';
    const parts = doc.document_name.split('.');
    if (parts.length < 2) return '';
    return parts.pop()!.toLowerCase();
  }

  private documentKindFromExtension(ext: string): string {
    if (!ext) return 'other';
    if (/(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(`.${ext}`)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'word';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'sheet';
    if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slides';
    if (['txt', 'md', 'json', 'xml'].includes(ext)) return 'text';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
    if (['mp3', 'wav', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
    return 'other';
  }

  documentTypeLabel(doc: ApplicantDocument | null | undefined): string {
    const ext = this.documentExtension(doc);
    const kind = this.documentKindFromExtension(ext);
    switch (kind) {
      case 'image':
        return 'Image';
      case 'pdf':
        return 'PDF document';
      case 'word':
        return 'Word document';
      case 'sheet':
        return 'Spreadsheet';
      case 'slides':
        return 'Presentation';
      case 'text':
        return 'Text file';
      case 'archive':
        return 'Archive';
      case 'audio':
        return 'Audio';
      case 'video':
        return 'Video';
      default:
        return 'File';
    }
  }

  /** True if the document is a PDF */
  isPdfDocument(doc: ApplicantDocument | null | undefined): boolean {
    return this.documentExtension(doc) === 'pdf';
  }

  /** True if the document is a Word-like document (doc, docx, rtf, odt) */
  isWordDocument(doc: ApplicantDocument | null | undefined): boolean {
    const ext = this.documentExtension(doc);
    return ['doc', 'docx', 'rtf', 'odt'].includes(ext);
  }

  /** Return a SafeResourceUrl for embedding a PDF in an <iframe> */
  pdfViewerSrc(doc: ApplicantDocument | null | undefined): SafeResourceUrl {
    const url = doc?.url || (doc
      ? this.core.getFileUrl(String(doc.folder || ''), String(doc.document_name || ''))
      : '');
    const viewUrl = url ? `${url}#toolbar=0&navpanes=0&zoom=page-width` : 'about:blank';
    return this.sanitizer.bypassSecurityTrustResourceUrl(viewUrl);
  }

  /** Return a SafeResourceUrl for Office Online viewer embedding Word-like docs */
  officeViewerSrc(doc: ApplicantDocument | null | undefined): SafeResourceUrl {
    const url = doc?.url || (doc
      ? this.core.getFileUrl(String(doc.folder || ''), String(doc.document_name || ''))
      : '');
    if (!url) return this.sanitizer.bypassSecurityTrustResourceUrl('about:blank');
    const encoded = encodeURIComponent(url);
    const viewUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encoded}&wdPrint=0&wdDownloadButton=1`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(viewUrl);
  }

  documentIcon(doc: ApplicantDocument | null | undefined): string {
    const ext = this.documentExtension(doc);
    const kind = this.documentKindFromExtension(ext);
    switch (kind) {
      case 'image':
        return 'icon-image';
      case 'pdf':
        return 'icon-file-text';
      case 'word':
        return 'icon-file';
      case 'sheet':
        return 'icon-grid';
      case 'slides':
        return 'icon-sliders';
      case 'text':
        return 'icon-file-text';
      case 'archive':
        return 'icon-package';
      case 'audio':
        return 'icon-music';
      case 'video':
        return 'icon-film';
      default:
        return 'icon-file';
    }
  }

  viewDocument(_group: DocumentGroup, doc: ApplicantDocument, ev?: Event): void {
    if (!doc) return;
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    this.openDocument(doc);
  }

  openDocument(doc: ApplicantDocument, ev?: Event): void {
    try {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      const folder = doc.folder || '';
      const name = doc.document_name || '';
      this.core.fetchFile(folder, name).subscribe({
        next: (response: any) => {
          const freshUrl =
            response?.data?.url ||
            doc.url ||
            this.core.getFileUrl(String(folder), String(name));
          if (!freshUrl) {
            Utilities.showToast('File URL not available', 'warning');
            return;
          }
          window.open(freshUrl, '_blank', 'noopener');
        },
        error: (err) => {
          console.error('[Messenger] openDocument fetchFile error', err);
          Utilities.showToast('Unable to open file', 'error');
        }
      });
    } catch {
      Utilities.showToast('Unable to open file', 'error');
    }
  }

  downloadDocument(doc: ApplicantDocument): void {
    try {
      const folder = doc.folder || '';
      const name = doc.document_name || 'download';
      this.core.fetchFile(folder, doc.document_name || '').subscribe({
        next: async (response: any) => {
          const freshUrl =
            response?.data?.url ||
            doc.url ||
            this.core.getFileUrl(String(folder), String(doc.document_name || ''));
          if (!freshUrl) {
            Utilities.showToast('File URL not available', 'warning');
            return;
          }
          await this.forceDownload(freshUrl, name);
        },
        error: (err) => {
          console.error('[Messenger] downloadDocument fetchFile error', err);
          Utilities.showToast('Unable to download file', 'error');
        }
      });
    } catch {
      Utilities.showToast('Unable to download file', 'error');
    }
  }

  refreshDocUrl(doc: ApplicantDocument): void {
    try {
      this.core.fetchFile(doc.folder || '', doc.document_name || '').subscribe({
        next: (response: any) => {
          doc.url = response?.data?.url || doc.url || '';
        },
        error: (err) => {
          console.warn('[Messenger] refreshDocUrl error', err);
        }
      });
    } catch {
      /* noop */
    }
  }

  private normalizeDocRecord(r: any): ApplicantDocument {
    return {
      id_applicant_document: Number(r.id_applicant_document ?? r.ID_APPLICANT_DOCUMENT ?? r.id ?? 0),
      id_applicant: String(r.id_applicant ?? r.ID_APPLICANT ?? ''),
      data_key: String(r.data_key ?? r.DATA_KEY ?? 'Files'),
      document_name: String(r.document_name ?? r.DOCUMENT_NAME ?? ''),
      status:
        r.status ?? r.STATUS ?? null ? String(r.status ?? r.STATUS) : null,
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
    for (const doc of docs) {
      const key = doc.data_key || 'Files';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(doc);
    }
    const groups: DocumentGroup[] = Array.from(map.entries()).map(([dataKey, items]) => ({
      dataKey,
      items: items
        .slice()
        .sort((a, b) => {
          const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
          const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
          return tb - ta;
        })
    }));
    groups.sort((a, b) => a.dataKey.localeCompare(b.dataKey));
    return groups;
  }

  private readApplicantProp(...keys: string[]): string | null {
    if (!this.applicant) return null;
    for (const key of keys) {
      const value = this.applicant[key];
      if (value !== undefined && value !== null) {
        const str = String(value).trim();
        if (str) return str;
      }
    }
    return null;
  }

  private tryParseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const direct = new Date(normalized);
    if (!Number.isNaN(direct.getTime())) return direct;
    const withZone = normalized.endsWith('Z') ? normalized : `${normalized}Z`;
    const zoned = new Date(withZone);
    if (!Number.isNaN(zoned.getTime())) return zoned;
    return null;
  }

  /**
   * Smoothly stick to bottom if the user is already near the bottom, or force when requested.
   * This avoids jarring jumps while the user is reading older messages.
   */
  private scrollMessagesToBottomSoon(delay: number = 50, force: boolean = false): void {
    try {
      if (this._scrollTimer) clearTimeout(this._scrollTimer);
      this._scrollTimer = setTimeout(() => {
        try {
          const el = this.messagesScroll?.nativeElement;
          if (!el) return;
          const threshold = 120; // px from bottom to auto-stick
          const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
          if (force || distanceFromBottom <= threshold) {
            el.scrollTop = el.scrollHeight;
          }
        } catch {
          // ignore
        }
      }, delay);
    } catch {
      // ignore
    }
  }

  private parseHistoryDatasets(data: any): { enriched: any[]; refs: any[] } {
    const output = { enriched: [] as any[], refs: [] as any[] };
    if (!data) return output;
    if (Array.isArray(data)) {
      if (data.length && Array.isArray(data[0])) {
        for (const dataset of data) {
          if (!Array.isArray(dataset) || !dataset.length) continue;
          const probe = dataset[0];
          const looksEnriched =
            probe &&
            typeof probe === 'object' &&
            (Object.prototype.hasOwnProperty.call(probe, 'event_title') ||
              Object.prototype.hasOwnProperty.call(probe, 'event_type') ||
              Object.prototype.hasOwnProperty.call(probe, 'event_user'));
          if (looksEnriched) output.enriched = dataset;
          else output.refs = dataset;
        }
      } else {
        const probe = data[0];
        const looksEnriched =
          probe &&
          typeof probe === 'object' &&
          (Object.prototype.hasOwnProperty.call(probe, 'event_title') ||
            Object.prototype.hasOwnProperty.call(probe, 'event_type') ||
            Object.prototype.hasOwnProperty.call(probe, 'event_user'));
        if (looksEnriched) output.enriched = data as any[];
        else output.refs = data as any[];
      }
    } else if (typeof data === 'object') {
      output.enriched = [data];
    }
    return output;
  }

  private buildHistoryRefMap(refs: any[]): Record<string, any> {
    const map: Record<string, any> = {};
    for (const entry of refs || []) {
      if (!entry || typeof entry !== 'object') continue;
      const key = String(entry.id_event ?? entry.event_id ?? entry.id ?? '').trim();
      if (!key) continue;
      map[key] = entry;
    }
    return map;
  }

  private formatDayLabel(value: string | null | undefined): string {
    const date = this.tryParseDate(value);
    if (!date) return value ? String(value).split('T')[0] : 'Unknown date';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private loadLocations(suppressAutoSelect: boolean = false): void {
    this.locationsLoading = true;
    this.locationsError = null;
    const api = {
      // Use the SP that returns TotalApplicants per location
      commandName: DriveWhipAdminCommand.crm_applicants_chat_count_location,
      parameters: []
    } as const;
    this.core.executeCommand<any>(api).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.locationsLoading = false;
        if (!res?.ok) {
          this.locations = [];
          this.locationsError = String(res?.error || 'Failed to load locations');
          return;
        }
        try {
          let rows: any[] = [];
          if (Array.isArray(res.data)) {
            rows = Array.isArray(res.data[0]) ? res.data[0] : res.data;
          }
          this.locations = (rows || [])
            .map((r) => ({
              id: Number(r.IDLocation ?? r.ID_LOCATION ?? r.id_location ?? r.id ?? 0),
              name: String(r.Location ?? r.LOCATION ?? r.name ?? r.NAME ?? '').trim(),
              totalApplicants: Number(
                r.TotalApplicants ?? r.TOTALAPPLICANTS ?? r.total_applicants ?? r.totalApplicants ?? 0
              )
            }))
            .filter((loc) => Number.isFinite(loc.id) && !!loc.name)
            .sort((a, b) => a.name.localeCompare(b.name));
          if (!suppressAutoSelect && !this.selectedLocationId && this.locations.length) {
            this.selectedLocationId = this.locations[0].id;
          }
        } catch (err) {
          console.error('[Messenger] loadLocations parse error', err);
          this.locations = [];
          this.locationsError = 'Failed to parse locations';
        }
      },
      error: (err) => {
        this.locationsLoading = false;
        this.locationsError = 'Failed to load locations';
        console.error('[Messenger] loadLocations error', err);
      }
    });
  }

  private loadChats(locationId?: number | null): void {
    this.chatsLoading = true;
    this.chatsError = null;
    const api = {
      // Call the new procedure that accepts an optional location id
      commandName: DriveWhipAdminCommand.crm_applicants_chat_list_location,
      // Stored procedure expects a single parameter: p_id_location (BIGINT) or NULL
      parameters: [(locationId !== undefined ? locationId : this.selectedLocationId) ?? null]
    } as const;
    this.core.executeCommand<any>(api).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.chatsLoading = false;
        if (!res?.ok) {
          this.chatThreads = [];
          this.chatsError = String(res?.error || 'Failed to load chats');
          return;
        }
        try {
          let rows: any[] = [];
          if (Array.isArray(res.data)) {
            rows = Array.isArray(res.data[0]) ? res.data[0] : res.data;
          }
          this.chatThreads = (rows || []).map((r) => ({
            id_applicant: String(r.id_applicant ?? r.ID_APPLICANT ?? ''),
            name_applicant: String(r.name_applicant ?? r.NAME_APPLICANT ?? '').trim(),
            hours_since_last_message: String(r.hours_since_last_message ?? r.HOURS_SINCE_LAST_MESSAGE ?? ''),
            last_message: String(r.last_message ?? r.LAST_MESSAGE ?? '')
          }));
        } catch (err) {
          console.error('[Messenger] loadChats parse error', err);
          this.chatThreads = [];
          this.chatsError = 'Failed to parse chat list';
        }
        // After successful chats load, try to auto-select based on pending navbar query
        this.onChatsLoaded();
      },
      error: (err) => {
        this.chatsLoading = false;
        this.chatsError = 'Failed to load chats';
        console.error('[Messenger] loadChats error', err);
      }
    });
  }
  
  /**
   * After chats are loaded (success path), if a navbar query is pending,
   * attempt to auto-select the best matching thread.
   */
  private onChatsLoaded(): void {
    if (this.pendingThreadQuery) {
      this.trySelectMatchingThread();
    }
  }
  /** Load applicant details, messages, history and files for the cloned panel */
  private loadApplicantContext(applicantId: string | null): void {
    // cancel previous
    this._panelSubs.forEach((s) => s.unsubscribe());
    this._panelSubs = [];
    if (!applicantId) return;
    this.loadApplicantDetails(applicantId);
    this.loadPanelChat(applicantId);
    this.loadPanelHistory(applicantId);
    this.loadPanelDocuments(applicantId);
    // Read-only extras for General tab
    this.loadNotes(applicantId);
    this.loadApplicantAnswers(applicantId);
    // Start realtime subscription for this applicant
    this.bindRealtime();
  }

  private loadApplicantDetails(applicantId: string): void {
    this.applicantLoading = true;
    this.applicantError = null;
    const params: any[] = [
      'R',
      applicantId,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_crud as any,
      parameters: params,
    } as any;
    const sub = this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.applicant = null;
          this.applicantError = String(res?.error || 'Failed to load applicant');
          return;
        }
        const rows = Array.isArray(res.data) ? (Array.isArray(res.data[0]) ? res.data[0] : res.data) : res.data || [];
        this.applicant = Array.isArray(rows) && rows.length ? rows[0] : rows;
      },
      error: (err) => {
        console.error('[Messenger] loadApplicantDetails error', err);
        this.applicantError = 'Failed to load applicant';
        this.applicant = null;
      },
      complete: () => {
        this.applicantLoading = false;
        // Applicant context is ready; ensure realtime is joined
        this.updatePhoneSubscription().catch(() => {});
      }
    });
    this._panelSubs.push(sub);
  }

  private loadNotes(applicantId: string | null): void {
    if (!applicantId) { this.notes = []; return; }
    this.notesLoading = true;
    this.notesError = null;
    this.notes = [];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_notes_crud as any,
      parameters: ['R', null, applicantId, null, null, null, null],
    } as any;
    const sub = this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.notes = [];
          this.notesError = String(res?.error || 'Failed to load notes');
          return;
        }
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        this.notes = Array.isArray(raw) ? raw : [];
      },
      error: (err) => {
        console.error('[Messenger] loadNotes error', err);
        this.notes = [];
        this.notesError = 'Failed to load notes';
      },
      complete: () => {
        this.notesLoading = false;
      }
    });
    this._panelSubs.push(sub);
  }

  private loadApplicantAnswers(applicantId: string | null): void {
    if (!applicantId) { this.answers = []; return; }
    this.answersLoading = true;
    this.answersError = null;
    this.answers = [];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_answers_registration as any,
      parameters: [applicantId],
    } as any;
    const sub = this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.answers = [];
          this.answersError = String(res?.error || 'Failed to load answers');
          return;
        }
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const list = Array.isArray(raw) ? raw : [];
        this.answers = list.map((r: any) => ({
          id_question: r.id_question ?? r.ID_QUESTION ?? null,
          answer_text: r.answer_text ?? r.ANSWER_TEXT ?? '',
          answered_at: r.answered_at ?? r.ANSWERED_AT ?? null,
          created_at: r.created_at ?? r.CREATED_AT ?? null,
          question: r.question ?? r.QUESTION ?? null,
        }));
      },
      error: (err) => {
        console.error('[Messenger] loadApplicantAnswers error', err);
        this.answers = [];
        this.answersError = 'Failed to load answers';
      },
      complete: () => {
        this.answersLoading = false;
      }
    });
    this._panelSubs.push(sub);
  }

  /** Parse statuses coming from crm_applicants_crud (e.g., "Status" JSON string) */
  get resolvedStatuses(): Array<{ stage: string; statusName: string; order?: number }> {
    try {
      const src: any = this.applicant;
      const byKey = src?.statuses || src?.Statuses || src?.Status || null;
      let arr: any[] = [];
      if (Array.isArray(byKey)) arr = byKey;
      else if (typeof byKey === 'string' && byKey.trim()) {
        try { arr = JSON.parse(byKey); } catch { arr = []; }
      }
      const list = Array.isArray(arr) ? arr : [];
      // Normalize and dedupe (keep last occurrence)
      const seen = new Set<string>();
      const out: Array<{ stage: string; statusName: string; order?: number }> = [];
      for (let i = list.length - 1; i >= 0; i--) {
        const it: any = list[i] || {};
        const stage = String(it.stage || '').trim();
        const statusName = String(it.statusName || (it.isComplete ? 'complete' : 'incomplete')).trim();
        const order = typeof it.order === 'number' ? it.order : undefined;
        const key = `${stage}|${statusName}|${order ?? ''}`.toLowerCase();
        if (!seen.has(key) && stage) {
          seen.add(key);
          out.unshift({ stage, statusName, order });
        }
      }
      return out;
    } catch { return []; }
  }

  statusBadgeClass(s: { statusName: string }): string {
    const name = (s?.statusName || '').toLowerCase();
    if (name.includes('complete')) return 'status-badge status-badge--approved';
    if (name.includes('reject') || name.includes('disapprove')) return 'status-badge status-badge--rejected';
    if (name.includes('pending') || name.includes('incomplete')) return 'status-badge status-badge--pending';
    return 'status-badge status-badge--default';
  }

  private loadPanelChat(applicantId: string, page: number = 1): void {
    this.panelMessagesLoading = true;
    this.panelMessagesError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicant_chat_history as any,
      parameters: [applicantId, page],
    } as any;
    const sub = this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.panelMessages = [];
          this.panelMessagesError = String(res?.error || 'Failed to load chat');
          return;
        }
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const rows = Array.isArray(raw) ? raw : [];
        // Map raw rows to message objects and render oldest first (newest at the bottom)
        this.panelMessages = rows
          .map((r: any) => {
            // Build a friendly time label (e.g., "1:53 AM")
            const sent = r.Sent ?? r.sent ?? r.sent_at ?? r.SENT_AT ?? r.create ?? r.created_at ?? r.CREATED_AT ?? null;
            const ts = sent ? new Date(sent) : null;
            const timeLabel = ts && !Number.isNaN(ts.getTime())
              ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(ts)
              : String(sent ?? '');
            const status = this.inferStatus(r);
            return {
              id: r.id ?? r.ID ?? r.id_chat ?? null,
              direction: (r.Direction ?? r.message_direction ?? '').toString().toLowerCase() === 'outbound' ? 'outbound' : 'inbound',
              body: String(r.Message ?? r.message_text ?? ''),
              timestamp: timeLabel,
              channel: String(r.Channel ?? r.channel ?? 'SMS'),
              status,
              statusLabel: this.defaultStatusLabel(status),
              __ts: (ts && !Number.isNaN(ts.getTime())) ? ts.getTime() : undefined,
            } as any;
          })
          .reverse();
        // Initial load or explicit load: stick to bottom
        this.scrollMessagesToBottomSoon(0, true);
      },
      error: (err) => {
        console.error('[Messenger] loadPanelChat error', err);
        this.panelMessages = [];
        this.panelMessagesError = 'Failed to load chat';
      },
      complete: () => {
        this.panelMessagesLoading = false;
        this.scrollMessagesToBottomSoon(0, true);
        if (this.selectedApplicantId) {
          this.markThreadRead(this.selectedApplicantId);
        }
      }
    });
    this._panelSubs.push(sub);
  }

  private loadPanelHistory(applicantId: string, prefix: string = 'all'): void {
    this.panelHistoryLoading = true;
    this.panelHistoryError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicant_event_read as any,
      parameters: [applicantId, prefix],
    } as any;
    const sub = this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.panelHistory = [];
          this.panelHistoryError = String(res?.error || 'Failed to load history');
          return;
        }
        const { enriched, refs } = this.parseHistoryDatasets(res.data);
        const refMap = this.buildHistoryRefMap(refs);
        const rows = enriched.length ? enriched : refs;
        const events: Array<MessengerHistoryEvent & { __timestamp: number | null }> = rows
          .map((r: any) => this.normalizeHistoryEvent(r, refMap))
          .map((ev: MessengerHistoryEvent) => ({ ...ev, __timestamp: this.resolveEventTimestamp(ev) }));
        events.sort(
          (a: { __timestamp: number | null }, b: { __timestamp: number | null }) =>
            (b.__timestamp ?? 0) - (a.__timestamp ?? 0)
        );
        this.panelHistory = events;
      },
      error: (err) => {
        console.error('[Messenger] loadPanelHistory error', err);
        this.panelHistory = [];
        this.panelHistoryError = 'Failed to load history';
      },
      complete: () => {
        this.panelHistoryLoading = false;
      }
    });
    this._panelSubs.push(sub);
  }

  private loadPanelDocuments(applicantId: string): void {
    this.panelDocsLoading = true;
    this.panelDocsError = null;
    this.documentGroups = [];
    const params: any[] = [
      'R',
      null,
      applicantId,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_documents_crud_new as any,
      parameters: params,
    } as any;
    const sub = this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.documentGroups = [];
          this.panelDocsError = String(res?.error || 'Failed to load documents');
          return;
        }
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const rows = Array.isArray(raw) ? raw : [];
        const docs = rows
          .map((r: any) => this.normalizeDocRecord(r))
          .filter((doc): doc is ApplicantDocument => !!doc && !!doc.document_name);
        for (const doc of docs) {
          const fetchSub = this.core
            .fetchFile(doc.folder || '', doc.document_name || '')
            .subscribe({
              next: (resp) => {
                if (resp?.data?.url) doc.url = resp.data.url;
              },
              error: () => {
                /* best-effort */
              }
            });
          this._panelSubs.push(fetchSub);
        }
        this.documentGroups = this.groupDocuments(docs);
      },
      error: (err) => {
        console.error('[Messenger] loadPanelDocuments error', err);
        this.documentGroups = [];
        this.panelDocsError = 'Failed to load documents';
      },
      complete: () => {
        this.panelDocsLoading = false;
      }
    });
    this._panelSubs.push(sub);
  }

  /** Open the inline sidebar with event details; only when actionable */
  openEventSidebar(ev: MessengerHistoryEvent | any): void {
    if (!ev) return;
    const type = (ev.type || ev.event_type || '').toString().toLowerCase();
    const eventTable = (ev.event_table || '').toString().toLowerCase();
    const idTableStr = (ev.id_event_table ?? ev.idEventTable ?? '0').toString();
    const isDocument = type === 'document' || eventTable.startsWith('documents');
    const docIdNum = parseInt(idTableStr, 10);
    const hasDocId = !Number.isNaN(docIdNum) && docIdNum > 0;
    // Only open when backend signals detail OR a document with id exists
    const canOpen = ev.with_detail === true || (isDocument && hasDocId);
    if (!canOpen) return;

    this.selectedHistoryEvent = ev as MessengerHistoryEvent;
    this.eventSidebarOpen = true;
    this.eventDetailError = null;
    this.eventDetailLoading = false;
    this.eventDetailText = String(ev.body ?? ev.text ?? ev.notes ?? ev.document_name ?? '');
    if (this.historyDetailBody?.nativeElement) {
      try { this.historyDetailBody.nativeElement.scrollTop = 0; } catch {}
    }
    this.scrollHistoryDetailIntoViewSoon();

    // Reset doc preview state
    this.eventDoc = null;
    this.eventDocError = null;
    this.eventDocLoading = false;

    // If it's a document event with id, try to load preview
    if (isDocument && hasDocId && this.selectedApplicantId) {
      const token = this.beginEventDocLoad();
      this.loadEventDocumentPreviewById(this.selectedApplicantId, docIdNum, token);
    }

    // Fetch extra detail only if backend allows
    if (ev.with_detail === true && this.selectedApplicantId) {
      this.eventDetailLoading = true;
      const api: IDriveWhipCoreAPI = {
        commandName: DriveWhipAdminCommand.crm_applicant_event_detail as any,
        parameters: [ev.id_event || ev.id, this.selectedApplicantId],
      } as any;
      this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
        next: (res) => {
          let raw: any = res?.data;
          if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
          const row = Array.isArray(raw) && raw.length ? raw[0] : null;
          if (row && typeof row === 'object') {
            const detail = String(
              row.message_text ?? row.message ?? row.document_name ?? row.note ?? row.text ?? ''
            );
            if (detail) this.eventDetailText = detail;
            // If doc event and no preview yet, try from detail row
            if ((isDocument && !this.eventDoc) && this.selectedApplicantId) {
              const folder = row.folder ?? row.FOLDER ?? null;
              const name = row.document_name ?? row.DOCUMENT_NAME ?? null;
              const id_applicant_document = row.id_applicant_document ?? row.ID_APPLICANT_DOCUMENT ?? null;
              if (id_applicant_document) {
                const parsed = parseInt(String(id_applicant_document), 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                  const token = this.beginEventDocLoad();
                  this.loadEventDocumentPreviewById(this.selectedApplicantId, parsed, token);
                }
              } else if (name) {
                const doc: ApplicantDocument = {
                  id_applicant_document: 0,
                  id_applicant: String(this.selectedApplicantId),
                  data_key: String(row.data_key ?? row.DATA_KEY ?? ''),
                  document_name: String(name),
                  status: row.status ?? row.STATUS ?? null,
                  created_at: row.created_at ?? row.CREATED_AT ?? null,
                  approved_at: row.approved_at ?? row.APPROVED_AT ?? null,
                  approved_by: row.approved_by ?? row.APPROVED_BY ?? null,
                  disapproved_at: row.disapproved_at ?? row.DISAPPROVED_AT ?? null,
                  disapproved_by: row.disapproved_by ?? row.DISAPPROVED_BY ?? null,
                  folder: folder ?? null,
                  url: ''
                };
                const token = this.beginEventDocLoad();
                this.loadEventDocumentUrl(doc, token);
              }
            }
          }
        },
        error: (err) => {
          console.error('[Messenger] event detail error', err);
          this.eventDetailError = 'Failed to load event detail';
        },
        complete: () => {
          this.eventDetailLoading = false;
        }
      });
    }
  }

  closeEventSidebar(): void {
    this.eventSidebarOpen = false;
    this.selectedHistoryEvent = null;
    this.eventDetailLoading = false;
    this.eventDetailError = null;
    this.eventDetailText = '';
    this.eventDocLoading = false;
    this.eventDocError = null;
    this.eventDoc = null;
    try { this._eventDocSub?.unsubscribe(); } catch {}
    this._eventDocSub = null;
  }

  openEventDocument(doc: ApplicantDocument, ev?: Event): void {
    try {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      const folder = doc.folder || '';
      const name = doc.document_name || '';
      this.core.fetchFile(folder, name).subscribe({
        next: (response: any) => {
          const freshUrl =
            response?.data?.url ||
            doc.url ||
            this.core.getFileUrl(String(folder), String(name));
          if (!freshUrl) {
            Utilities.showToast('File URL not available', 'warning');
            return;
          }
          window.open(freshUrl, '_blank', 'noopener');
        },
        error: (err) => {
          console.error('[Messenger] openEventDocument fetchFile error', err);
          Utilities.showToast('Unable to open file', 'error');
        }
      });
    } catch {
      Utilities.showToast('Unable to open file', 'error');
    }
  }

  downloadEventDocument(doc: ApplicantDocument): void {
    try {
      const folder = doc.folder || '';
      const name = doc.document_name || 'download';
      this.core.fetchFile(folder, doc.document_name || '').subscribe({
        next: async (response: any) => {
          const freshUrl =
            response?.data?.url ||
            doc.url ||
            this.core.getFileUrl(String(folder), String(doc.document_name || ''));
          if (!freshUrl) {
            Utilities.showToast('File URL not available', 'warning');
            return;
          }
          await this.forceDownload(freshUrl, name);
        },
        error: (err) => {
          console.error('[Messenger] downloadEventDocument fetchFile error', err);
          Utilities.showToast('Unable to download file', 'error');
        }
      });
    } catch {
      Utilities.showToast('Unable to download file', 'error');
    }
  }

  refreshEventDocUrl(doc: ApplicantDocument): void {
    try {
      this.core.fetchFile(doc.folder || '', doc.document_name || '').subscribe({
        next: (response: any) => {
          doc.url = response?.data?.url || doc.url || '';
        },
        error: (err) => {
          console.warn('[Messenger] refreshEventDocUrl error', err);
        }
      });
    } catch {
      /* noop */
    }
  }

  private async forceDownload(url: string, fileName: string): Promise<void> {
    try {
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store'
      });
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
    } catch (err) {
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = url;
        document.body.appendChild(iframe);
        setTimeout(() => {
          try { document.body.removeChild(iframe); } catch {}
        }, 30000);
      } catch {
        Utilities.showToast('Download failed', 'error');
      }
    }
  }

  private scrollHistoryDetailIntoViewSoon(): void {
    if (!this.historyDetailRef?.nativeElement) return;
    setTimeout(() => {
      try {
        this.historyDetailRef?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch {
        /* noop */
      }
    }, 0);
  }

  /** Load a single applicant document (by id) for the sidebar preview */
  private loadEventDocumentPreviewById(idApplicant: string, idApplicantDocument: number, token?: number): void {
    try {
      if (!idApplicant || !idApplicantDocument) return;
      const t = token ?? this.beginEventDocLoad();
      const params: any[] = [
        'R',
        idApplicantDocument, // p_id_applicant_document
        idApplicant, // p_id_applicant
        null, // p_id_stage
        null, // p_data_key
        null, // p_document_name
        null, // p_status
        null, // p_approved_at
        null, // p_approved_by
        null, // p_disapproved_at
        null, // p_disapproved_by
        null, // p_eventcode
        null, // p_send_notification
        null, // p_type_notification
      ];
      const api: IDriveWhipCoreAPI = {
        commandName: DriveWhipAdminCommand.crm_applicants_documents_crud_new as any,
        parameters: params,
      } as any;
      this._eventDocSub = this.core
        .executeCommand<DriveWhipCommandResponse<any>>(api)
        .subscribe({
          next: (res) => {
            if (t !== this._activeEventDocToken) return; // stale
            let raw: any = res?.data;
            if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
            const rows: any[] = Array.isArray(raw) ? raw : [];
            const r = rows.length ? rows[0] : null;
            if (!r) {
              this.eventDocError = 'File not found';
              return;
            }
            const doc = this.normalizeDocRecord(r);
            this.loadEventDocumentUrl(doc, t);
          },
          error: (err) => {
            console.error('[Messenger] loadEventDocumentPreviewById error', err);
            this.eventDocError = 'Failed to load file';
            this.eventDocLoading = false;
          },
          complete: () => {}
        });
    } catch (e) {
      this.eventDocError = 'Failed to load file';
      this.eventDocLoading = false;
    }
  }

  /** Fetch a fresh signed URL for the given doc and set as sidebar preview */
  private loadEventDocumentUrl(doc: ApplicantDocument, token?: number): void {
    try {
      const t = token ?? this.beginEventDocLoad();
      const effectiveFolder =
        doc.folder && String(doc.folder).trim()
          ? String(doc.folder)
          : this.resolveDocFolderByName(doc.document_name) || 'aplicant';
      const docToLoad = { ...doc, folder: effectiveFolder } as ApplicantDocument;
      this._eventDocSub = this.core
        .fetchFile(effectiveFolder, doc.document_name || '')
        .subscribe({
          next: (resp: any) => {
            if (t !== this._activeEventDocToken) return; // stale
            docToLoad.url = resp?.data?.url || docToLoad.url || '';
            this.eventDoc = { ...docToLoad };
            this.eventDocLoading = false;
          },
          error: (err) => {
            console.error('[Messenger] loadEventDocumentUrl error', err);
            if (t !== this._activeEventDocToken) return; // stale
            this.eventDoc = { ...docToLoad };
            this.eventDocError = 'Unable to load file preview';
            this.eventDocLoading = false;
          }
        });
    } catch (e) {
      this.eventDoc = {
        ...doc,
        folder: doc.folder || this.resolveDocFolderByName(doc.document_name) || 'aplicant',
      };
      this.eventDocError = 'Unable to load file preview';
      this.eventDocLoading = false;
    }
  }

  /** Begin a new event-doc load by increasing the active token and cancelling previous */
  private beginEventDocLoad(): number {
    this._activeEventDocToken = ++this._eventDocLoadSeq;
    try { this._eventDocSub?.unsubscribe(); } catch {}
    this._eventDocSub = null;
    this.eventDocLoading = true;
    this.eventDocError = null;
    this.eventDoc = null;
    return this._activeEventDocToken;
  }

  /** Try to infer the folder of a document from already loaded applicant files by name */
  private resolveDocFolderByName(name: string | null | undefined): string | null {
    const fileName = (name || '').toString().trim();
    if (!fileName) return null;
    try {
      const groups = this.documentGroups || [];
      for (const g of groups) {
        for (const d of g.items || []) {
          if ((d?.document_name || '').toString().trim().toLowerCase() === fileName.toLowerCase()) {
            const fld = (d.folder || '').toString().trim();
            if (fld) return fld;
          }
        }
      }
    } catch {}
    return null;
  }

  // --- Chat send + realtime migration ---
  async onSendMessage(ev: Event): Promise<void> {
    ev.preventDefault();
    const text = (this.draftMessage || '').trim();
    const id = this.selectedApplicantId;
    const to = this.applicantPhone;
    if (!text) return;
    if (!id) { Utilities.showToast('Applicant id not found', 'warning'); return; }
    if (!to) { Utilities.showToast('Applicant phone not found', 'warning'); return; }
    if (this.chatSending) return;

    this.chatSending = true;
    let finalMessage = text;
    try {
      const prepared = await firstValueFrom(
        this.core.prepareNotificationMessage('sms', String(id), text)
      );
      if ((prepared || '').trim()) {
        finalMessage = prepared;
      }
    } catch (err) {
      console.error('[Messenger] prepare SMS error', err);
      Utilities.showToast(this.notificationErrorMessage(err, 'Failed to prepare SMS message'), 'error');
      this.chatSending = false;
      return;
    }

    const optimistic = {
      id: 'temp-' + Date.now(),
      direction: 'outbound',
      body: finalMessage,
      timestamp: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()),
      channel: 'SMS',
      status: 'sending',
      statusLabel: 'Sending'
    } as any;
  this.panelMessages = [...(this.panelMessages ?? []), optimistic];
  // Force-stick on local send to keep the composer anchored
  this.scrollMessagesToBottomSoon(0, true);

    const fromNumber = this.defaultSmsFromNumber();
    try {
      await firstValueFrom(
        this.core.sendChatSms({ from: fromNumber, to, message: finalMessage, id_applicant: String(id) })
      );
      this.draftMessage = '';
      this.markOptimisticDelivered(optimistic.id);
      this.scrollMessagesToBottomSoon(0, true);
    } catch (err) {
      console.error('[Messenger] sendChatSms error', err);
      Utilities.showToast('Failed to send message', 'error');
      this.removeOptimistic(optimistic.id);
    } finally {
      this.chatSending = false;
    }
  }

  private markOptimisticDelivered(tempId: string): void {
    if (!this.panelMessages || !tempId) return;
    this.panelMessages = this.panelMessages.map((m: any) =>
      (m.id === tempId)
        ? { ...m, status: 'delivered', statusLabel: 'Delivered' }
        : m
    );
    // If a non-temp outbound with same body exists, drop the temp one to avoid duplicates
    const temp = this.panelMessages.find((m: any) => m.id === tempId);
    if (temp && temp.direction === 'outbound') {
      const hasPersisted = this.panelMessages.some((m: any) =>
        (m.id || '').toString().startsWith('temp-') === false &&
        m.direction === 'outbound' &&
        (m.body || '').toString().trim() === (temp.body || '').toString().trim()
      );
      if (hasPersisted) {
        this.panelMessages = this.panelMessages.filter((m: any) => m.id !== tempId);
      }
    }
  }

  private removeOptimistic(tempId: string): void {
    if (!this.panelMessages || !tempId) return;
    this.panelMessages = this.panelMessages.filter((m: any) => m.id !== tempId);
  }

  private notificationErrorMessage(error: unknown, fallback: string): string {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    if (error instanceof Error && error.message) return error.message;
    const candidate = (error as any)?.message;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
    return fallback;
  }

  private bindRealtime(): void {
    // Clear prior realtime subscriptions
    this.destroyRealtime$.next();
    this.smsRealtime.messages().pipe(takeUntil(this.destroyRealtime$)).subscribe((evt) => {
      this.handleRealtimeMessage(evt);
    });
    // Ensure connection is associated with the selected phone
    this.updatePhoneSubscription().catch(() => {});
  }

  private async updatePhoneSubscription(): Promise<void> {
    try {
      const to = this.applicantPhone;
      const normalized = this.normalizePhone(to);
      if (normalized === this.currentRealtimePhone) return;
      if (this.currentRealtimePhone && this.currentRealtimePhone !== normalized) {
        try {
          await this.smsRealtime.leavePhone(this.currentRealtimePhone);
          console.debug('[Messenger] leavePhone', this.currentRealtimePhone, 'group=sms:' + this.currentRealtimePhone);
        } catch (err: unknown) {
          console.debug('[Messenger] leavePhone error', this.currentRealtimePhone, err);
        } finally {
          this.currentRealtimePhone = null;
        }
      }
      if (!normalized) {
        console.debug('[Messenger] updatePhoneSubscription: no applicant phone to join');
        return;
      }
      await this.smsRealtime.joinPhone(normalized);
      this.currentRealtimePhone = normalized;
      console.debug('[Messenger] joinPhone', normalized, 'group=sms:' + normalized);
      try {
        console.debug('[Messenger] joinedPhones=', this.smsRealtime.getJoinedPhones());
        console.log('[Messenger] Active SignalR group', `sms:${normalized}`);
      } catch {}
    } catch {}
  }

  private handleRealtimeMessage(evt: ApplicantChatRealtimeMessage): void {
    if (!evt) return;
    // Accept by applicantId match or by phone match
    let accept = false;
    const activeId = this.selectedApplicantId ? this.selectedApplicantId.toLowerCase() : null;
    const incomingId = (evt.applicantId || '').toLowerCase();
    if (activeId && incomingId && activeId === incomingId) accept = true;
    if (!accept && this.matchesCurrentPhone(evt)) accept = true;
    if (!accept) return;

    const body = (evt.body || '').toString();
    if (!body.trim()) return;

    const direction = (evt.direction || '').toLowerCase() === 'outbound' ? 'outbound' : 'inbound';
    const sentSource = evt.sentAtUtc || evt.createdAtUtc || new Date().toISOString();
    const sentDate = new Date(sentSource);
    const timestampLabel = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      .format(Number.isNaN(sentDate.getTime()) ? new Date() : sentDate);
    const status = direction === 'outbound' ? 'delivered' : undefined;

    const message: any = {
      id: (evt.chatId != null ? String(evt.chatId) : (evt.messageSid ? `sid-${evt.messageSid}` : `rt-${Date.now()}`)),
      direction,
      body,
      timestamp: timestampLabel,
      channel: (evt.channel || 'SMS').toString() || 'SMS',
      status,
      statusLabel: this.defaultStatusLabel(status),
      __isNew: true,
      __ts: Number.isNaN(sentDate.getTime()) ? Date.now() : sentDate.getTime(),
    };
    this.panelMessages = [...(this.panelMessages ?? []), message];
    // If a persisted outbound arrives, drop any matching temp 'sending' bubble
    if (direction === 'outbound') {
      const temp = [...this.panelMessages]
        .reverse()
        .find((m: any) => (m.id || '').toString().startsWith('temp-') && m.direction === 'outbound' && (m.body || '').toString().trim() === body.trim());
      if (temp) {
        this.panelMessages = this.panelMessages.filter((m: any) => m.id !== temp.id);
      }
    }
    // Remove highlight after a short delay
    try {
      setTimeout(() => {
        this.panelMessages = (this.panelMessages || []).map((m: any) =>
          (m.id || '') === (message.id || '') ? { ...m, __isNew: false } : m
        );
      }, 2500);
    } catch {}
    // Auto-scroll only if user is near bottom
    this.scrollMessagesToBottomSoon(0, false);

    // Mark as unread for this applicant if not currently viewing this thread's messages
    const eid = (evt.applicantId || '').toString();
    const isViewingThisThread = !!(this.selectedApplicantId && eid && this.selectedApplicantId.toString() === eid.toString() && this.activeTab === 'messages');
    if (!isViewingThisThread && eid) {
      this.setUnread(eid, true);
    }
  }

  private matchesCurrentPhone(evt: ApplicantChatRealtimeMessage): boolean {
    try {
      const target = this.normalizePhone(this.applicantPhone || this.currentRealtimePhone);
      if (!target) return false;
      const from = this.normalizePhone(evt.from);
      const to = this.normalizePhone(evt.to);
      return from === target || to === target;
    } catch {
      return false;
    }
  }

  private normalizePhone(input?: string | null): string | null {
    const raw = (input ?? '').trim();
    if (!raw) return null;
    const digits = raw.split('').filter((ch) => /\d/.test(ch)).join('');
    return digits ? `+${digits}` : null;
  }

  private defaultSmsFromNumber(): string {
    return this.appConfig.smsDefaultFromNumber;
  }

  private inferStatus(r: any): string | null {
    const statusRaw = String(
      r.Status ?? r.status ?? r.delivery_status ?? r.DeliveryStatus ?? r.MessageStatus ?? ''
    ).toLowerCase();
    let status: 'delivered' | 'not_delivered' | 'pending' | null = null;
    if (statusRaw.includes('deliver')) {
      status = (statusRaw.includes('not') || statusRaw.includes('undelivered')) ? 'not_delivered' : 'delivered';
    } else if (statusRaw.includes('fail') || statusRaw.includes('error')) {
      status = 'not_delivered';
    } else if (statusRaw.includes('pending') || statusRaw.includes('queue') || statusRaw.includes('send')) {
      status = 'pending';
    }
    // Default: assume delivered for outbound if missing
    if (!status) {
      const dir = (r.Direction ?? r.message_direction ?? '').toString().toLowerCase();
      if (dir === 'outbound') status = 'delivered';
    }
    return status;
  }

  private defaultStatusLabel(status?: string | null): string {
    switch ((status || '').toString()) {
      case 'delivered': return 'Delivered';
      case 'not_delivered': return 'Not delivered';
      case 'pending': return 'Pending';
      case 'sending': return 'Sending';
      default: return '';
    }
  }

  // Day grouping helpers (to mirror Applicants Panel)
  messageDayLabel(m: any): string | null {
    try {
      const ts: number | undefined = (m && typeof m.__ts === 'number') ? m.__ts : undefined;
      return this.dayLabelFromTs(ts);
    } catch { return null; }
  }

  shouldRenderDay(dayLabel: string | null | undefined, index: number): boolean {
    if (!dayLabel) return false;
    if (index === 0) return true;
    try {
      const prev = this.panelMessages?.[index - 1];
      const prevLabel = this.messageDayLabel(prev);
      return prevLabel !== dayLabel;
    } catch { return index === 0; }
  }

  private dayLabelFromTs(ts?: number): string | null {
    if (!ts || !Number.isFinite(ts)) return null;
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
    } catch { return null; }
  }

  // --- Status UI helpers to match Applicant Panel ---
  statusMetaClass(status: string | undefined): string {
    const s = (status || '').toString();
    switch (s) {
      case 'delivered':
        return 'text-success';
      case 'not_delivered':
        return 'text-danger';
      case 'pending':
      case 'sending':
        return 'text-secondary';
      default:
        return 'text-secondary';
    }
  }

  // ==========================
  // Unread helpers (Option A)
  // ==========================
  private loadUnreadFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.UNREAD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') this.unreadByApplicant = parsed;
      }
    } catch { /* ignore */ }
  }

  private saveUnreadToStorage(): void {
    try { localStorage.setItem(this.UNREAD_STORAGE_KEY, JSON.stringify(this.unreadByApplicant || {})); } catch { /* ignore */ }
  }

  private loadLastSeenFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.LASTSEEN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') this.lastSeenByApplicant = parsed;
      }
    } catch { /* ignore */ }
  }

  private saveLastSeenToStorage(): void {
    try { localStorage.setItem(this.LASTSEEN_STORAGE_KEY, JSON.stringify(this.lastSeenByApplicant || {})); } catch { /* ignore */ }
  }

  private setUnread(applicantId: string, value: boolean): void {
    if (!applicantId) return;
    const map = { ...(this.unreadByApplicant || {}) };
    if (value) map[applicantId] = true; else delete map[applicantId];
    this.unreadByApplicant = map;
    this.saveUnreadToStorage();
  }

  private clearUnread(applicantId: string): void {
    if (!applicantId) return;
    if (this.unreadByApplicant && this.unreadByApplicant[applicantId]) {
      const map = { ...(this.unreadByApplicant || {}) };
      delete map[applicantId];
      this.unreadByApplicant = map;
      this.saveUnreadToStorage();
    }
  }

  private markThreadRead(applicantId: string): void {
    if (!applicantId) return;
    const latestTs = this.resolveLatestInboundTs(this.panelMessages);
    const map = { ...(this.lastSeenByApplicant || {}) };
    map[applicantId] = latestTs ?? Date.now();
    this.lastSeenByApplicant = map;
    this.saveLastSeenToStorage();
    this.clearUnread(applicantId);
  }

  private resolveLatestInboundTs(messages: any[]): number | null {
    try {
      if (!Array.isArray(messages) || !messages.length) return null;
      let max = -1;
      for (const m of messages) {
        if (!m || m.direction !== 'inbound') continue;
        const ts = typeof m.__ts === 'number' ? m.__ts : null;
        if (ts && ts > max) max = ts;
      }
      return max > 0 ? max : null;
    } catch { return null; }
  }

  statusMetaIcon(status: string | undefined): string {
    const s = (status || '').toString();
    switch (s) {
      case 'delivered':
        return 'icon-check-circle';
      case 'not_delivered':
        return 'icon-x-circle';
      case 'pending':
      case 'sending':
        return 'icon-clock';
      default:
        return 'icon-circle';
    }
  }
}
