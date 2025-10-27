import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DriveWhipCommandResponse, IDriveWhipCoreAPI } from '../../../../core/models/entities.model';
import { Utilities } from '../../../../Utilities/Utilities';
import { ApplicantPanelComponent } from '../locations/applicants/applicants-panel.component';
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

@Component({
  selector: 'app-messenger',
  standalone: true,
  imports: [CommonModule, FormsModule, ApplicantPanelComponent],
  templateUrl: './messenger.component.html',
  styleUrls: ['./messenger.component.scss']
})
export class MessengerComponent implements OnInit, OnDestroy {
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
  panelHistory: any[] = [];
  panelHistoryLoading = false;
  panelHistoryError: string | null = null;

  // Documents state
  panelDocs: Array<{ name: string; url?: string }> = [];
  panelDocsLoading = false;
  panelDocsError: string | null = null;

  private _panelSubs: Subscription[] = [];

  constructor(private core: DriveWhipCoreService) {}

  ngOnInit(): void {
    this.loadLocations();
    this.loadChats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
    this.loadLocations();
    this.loadChats();
  }

  onDraftMessageChange(value: string): void {
    this.draftMessage = value;
  }

  onTabChange(tab: 'general' | 'messages' | 'history' | 'files'): void {
    this.activeTab = tab;
  }

  onClosePanel(): void {
    this.selectedApplicantId = null;
    this.selectedApplicantName = null;
  }

  private loadLocations(): void {
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
          if (!this.selectedLocationId && this.locations.length) {
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

  private loadChats(): void {
    this.chatsLoading = true;
    this.chatsError = null;
    const api = {
      // Call the new procedure that accepts an optional location id
      commandName: DriveWhipAdminCommand.crm_applicants_chat_list_location,
      // Stored procedure expects a single parameter: p_id_location (BIGINT) or NULL
      parameters: [this.selectedLocationId ?? null]
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
        this.panelMessages = rows.map((r: any) => ({
          id: r.id ?? r.ID ?? null,
          direction: (r.Direction ?? r.message_direction ?? '').toString().toLowerCase() === 'outbound' ? 'outbound' : 'inbound',
          body: String(r.Message ?? r.message_text ?? ''),
          timestamp: String(r.sent_at ?? r.SENT_AT ?? r.created_at ?? r.CREATED_AT ?? ''),
          channel: String(r.Channel ?? r.channel ?? 'SMS'),
          status: r.status ?? r.Status ?? null,
        }));
      },
      error: (err) => {
        console.error('[Messenger] loadPanelChat error', err);
        this.panelMessages = [];
        this.panelMessagesError = 'Failed to load chat';
      },
      complete: () => {
        this.panelMessagesLoading = false;
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
        let raw: any = res.data;
        if (Array.isArray(raw) && Array.isArray(raw[0])) raw = raw[0];
        const rows = Array.isArray(raw) ? raw : [];
        this.panelHistory = rows.map((r: any) => ({
          id: r.id ?? r.ID ?? null,
          type: r.event_type ?? r.TYPE ?? null,
          text: r.event_text ?? r.text ?? r.description ?? '',
          time: r.event_date ?? r.date ?? r.created_at ?? '',
        }));
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
          this.panelDocs = [];
          this.panelDocsError = String(res?.error || 'Failed to load documents');
          return;
        }
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const rows = Array.isArray(raw) ? raw : [];
        const docs = rows.map((r: any) => ({ name: r.document_name ?? r.DOCUMENT_NAME ?? r.document ?? 'file', url: undefined }));
        this.panelDocs = docs;
        // try to resolve URLs
        for (const d of this.panelDocs) {
          const fetchSub = this.core.fetchFile('', d.name).subscribe({
            next: (resp) => { if (resp?.data?.url) d.url = resp.data.url; },
            error: () => {/* ignore */}
          });
          this._panelSubs.push(fetchSub);
        }
      },
      error: (err) => {
        console.error('[Messenger] loadPanelDocuments error', err);
        this.panelDocs = [];
        this.panelDocsError = 'Failed to load documents';
      },
      complete: () => {
        this.panelDocsLoading = false;
      }
    });
    this._panelSubs.push(sub);
  }
}
