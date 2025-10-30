import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { DriveWhipCoreService } from '../../../../core/services/drivewhip-core/drivewhip-core.service';
import { DriveWhipAdminCommand } from '../../../../core/db/procedures';

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

  locations: MessengerLocation[] = [];
  locationsLoading = false;
  locationsError: string | null = null;

  chatThreads: MessengerChatThread[] = [];
  chatsLoading = false;
  chatsError: string | null = null;

  selectedLocationId: number | null = null;
  selectedApplicantId: string | null = null;
  selectedApplicantName: string | null = null;

  draftMessage = '';
  activeTab: 'general' | 'messages' | 'history' | 'files' = 'messages';

  private destroy$ = new Subject<void>();
  // Applicant detail / panel clone state
  applicant: any = null;
  applicantLoading = false;
  applicantError: string | null = null;

  // Chat (messages) state for cloned panel
  panelMessages: any[] = [];
  panelMessagesLoading = false;
  panelMessagesError: string | null = null;

  // History state
  panelHistory: MessengerHistoryEvent[] = [];
  panelHistoryLoading = false;
  panelHistoryError: string | null = null;

  // Documents state
  documentGroups: DocumentGroup[] = [];
  panelDocsLoading = false;
  panelDocsError: string | null = null;

  private _panelSubs: Subscription[] = [];
  private _scrollTimer: any;

  constructor(private core: DriveWhipCoreService) {}

  ngOnInit(): void {
    this.loadLocations();
    this.loadChats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = undefined as any;
    }
  }

  trackByLocation = (_: number, item: MessengerLocation) => item.id;
  trackByThread = (_: number, item: MessengerChatThread) => item.id_applicant;

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
    this.activeTab = 'messages';
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
      this.scrollMessagesToBottomSoon();
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
    return this.readApplicantProp('phone', 'PHONE', 'phone_mobile', 'PHONE_MOBILE');
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
    if (this.selectedApplicantId) {
      rows.push({ label: 'Applicant ID', value: this.selectedApplicantId });
    }
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
    const datePart = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timePart = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
      with_detail: withDetail
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

  isImageDocument(doc: ApplicantDocument | null | undefined): boolean {
    if (!doc?.document_name) return false;
    return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(doc.document_name);
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

  /** Scroll the messages container to the bottom on the next tick */
  private scrollMessagesToBottomSoon(delay: number = 50): void {
    try {
      if (this._scrollTimer) clearTimeout(this._scrollTimer);
      this._scrollTimer = setTimeout(() => {
        try {
          const el = this.messagesScroll?.nativeElement;
          if (!el) return;
          el.scrollTop = el.scrollHeight;
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
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
      },
      error: (err) => {
        this.chatsLoading = false;
        this.chatsError = 'Failed to load chats';
        console.error('[Messenger] loadChats error', err);
      }
    });
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
      }
    });
    this._panelSubs.push(sub);
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
        this.panelMessages = rows.map((r: any) => ({
          id: r.id ?? r.ID ?? null,
          direction: (r.Direction ?? r.message_direction ?? '').toString().toLowerCase() === 'outbound' ? 'outbound' : 'inbound',
          body: String(r.Message ?? r.message_text ?? ''),
          timestamp: String(r.sent_at ?? r.SENT_AT ?? r.created_at ?? r.CREATED_AT ?? ''),
          channel: String(r.Channel ?? r.channel ?? 'SMS'),
          status: r.status ?? r.Status ?? null,
        })).reverse();
        this.scrollMessagesToBottomSoon();
      },
      error: (err) => {
        console.error('[Messenger] loadPanelChat error', err);
        this.panelMessages = [];
        this.panelMessagesError = 'Failed to load chat';
      },
      complete: () => {
        this.panelMessagesLoading = false;
        this.scrollMessagesToBottomSoon();
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
}
