import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  HostListener,
  inject,
} from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { Subscription, firstValueFrom } from "rxjs";
import { finalize } from "rxjs/operators";
import Swal from "sweetalert2";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { NgxMaskDirective } from "ngx-mask";
import { DriveWhipCoreService } from "../../../../../core/services/drivewhip-core/drivewhip-core.service";
import {
  DriveWhipCommandResponse,
  IDriveWhipCoreAPI,
} from "../../../../../core/models/entities.model";
import { DriveWhipAdminCommand } from "../../../../../core/db/procedures";
import { Utilities } from "../../../../../Utilities/Utilities";
import { AuthSessionService } from "../../../../../core/services/auth/auth-session.service";
import {
  ApplicantChatRealtimeMessage,
  SmsChatSignalRService,
} from "../../../../../core/services/signalr/sms-chat-signalr.service";
import { AppConfigService } from "../../../../../core/services/app-config/app-config.service";
import { CryptoService } from "../../../../../core/services/crypto/crypto.service";
import { Router } from "@angular/router";
import {
  RoutePermissionAction,
  RoutePermissionService,
} from "../../../../../core/services/auth/route-permission.service";
import { PHONE_COUNTRIES, PhoneCountry } from "../../../../../shared/phone-countries";

@Component({
  selector: "app-applicant-panel",
  standalone: true,
  imports: [CommonModule, FormsModule, NgxMaskDirective],
  templateUrl: "./applicants-panel.component.html",
  styleUrls: ["./applicants-panel.component.scss"],
})
export class ApplicantPanelComponent implements OnChanges, OnInit, OnDestroy {
  private readonly defaultSectionIds = ["info", "status", "notes", "details"];
  openSections = new Set<string>(this.defaultSectionIds);
  menuOpen = false;
  stageMenuOpen = false;
  @ViewChild("moreActionsWrapper", { static: false })
  moreActionsWrapper?: ElementRef;
  @ViewChild("messagesScroll", { static: false })
  messagesScroll?: ElementRef<HTMLDivElement>;
  @ViewChild("emailEditorRef", { static: false })
  emailEditorRef?: ElementRef<HTMLDivElement>;
  @ViewChild("recollectEditorRef", { static: false })
  recollectEditorRef?: ElementRef<HTMLDivElement>;
  @ViewChild("composerInput", { static: false })
  composerInput?: ElementRef<HTMLInputElement>;
  @ViewChild("countrySearchInput", { static: false })
  countrySearchInput?: ElementRef<HTMLInputElement>;
  // SMS textarea for caret-aware variable insertion
  @ViewChild("smsArea", { static: false })
  smsArea?: ElementRef<HTMLTextAreaElement>;
  @ViewChild("templateSearchInput", { static: false })
  templateSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('desktopFrame', { static: false }) desktopFrame?: ElementRef<HTMLIFrameElement>;
  @ViewChild('mobileFrame', { static: false }) mobileFrame?: ElementRef<HTMLIFrameElement>;
  @ViewChild('recollectDesktopFrame', { static: false }) recollectDesktopFrame?: ElementRef<HTMLIFrameElement>;
  @ViewChild('recollectMobileFrame', { static: false }) recollectMobileFrame?: ElementRef<HTMLIFrameElement>;
  private authSession = inject(AuthSessionService);
  private sanitizer = inject(DomSanitizer);
  private smsRealtime = inject(SmsChatSignalRService);
  private appConfig = inject(AppConfigService);
  private crypto = inject(CryptoService);
  private router = inject(Router);
  private readonly permissions = inject(RoutePermissionService);
  @Input() applicant: any;
  @Input() applicantId: string | null = null;
  @Input() activeTab: "messages" | "history" | "files" = "messages";
  @Input() hasPrevious: boolean = false;
  @Input() hasNext: boolean = false;
  @Input() draftMessage: string = "";
  @Input() messages: ApplicantMessage[] | null = null;
  @Input() locationName: string | null = null;
  @Input() stageName: string | null = null;
  @Input() history: Array<{
    type?: string;
    text?: string;
    time?: string;
  }> | null = null;
  @Input() stageIcon: string = "icon-layers";
  @Input() availableStages: any[] = [];
  @Input() currentStageId: number | null = null;
  @Input() status: ApplicantStatus | null = null;
  @Input() statuses: Array<ApplicantStatus & { order?: number }> | null = null;
  // Controls visibility of file moderation actions (Approve / Re-collect)
  @Input() uploadFiles: boolean = false;
  /** When true the panel is rendered in read-only / informational mode (no actions, no editing, no tab changes) */
  @Input() readOnly: boolean = false;
  @Output() draftMessageChange = new EventEmitter<string>();
  @Output() closePanel = new EventEmitter<void>();
  @Output() goToPrevious = new EventEmitter<void>();
  @Output() goToNext = new EventEmitter<void>();
  @Output() setTab = new EventEmitter<"messages" | "history" | "files">();
  @Output() sendMessage = new EventEmitter<Event>();
  @Output() stageMoved = new EventEmitter<{
    idApplicant: string;
    toStageId: number;
  }>();
  @Output() applicantSaved = new EventEmitter<any>();
  @Output() applicantDeleted = new EventEmitter<string>();

  // Notes state
  notes: Array<any> = [];
  notesLoading = false;
  notesSaving = false;
  newNoteText = "";

  // Stage move state
  movingStage = false;

  // Applicant details state
  applicantDetailsLoading = false;
  applicantDetailsError: string | null = null;
  private lastLoadedApplicantId: string | null = null;
  private cachedApplicantDetails: any = null;

  // Registration answers state
  answersLoading = false;
  answersError: string | null = null;
  answers: Array<{
    id_question?: any;
    id_question1?: any;
    answer_text?: string;
    answered_at?: any;
    created_at?: any;
    question?: string;
  }> = [];
  showAllAnswers: boolean = false;

  // Files/documents state
  documentGroups: DocumentGroup[] = [];
  docsLoading = false;
  docsError: string | null = null;
  private docsLoadedForApplicantId: string | null = null;

  // Image viewer state
  imageViewerOpen = false;
  viewerDocs: ApplicantDocument[] = [];
  viewerIndex = 0;
  viewerCurrentUrl = "";
  viewerLoading = false;

  // Copy-to-clipboard feedback
  copyFeedbackKey: string | null = null;
  private _copyFeedbackTimer: any = null;
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
  private realtimeSub: Subscription | null = null;
  private currentRealtimeApplicantId: string | null = null;
  private realtimeRefreshTimer: any = null;

  // Message templates modal state
  templatesModalOpen = false;
  templatesLoading = false;
  templatesError: string | null = null;
  templateSearchTerm = "";
  messageTemplates: MessageTemplateSummary[] = [];
  private templatesRequestSub: Subscription | null = null;
  templateApplyLoading = false;
  templateApplyingId: string | number | null = null;
  private _templateApplyToken = 0;
  private templateApplyError: string | null = null;

  // History (timeline) state
  historyLoading = false;
  historyError: string | null = null;
  private historyEvents: Array<any> = [];
  private historyLoadedForApplicantId: string | null = null;
  eventOptionsLoading = false;
  eventOptionsError: string | null = null;
  eventOptions: Array<{ event_type: string; description: string }> = [];
  selectedEventPrefix: string = "all";

  // Event sidebar (history detail) state
  eventSidebarOpen = false;
  selectedHistoryEvent: any | null = null;
  eventDetailLoading = false;
  eventDetailError: string | null = null;
  eventDetailText: string = "";
  // Event sidebar - document preview state (for document-type events)
  eventDocLoading = false;
  eventDocError: string | null = null;
  eventDoc: ApplicantDocument | null = null;
  // Guard and cancel in-flight doc preview loads to avoid race conditions
  private _eventDocLoadSeq = 0;
  private _activeEventDocToken = 0;
  private _eventDocSub: Subscription | null = null;
  private _fallbackHistorySource: any[] | null = null;
  private _normalizedFallbackHistory: any[] = [];

  // Email composer sidebar state
  emailSidebarOpen = false;
  emailFrom: string = "";
  emailTo: string = "";
  emailSubject: string = "";
  emailContent: string = ""; // HTML
  emailSending = false;
  emailDelay = false;
  emailPreviewMode: "desktop" | "mobile" = "desktop";
  emailSourceMode = false;
  // Editor UI state
  emailEditorHeight: number = 480;
  // Inline templates list state
  emailTemplatesLoading = false;
  emailTemplatesError: string | null = null;
  emailTemplatesData: MessageTemplateSummary[] = [];

  // SMS composer sidebar state
  smsSidebarOpen = false;
  smsFrom: string = "";
  smsTo: string = "";
  smsMessage: string = "";
  smsDelay = false;
  smsSending = false;
  // Inline template pickers state (Email/SMS)
  emailSelectedTemplateId: string | number | null = null;
  emailTemplateLoading: boolean = false;
  emailTemplateError: string | null = null;
  smsSelectedTemplateId: string | number | null = null;
  smsTemplateLoading: boolean = false;
  smsTemplateError: string | null = null;
  smsTemplatesLoading = false;
  smsTemplatesError: string | null = null;
  smsTemplatesData: MessageTemplateSummary[] = [];
  // Variable insertion (Email/SMS composers)
  dataKeyTypes: string[] = [];
  private dataKeysCache: Record<string, string[]> = {};
  emailDataKeyType: string = "";
  emailDataKey: string = "";
  emailDataKeyOptions: string[] = [];
  smsDataKeyType: string = "";
  smsDataKey: string = "";
  smsDataKeyOptions: string[] = [];

  // Disapprove / Re-collect sidebar state
  disapproveSidebarOpen = false;
  disapproveDoc: ApplicantDocument | null = null;
  disapproveReasonOptions: Array<{ code: string; description: string }> = [];
  /** Map event code -> description */
  private disapproveReasonMap: Record<string, string> = {};
  disapproveOptionsLoading = false;
  disapproveOptionsError: string | null = null;
  disapproveReason: string = "";
  disapproveCustomReason: string = "";
  disapproveMessage: string = "";
  disapproveSendSms: boolean = false;
  disapproveNotifyOwner: boolean = false;
  disapproveSending: boolean = false;
  disapprovePreviewMode: "desktop" | "mobile" = "desktop";
  recollectSourceMode: boolean = false;
  recollectContent: string = "";
  recollectTemplateLoading = false;
  recollectTemplateError: string | null = null;
  private _recollectTemplateToken = 0;

  // --- Move To Modal state ---
  moveToOpen = false;
  moveToSaving = false;
  moveToError: string | null = null;
  moveToLocationsLoading = false;
  moveToLocationOptions: Array<{ id: number; name: string }> = [];
  moveToLocationId: number | null = null;
  moveToWorkflowsLoading = false;
  moveToWorkflowId: number | null = null;
  moveToStagesLoading = false;
  moveToStageOptions: Array<{ id: number; name: string }> = [];
  moveToStageId: number | null = null;

  /** Resolve stage name from current Move To stage options by id */
  displayStageName(id: number | null | undefined): string {
    if (id === null || id === undefined) return "";
    const sid = Number(id);
    if (!Number.isFinite(sid)) return "";
    const found = (this.moveToStageOptions || []).find(
      (st) => Number(st.id) === sid
    );
    return found?.name || "";
  }

  // Open SMS composer using iPhone preview
  openSmsSidebar(): void {
    this.closeMenus();
    if (this.eventSidebarOpen) this.closeEventSidebar();
    if (this.emailSidebarOpen) this.closeEmailSidebar();

    const to = this.getApplicantPhone(this.applicant) || "";
    const defaultFrom = this.defaultSmsFromNumber();
    this.smsFrom = defaultFrom;
    this.smsTo = to;
    this.smsMessage = "";
    this.smsDelay = false;
    // Reset inline Template selector so it doesn't keep previous selection
    this.smsSelectedTemplateId = null;
    this.smsTemplateError = null;
    this.smsTemplateLoading = false;
    this.smsSidebarOpen = true;
    this.updatePhoneSubscription().catch(() => {});
    // Ensure SMS templates are available for the inline selector
    this.loadSmsTemplates();
  }

  closeSmsSidebar(): void {
    this.smsSidebarOpen = false;
  }

  viewEmploymentSummary(): void {
    // Resolve applicant id
    const id = this.resolveApplicantId(this.applicant) || this.applicantId;
    if (!id) {
      Swal.fire({
        icon: "info",
        title: "Argyle Information",
        text: "We couldn't identify the applicant.",
        confirmButtonText: "Close",
        allowOutsideClick: false,
      });
      return;
    }

    // Show loading state
    void Swal.fire({
      title: "Argyle Information",
      html: '<div class="small text-secondary d-flex align-items-center gap-2"><span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Loading Argyle profile…</div>',
      width: 800,
      allowOutsideClick: false,
      showConfirmButton: false,
      showCloseButton: false,
      didOpen: () => Swal.showLoading(),
    });

    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_argyle_json_user as any,
      parameters: [String(id)],
    } as any;

    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        try {
          // Ensure loading spinner is removed before rendering final content
          try {
            Swal.hideLoading();
          } catch {}
          if (!res?.ok) {
            Swal.update({
              icon: "info",
              html: '<div class="text-secondary">No Argyle information available for this applicant.</div>',
              showConfirmButton: true,
              confirmButtonText: "Close",
            });
            return;
          }
          // Extract first row
          let raw: any = res.data;
          if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
          const row = Array.isArray(raw) ? raw[0] ?? null : raw;
          const jsonInfo =
            row?.JSONInfo ??
            row?.json_info ??
            row?.JsonInfo ??
            row?.jsonInfo ??
            null;
          if (!jsonInfo) {
            try {
              Swal.hideLoading();
            } catch {}
            Swal.update({
              icon: "info",
              html: '<div class="text-secondary">No Argyle information available for this applicant.</div>',
              showConfirmButton: true,
              confirmButtonText: "Close",
            });
            return;
          }
          let profile: any = null;
          if (typeof jsonInfo === "string") {
            try {
              profile = JSON.parse(jsonInfo);
            } catch {
              profile = null;
            }
          } else if (typeof jsonInfo === "object") {
            profile = jsonInfo;
          }
          if (!profile) {
            try {
              Swal.hideLoading();
            } catch {}
            Swal.update({
              icon: "info",
              html: '<div class="text-secondary">Argyle data format is invalid or empty.</div>',
              showConfirmButton: true,
              confirmButtonText: "Close",
            });
            return;
          }
          const html = this.buildEmploymentDetailsMarkup(profile);
          try {
            Swal.hideLoading();
          } catch {}
          Swal.update({
            icon: undefined as any,
            html,
            showCloseButton: true,
            showConfirmButton: true,
            confirmButtonText: "Close",
            customClass: { popup: "employment-profile-popup" },
          });
        } catch (e) {
          try {
            Swal.hideLoading();
          } catch {}
          Swal.update({
            icon: "error",
            html: '<div class="text-danger">Failed to render Argyle information.</div>',
            showConfirmButton: true,
            confirmButtonText: "Close",
          });
        }
      },
      error: (err) => {
        try {
          Swal.hideLoading();
        } catch {}
        Swal.update({
          icon: "error",
          html: '<div class="text-danger">Failed to load Argyle information.</div>',
          showConfirmButton: true,
          confirmButtonText: "Close",
        });
      },
    });
  }

  /**
   * Renderiza dinámicamente cualquier objeto JSON con estilo NobleUI.
   */
  private buildEmploymentDetailsMarkup(profile: any): string {
    const renderValue = (value: any): string => {
      if (value === null || value === undefined) {
        return `<span class="badge bg-secondary text-white">N/A</span>`;
      }
      if (typeof value === "boolean") {
        return value
          ? `<span class="badge bg-success">Yes</span>`
          : `<span class="badge bg-danger">No</span>`;
      }
      if (!isNaN(Date.parse(value))) {
        return `<span class="badge bg-primary text-white">${new Date(
          value
        ).toLocaleDateString()}</span>`;
      }
      if (typeof value === "number") {
        return `<span class="badge bg-info">${value}</span>`;
      }
      if (typeof value === "string" && value.startsWith("http")) {
        return `<a href="${value}" target="_blank" class="text-primary text-decoration-underline">Open link</a>`;
      }
      return `<span class="fw-semibold">${value}</span>`;
    };

    const prettifyKey = (key: string): string =>
      key
        .replace(/_/g, " ")
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase());

    const renderObject = (obj: any): string => {
      let html = `<div class="card border-0 shadow-sm mb-3"><div class="card-body shadow-sm rounded">`;

      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          html += `
          <div class="border-start border-3 border-primary ps-3 py-2">
            <h6 class="fw-bold text-primary mb-2"><i class="mdi mdi-folder-outline me-1"></i>${prettifyKey(
              key
            )}</h6>
            ${renderObject(value)}
          </div>`;
        } else if (Array.isArray(value)) {
          html += `
          <div class="mb-3">
            <h6 class="fw-bold text-secondary"><i class="mdi mdi-format-list-bulleted me-1"></i>${prettifyKey(
              key
            )}</h6>
            <div class="row">
              ${value
                .map(
                  (item, i) => `
                <div class="col-md-6">
                  <div class="card shadow-sm mb-2">
                    <div class="card-body">
                      <h6 class="text-muted mb-2">Item ${i + 1}</h6>
                      ${
                        typeof item === "object"
                          ? renderObject(item)
                          : renderValue(item)
                      }
                    </div>
                  </div>
                </div>`
                )
                .join("")}
            </div>
          </div>`;
        } else {
          html += `
          <div class="d-flex justify-content-between align-items-center border-bottom py-2">
            <span class="text-muted"><i class="mdi mdi-tag-outline me-1"></i>${prettifyKey(
              key
            )}</span>
            ${renderValue(value)}
          </div>`;
        }
      }

      html += `</div></div>`;
      return html;
    };

    return renderObject(profile);
  }

  onSmsInput(val: string): void {
    // Enforce max length 1000 like mock
    this.smsMessage = (val || "").toString().slice(0, 1000);
  }

  get smsCharCount(): number {
    return (this.smsMessage || "").length;
  }
  get smsSegments(): number {
    // Simple segmentation: 160 chars per segment (GSM). This is an approximation.
    const len = this.smsCharCount;
    if (len === 0) return 0;
    return Math.ceil(len / 160);
  }

  async sendSms(): Promise<void> {
    const text = (this.smsMessage || "").trim();
    const id = this.resolveApplicantId(this.applicant) || this.applicantId;
    const to = (this.smsTo || "").trim();
    const from = (this.smsFrom || "").trim();
    if (!text || !id || !to || !from || this.smsSending) return;

    this.smsSending = true;
    let finalMessage = text;
    try {
      const prepared = await firstValueFrom(
        this.core.prepareNotificationMessage("sms", String(id), text)
      );
      if ((prepared || "").trim()) {
        finalMessage = prepared;
      }
    } catch (err) {
      console.error("[ApplicantPanel] prepare SMS error", err);
      Utilities.showToast(
        this.notificationErrorMessage(err, "Failed to prepare SMS message"),
        "error"
      );
      this.smsSending = false;
      return;
    }

    const optimistic: ApplicantMessage = {
      id: "temp-sms-" + Date.now(),
      direction: "outbound",
      sender: "You",
      body: finalMessage,
      timestamp: new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date()),
      channel: "SMS",
      status: "sending",
      statusLabel: "Sending",
      automated: false,
      dayLabel: "",
      sentAt: new Date().toISOString(),
      createdBy: this.authSession.user?.user || "You",
    };
    this.messages = [...(this.messages ?? []), optimistic];
    this.refreshResolvedMessages();
    this.scrollMessagesToBottomSoon();

    try {
      await firstValueFrom(
        this.core.sendChatSms({
          from,
          to,
          message: finalMessage,
          id_applicant: String(id),
        })
      );
      try {
        this.markOptimisticDelivered(optimistic.id || "");
      } catch {}
      this.closeSmsSidebar();
    } catch (err) {
      console.error("[ApplicantPanel] sendChatSms error", err);
      try {
        this.removeOptimistic(optimistic.id || "");
      } catch {}
      this.smsSendFailureToast();
    } finally {
      this.smsSending = false;
    }
  }

  /** Whether there's an outbound SMS we can resend */
  canResendMessage(): boolean {
    const msgs: ApplicantMessage[] = this.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (
        m?.direction === "outbound" &&
        (m?.channel || "").toUpperCase() === "SMS" &&
        (m?.body || "").toString().trim()
      ) {
        return true;
      }
    }
    return false;
  }

  /** Resend the most recent outbound SMS to the applicant */
  async resendLastMessage(): Promise<void> {
    if (!this.canResendMessage()) return;
    this.closeMenus();

    const id = this.resolveApplicantId(this.applicant) || this.applicantId;
    const to = (this.getApplicantPhone(this.applicant) || "").trim();
    const from = (this.smsFrom || this.defaultSmsFromNumber()).trim();
    if (!id || !to || !from) {
      Utilities.showToast(
        "Missing phone or applicant id for resend",
        "warning"
      );
      return;
    }

    // Find last outbound SMS
    const msgs: ApplicantMessage[] = this.messages ?? [];
    let last: ApplicantMessage | null = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (
        m?.direction === "outbound" &&
        (m?.channel || "").toUpperCase() === "SMS" &&
        (m?.body || "").toString().trim()
      ) {
        last = m;
        break;
      }
    }
    const originalText = (last?.body || "").toString().trim();
    if (!originalText) {
      Utilities.showToast("No outbound SMS found to resend", "info");
      return;
    }

    let finalText = originalText;
    try {
      const prepared = await firstValueFrom(
        this.core.prepareNotificationMessage("sms", String(id), originalText)
      );
      if ((prepared || "").trim()) {
        finalText = prepared;
      }
    } catch (err) {
      console.error("[ApplicantPanel] prepare resend SMS error", err);
      Utilities.showToast(
        this.notificationErrorMessage(err, "Failed to prepare SMS message"),
        "error"
      );
      return;
    }

    // Optimistic append
    const optimistic: ApplicantMessage = {
      id: "temp-resend-" + Date.now(),
      direction: "outbound",
      sender: "You",
      body: finalText,
      timestamp: new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date()),
      channel: "SMS",
      status: "sending",
      statusLabel: "Sending",
      automated: false,
      dayLabel: "",
      sentAt: new Date().toISOString(),
      createdBy: this.authSession.user?.user || "You",
    };
    this.messages = [...(this.messages ?? []), optimistic];
    this.refreshResolvedMessages();
    this.scrollMessagesToBottomSoon();

    try {
      await firstValueFrom(
        this.core.sendChatSms({
          from,
          to,
          message: finalText,
          id_applicant: String(id),
        })
      );
      try {
        this.markOptimisticDelivered(optimistic.id || "");
      } catch {}
      Utilities.showToast("Message resent", "success");
    } catch (err) {
      console.error("[ApplicantPanel] resend SMS error", err);
      try {
        this.removeOptimistic(optimistic.id || "");
      } catch {}
      this.smsSendFailureToast();
    }
  }
  private hasPermission(action: RoutePermissionAction): boolean {
    try {
      return this.permissions.canCurrent(action);
    } catch {
      return false;
    }
  }

  canMove(): boolean {
    return this.hasPermission("Update");
  }
  canEditNotes(): boolean {
    return this.hasPermission("Update");
  }
  canDeleteNotes(): boolean {
    return this.hasPermission("Delete");
  }
  canEditApplicant(): boolean {
    return this.hasPermission("Update");
  }
  canDeleteApplicant(): boolean {
    return this.hasPermission("Delete");
  }
  // Note editing state
  private editingNoteId: any = null;
  editingNoteText: string = "";
  // Applicant editing state
  isEditingApplicant: boolean = false;
  editableApplicant: any = {};
  applicantSaving: boolean = false;
  applicantDeleting: boolean = false;

  // Phone editor state (for custom country code input)
  countryMenuOpen = false;
  countrySearch = "";
  phoneLocal = ""; // local number (formatted for display)
  selectedCountry: PhoneCountry = PHONE_COUNTRIES.find((c: PhoneCountry) => c.iso2 === 'us') || PHONE_COUNTRIES[0];
  filteredCountries: PhoneCountry[] = PHONE_COUNTRIES.slice();

  // --- States (country subdivisions) dropdown data ---
  stateOptions: Array<{ code: string; name: string; country?: string }> = [];
  statesLoading: boolean = false;
  statesError: string | null = null;

  private ensureStatesLoaded(): void {
    if (this.stateOptions.length || this.statesLoading) return;
    this.loadCountryStates();
  }

  private loadCountryStates(): void {
    this.statesLoading = true;
    this.statesError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.commun_country_states,
      parameters: [],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        try {
          if (!res.ok) {
            this.statesError = String(res.error || 'Failed to load states');
            return;
          }
          let raw: any = res.data;
          // Flatten potential [[rows]] shape
          if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
          const rows: any[] = Array.isArray(raw) ? raw : [];
          const mapped = rows
            .map(r => {
              const code = (r.state_code ?? r.STATE_CODE ?? r.code ?? r.CODE ?? '').toString().trim();
              const name = (r.state_name ?? r.STATE_NAME ?? r.name ?? r.NAME ?? r.description ?? r.DESCRIPTION ?? code).toString().trim();
              const country = (r.country_code ?? r.COUNTRY_CODE ?? r.country ?? r.COUNTRY ?? '').toString().trim();
              return { code, name, country };
            })
            .filter(x => x.code && x.name);
          // Sort by name for UX
          mapped.sort((a,b) => a.name.localeCompare(b.name));
          this.stateOptions = mapped;
        } catch (e) {
          console.error('[ApplicantPanel] loadCountryStates parse error', e);
          this.statesError = 'Failed to parse states list';
        }
      },
      error: (err) => {
        console.error('[ApplicantPanel] loadCountryStates error', err);
        this.statesError = 'Failed to load states';
      },
      complete: () => {
        this.statesLoading = false;
      }
    });
  }

  constructor(private core: DriveWhipCoreService) {}

  startEditApplicant(): void {
    if (!this.canEditApplicant()) {
      Utilities.showToast(
        "You do not have permission to edit applicants",
        "warning"
      );
      return;
    }
    this.isEditingApplicant = true;
    // ensure editableApplicant is a fresh copy
    this.editableApplicant = this.applicant ? { ...this.applicant } : {};
    // Load states list (one-time) for the address block
    this.ensureStatesLoaded();
    // initialize phone editor from current value
    const initial = this.editableApplicant?.phone || this.applicant?.phone || "";
    this.initPhoneFromValue(initial);
    // close menu when editing begins
    this.closeMenus();
  }

  cancelEditApplicant(): void {
    this.isEditingApplicant = false;
    this.editableApplicant = this.applicant ? { ...this.applicant } : {};
    this.countryMenuOpen = false;
  }

  saveApplicant(): void {
    const applicantId = this.resolveApplicantId(this.applicant);
    if (!applicantId) {
      Utilities.showToast("Applicant id missing", "warning");
      return;
    }
    const payload = { ...this.editableApplicant };
    this.applicantSaving = true;

    const fullName = (payload.name ?? "").toString().trim();
    const firstName = (
      payload.first_name ??
      this.applicant?.first_name ??
      fullName.split(" ").shift() ??
      ""
    )
      .toString()
      .trim();
    const lastName = (
      payload.last_name ??
      this.applicant?.last_name ??
      fullName.split(" ").slice(1).join(" ")
    )
      .toString()
      .trim();
    const email = (payload.email ?? this.applicant?.email ?? "")
      .toString()
      .trim();
    const phone = (payload.phone ?? "").toString().trim();
    const referral =
      payload.referral_name ?? this.applicant?.referral_name ?? null;
    const acceptTerms =
      payload.accept_terms ?? this.applicant?.accept_terms ?? false;
    const allowMsgUpdates =
      payload.allow_msg_updates ?? this.applicant?.allow_msg_updates ?? false;
    const allowCalls =
      payload.allow_calls ?? this.applicant?.allow_calls ?? false;
    const isActive = payload.is_active ?? this.applicant?.is_active ?? true;
    const countryCode =
      payload.country_code ?? this.applicant?.country_code ?? null;
    const stateCode = payload.state_code ?? this.applicant?.state_code ?? null;
    const street = payload.street ?? this.applicant?.street ?? null;
    const city = payload.city ?? this.applicant?.city ?? null;
    const zip = payload.zip_code ?? this.applicant?.zip_code ?? null;
    const createdBy =
      this.applicant?.created_by ?? this.currentUserIdentifier();
    const updatedBy = this.currentUserIdentifier();

    try {
      const params: any[] = [
        "U",
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
        updatedBy || null,
      ];
      const api: IDriveWhipCoreAPI = {
        commandName: DriveWhipAdminCommand.crm_applicants_crud as any,
        parameters: params,
      } as any;
      this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
        next: (res) => {
          if (!res.ok) {
            Utilities.showToast(
              String(res.error || "Failed to save applicant"),
              "error"
            );
            return;
          }
          Utilities.showToast("Applicant saved", "success");
          this.isEditingApplicant = false;
          this.loadApplicantDetails(applicantId);
          this.applicantSaved.emit({
            id: applicantId,
            payload: { ...this.applicant, ...payload },
          });
        },
        error: (err) => {
          console.error("[ApplicantPanel] saveApplicant error", err);
          Utilities.showToast("Failed to save applicant", "error");
          this.applicantSaving = false;
        },
        complete: () => {
          this.applicantSaving = false;
        },
      });
    } catch (e) {
      console.error("[ApplicantPanel] saveApplicant unexpected error", e);
      Utilities.showToast("Failed to save applicant", "error");
      this.applicantSaving = false;
    }
  }

  onDeleteApplicantClick(): void {
    this.closeMenus();
    if (!this.canDeleteApplicant()) {
      Utilities.showToast(
        "You do not have permission to delete applicants",
        "warning"
      );
      return;
    }
    const id = this.resolveApplicantId(this.applicant) || this.applicantId;
    if (!id) {
      Utilities.showToast("Applicant id not found", "warning");
      return;
    }
    if (this.applicantDeleting) return;
    this.confirmDeleteApplicant(String(id));
  }

  private confirmDeleteApplicant(applicantId: string): void {
    Swal.fire({
      title: "Delete applicant?",
      text: "This action cannot be undone. Are you sure you want to delete this applicant?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, delete",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#d33",
      focusCancel: true,
      reverseButtons: true,
      allowOutsideClick: false,
    }).then((result) => {
      if (result.isConfirmed) {
        this.performDeleteApplicant(applicantId);
      }
    });
  }

  private performDeleteApplicant(applicantId: string): void {
    try {
      this.applicantDeleting = true;
      const params: any[] = [
        "D",
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
      this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
        next: (res) => {
          if (!res.ok) {
            const err = String(res.error || "Failed to delete applicant");
            Utilities.showToast(err, "error");
            this.applicantDeleting = false;
            return;
          }
          Utilities.showToast("Applicant deleted", "success");
          this.isEditingApplicant = false;
          this.applicantDeleted.emit(applicantId);
          this.closePanel.emit();
        },
        error: (err) => {
          console.error("[ApplicantPanel] deleteApplicant error", err);
          Utilities.showToast("Failed to delete applicant", "error");
          this.applicantDeleting = false;
        },
        complete: () => {
          this.applicantDeleting = false;
        },
      });
    } catch (e) {
      console.error("[ApplicantPanel] deleteApplicant unexpected error", e);
      Utilities.showToast("Failed to delete applicant", "error");
      this.applicantDeleting = false;
    }
  }

  private currentUserIdentifier(): string {
    try {
      const user: any = this.authSession.user;
      if (!user) return "system";
      return user.user;
    } catch {
      return "system";
    }
  }

  private _resolvedMessages: ApplicantMessage[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["messages"] || changes["applicant"]) {
      this.refreshResolvedMessages();
    }
    if (changes["applicant"] || changes["applicantId"]) {
      this.openSections = new Set<string>(this.defaultSectionIds);
      this.closeMenus();
      const idFromApplicant = this.resolveApplicantId(this.applicant);
      const resolvedId = (this.applicantId || idFromApplicant || null) as
        | string
        | null;
      if (resolvedId && this.applicant) {
        this.hydrateApplicantFromCache(resolvedId);
      }
      // prepare editable copy for inline editing
      this.editableApplicant = this.applicant ? { ...this.applicant } : {};
      // load notes for this applicant when panel opens / applicant changes
      const id = resolvedId;
      if (id) {
        this.loadNotes(id);
      } else {
        this.notes = [];
      }
      this.updateRealtimeSubscription(id);
      const needsDetailsReload =
        !!id &&
        (id !== this.lastLoadedApplicantId ||
          !this.hasApplicantIdentity(this.applicant));
      if (needsDetailsReload) {
        this.loadApplicantDetails(id);
        // If opening with only ID, ensure there is a lightweight stub so header and info placeholders render
        if (!this.applicant) {
          this.applicant = { id };
        }
        // Reset docs cache when applicant changes
        this.docsLoadedForApplicantId = null;
      }
      // If Files tab is active, load documents for current applicant id (ensure fresh on open)
      if (this.activeTab === "files" && id) {
        this.loadApplicantDocuments(id, true);
      }
      // If Messages tab is active, load chat history
      if (this.activeTab === "messages" && id) {
        this.loadChatHistory(id, 1);
      }
      // If History tab is active, load options + events
      if (this.activeTab === "history" && id) {
        this.ensureEventOptions();
        this.loadApplicantEvents(id, this.selectedEventPrefix, true);
      }
    }
    if (changes["availableStages"]) {
      this.stageMenuOpen = false;
    }
    // Load documents when switching into Files tab and we have an applicant id
    if (changes["activeTab"] && this.activeTab === "files") {
      const idFromApplicant = this.resolveApplicantId(this.applicant);
      const id = (this.applicantId || idFromApplicant || null) as string | null;
      if (id) {
        // Force refresh when returning to Files tab
        this.loadApplicantDocuments(id, true);
      }
    }
    // Load chat when switching into Messages tab (force refresh on return)
    if (changes["activeTab"] && this.activeTab === "messages") {
      const idFromApplicant = this.resolveApplicantId(this.applicant);
      const id = (this.applicantId || idFromApplicant || null) as string | null;
      if (id) {
        this.loadChatHistory(id, 1, true);
      }
    }
    // Load history when switching into History tab
    if (changes["activeTab"] && this.activeTab === "history") {
      const idFromApplicant = this.resolveApplicantId(this.applicant);
      const id = (this.applicantId || idFromApplicant || null) as string | null;
      if (id) {
        this.ensureEventOptions();
        this.loadApplicantEvents(id, this.selectedEventPrefix, true);
      }
    }
    // Close event sidebar when leaving History tab
    if (
      changes["activeTab"] &&
      this.activeTab !== "history" &&
      this.eventSidebarOpen
    ) {
      this.closeEventSidebar();
    }
  }

  // Capture-phase document click listener so we can reliably detect clicks outside
  // the actions menu even if inner elements call stopPropagation().
  private _outsideClickListener = (evt: Event) => {
    try {
      if (!this.menuOpen) return;
      const wrapperEl = this.moreActionsWrapper?.nativeElement as
        | HTMLElement
        | undefined;
      // If we have a wrapper and the click target is inside it, do nothing.
      if (wrapperEl && wrapperEl.contains(evt.target as Node)) return;
      // Otherwise close menus
      this.closeMenus();
    } catch (e) {
      // swallow any errors
      console.error("[ApplicantPanel] outsideClickListener error", e);
    }
  };

  @HostListener("document:keydown.escape")
  handleEscape(): void {
    if (this.imageViewerOpen) {
      this.closeImageViewer();
      return;
    }
    if (this.eventSidebarOpen) {
      this.closeEventSidebar();
      return;
    }
    this.closeMenus();
  }

  @HostListener("document:keydown", ["$event"])
  onGlobalKeydown(ev: KeyboardEvent): void {
    if (!this.imageViewerOpen) return;
    const key = ev.key.toLowerCase();
    if (key === "arrowright") {
      ev.preventDefault();
      this.nextImage();
    } else if (key === "arrowleft") {
      ev.preventDefault();
      this.prevImage();
    } else if (key === "+") {
      ev.preventDefault();
      this.zoomIn();
    } else if (key === "-") {
      ev.preventDefault();
      this.zoomOut();
    } else if (key === "0") {
      ev.preventDefault();
      this.resetZoom();
    }
  }

  @HostListener("document:mousemove", ["$event"])
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

  @HostListener("document:mouseup")
  onDocumentMouseUp(): void {
    if (this.isPanning) this.isPanning = false;
  }

  ngOnInit(): void {
    this.realtimeSub = this.smsRealtime.messages().subscribe((msg) => {
      try {
        this.handleRealtimeMessage(msg);
      } catch (err) {
        try {
          console.error("[ApplicantPanel] handleRealtimeMessage error", err);
        } catch {}
        // Swallow to avoid terminating the subscription on runtime errors
      }
    });
    // use capture phase to avoid being canceled by stopPropagation on inner handlers
    document.addEventListener("click", this._outsideClickListener, true);
    void this.loadDataKeyTypes();
  }

  ngOnDestroy(): void {
    if (this.realtimeSub) {
      this.realtimeSub.unsubscribe();
      this.realtimeSub = null;
    }
    if (this.templatesRequestSub) {
      this.templatesRequestSub.unsubscribe();
      this.templatesRequestSub = null;
    }
    this.currentRealtimeApplicantId = null;
    if (this.currentRealtimePhoneNumber) {
      this.smsRealtime
        .leavePhone(this.currentRealtimePhoneNumber)
        .catch(() => {});
      this.currentRealtimePhoneNumber = null;
    }
    this.smsRealtime.disconnectIfIdle().catch(() => {});
    document.removeEventListener("click", this._outsideClickListener, true);
    if (this.realtimeRefreshTimer) {
      clearTimeout(this.realtimeRefreshTimer);
      this.realtimeRefreshTimer = null;
    }
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
    // Close the event sidebar to avoid its backdrop intercepting pointer events
    if (this.menuOpen === false && this.eventSidebarOpen) {
      this.closeEventSidebar();
    }
    this.menuOpen = !this.menuOpen;
    if (!this.menuOpen) {
      this.stageMenuOpen = false;
    }
  }

  toggleStageMenu(ev?: Event): void {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    // Simple toggle for click/keyboard interactions
    this.stageMenuOpen = !this.stageMenuOpen;
  }

  // Email composer open/close
  openEmailSidebar(): void {
    // Close other overlays/menus
    this.closeMenus();
    if (this.eventSidebarOpen) this.closeEventSidebar();
    if (this.smsSidebarOpen) this.closeSmsSidebar();

    const userEmail = this.currentUserEmail();
    const applicantEmail = (
      this.applicant?.email ||
      this.applicant?.email_address ||
      ""
    ).toString();
    this.emailFrom = userEmail || "";
    this.emailTo = applicantEmail || "";
    this.emailSubject = "";
    this.emailContent = "";
    this.emailDelay = false;
    this.emailPreviewMode = "desktop";
    this.emailSourceMode = false;
    // Reset inline Template selector so it doesn't keep previous selection
    this.emailSelectedTemplateId = null;
    this.emailTemplateError = null;
    this.emailTemplateLoading = false;
    this.emailSidebarOpen = true;
    setTimeout(() => this.syncEmailEditorFromContent(), 0);
    // Ensure Email templates are available for the inline selector
    this.loadEmailTemplates();
  }

  closeEmailSidebar(): void {
    this.emailSidebarOpen = false;
  }

  // --- Move To modal handlers ---
  openMoveToModal(): void {
    this.closeMenus();
    this.moveToError = null;
    this.moveToLocationId = null;
    this.moveToWorkflowId = null;
    this.moveToStageId = null;
    this.ensureMoveToLocations();
    this.moveToOpen = true;
  }

  closeMoveToModal(): void {
    this.moveToOpen = false;
  }

  onMoveToLocationChange(raw: any): void {
    const id = Number(raw);
    this.moveToLocationId = Number.isFinite(id) && id > 0 ? id : null;
    this.moveToWorkflowId = null;
    this.moveToStageId = null;
    if (this.moveToLocationId)
      this.loadWorkflowsForLocation(this.moveToLocationId);
  }

  onMoveToStageChange(raw: any): void {
    const id = Number(raw);
    this.moveToStageId = Number.isFinite(id) && id > 0 ? id : null;
  }

  private ensureMoveToLocations(): void {
    if (this.moveToLocationsLoading || this.moveToLocationOptions.length)
      return;
    this.moveToLocationsLoading = true;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_locations_dropdown,
      parameters: [],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        this.moveToLocationsLoading = false;
        try {
          let rows: any[] = [];
          if (res.ok && Array.isArray(res.data))
            rows = Array.isArray(res.data[0])
              ? res.data[0]
              : (res.data as any[]);
          const mapped = (rows || [])
            .map((r) => ({
              id: Number(r.id_location ?? r.ID_LOCATION ?? r.id ?? r.value),
              name: String(r.name ?? r.NAME ?? r.label ?? r.LABEL ?? ""),
            }))
            .filter((x) => Number.isFinite(x.id) && x.name);
          mapped.sort((a, b) => a.name.localeCompare(b.name));
          this.moveToLocationOptions = mapped;
          // preselect current by name if possible
          const currentLocName = (this.locationName || "").trim().toLowerCase();
          const preset = mapped.find(
            (m) => m.name.trim().toLowerCase() === currentLocName
          );
          if (preset) {
            this.moveToLocationId = preset.id;
            this.loadWorkflowsForLocation(preset.id);
          }
        } catch (e) {
          this.moveToError = "Failed to parse locations list";
        }
      },
      error: () => {
        this.moveToLocationsLoading = false;
        this.moveToError = "Failed to load locations";
      },
    });
  }

  private loadWorkflowsForLocation(locationId: number): void {
    if (!locationId) return;
    this.moveToWorkflowsLoading = true;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_workflows_list,
      parameters: [],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        this.moveToWorkflowsLoading = false;
        try {
          let rows: any[] = [];
          if (res.ok && Array.isArray(res.data))
            rows = Array.isArray(res.data[0])
              ? res.data[0]
              : (res.data as any[]);
          const filtered = (rows || []).filter(
            (r) =>
              Number(r.id_location ?? r.ID_LOCATION ?? 0) === Number(locationId)
          );
          const wf = filtered[0];
          this.moveToWorkflowId = wf
            ? Number(wf.id_workflow ?? wf.ID_WORKFLOW ?? wf.id)
            : null;
          if (this.moveToWorkflowId)
            this.loadStagesForWorkflow(this.moveToWorkflowId);
          else this.moveToStageOptions = [];
        } catch {
          this.moveToError = "Failed to parse workflows list";
        }
      },
      error: () => {
        this.moveToWorkflowsLoading = false;
        this.moveToError = "Failed to load workflows";
      },
    });
  }

  private loadStagesForWorkflow(workflowId: number): void {
    if (!workflowId) return;
    this.moveToStagesLoading = true;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_stages_list,
      parameters: [workflowId],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        this.moveToStagesLoading = false;
        try {
          let rows: any[] = [];
          if (res.ok && Array.isArray(res.data))
            rows = Array.isArray(res.data[0])
              ? res.data[0]
              : (res.data as any[]);
          const mapped = (rows || [])
            .map((r) => ({
              id: Number(r.id_stage ?? r.ID_STAGE ?? r.id),
              name: String(r.name ?? r.stage_name ?? r.NAME ?? ""),
            }))
            .filter((x) => Number.isFinite(x.id) && x.name)
            .sort((a, b) => a.name.localeCompare(b.name));
          this.moveToStageOptions = mapped;
          const currentId = this.currentStageIdNum;
          if (currentId != null && mapped.some((m) => m.id === currentId))
            this.moveToStageId = currentId;
          else this.moveToStageId = mapped.length ? mapped[0].id : null;
        } catch {
          this.moveToError = "Failed to parse stages list";
        }
      },
      error: () => {
        this.moveToStagesLoading = false;
        this.moveToError = "Failed to load stages";
      },
    });
  }

  submitMoveTo(): void {
    if (this.moveToSaving) return;
    const applId = this.resolveApplicantId(this.applicant) || this.applicantId;
    if (!this.moveToLocationId || !this.moveToStageId || !applId) {
      this.moveToError = "Select a location and stage";
      return;
    }
    const user = this.currentUserIdentifier();
    // SP signature: (p_id_location, p_id_stage, p_id_applicant, p_user)
    const params: any[] = [
      this.moveToLocationId,
      this.moveToStageId,
      applId,
      user,
    ];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_moveto_new,
      parameters: params,
    } as any;
    this.moveToSaving = true;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        this.moveToSaving = false;
        if (!res.ok) {
          this.moveToError = String(res.error || "Failed to move applicant");
          Utilities.showToast(this.moveToError, "error");
          return;
        }
        Utilities.showToast("Applicant moved", "success");
        this.moveToOpen = false;
        if (applId && this.moveToStageId)
          this.stageMoved.emit({
            idApplicant: String(applId),
            toStageId: Number(this.moveToStageId),
          });
      },
      error: () => {
        this.moveToSaving = false;
        this.moveToError = "Failed to move applicant";
        Utilities.showToast(this.moveToError, "error");
      },
    });
  }

  // Basic contenteditable toolbar actions (lightweight, no extra deps)
  emailExec(cmd: string, value?: string): void {
    try {
      document.execCommand(cmd, false, value);
    } catch {}
    if (!this.emailSourceMode) {
      this.captureEmailContentFromEditor();
    }
  }

  toggleEmailSource(): void {
    if (!this.emailSourceMode) {
      this.captureEmailContentFromEditor();
      this.emailSourceMode = true;
    } else {
      this.emailSourceMode = false;
      setTimeout(() => this.syncEmailEditorFromContent(), 0);
    }
  }

  emailInsertLink(): void {
    const url = prompt("Enter URL");
    if (url && url.trim()) {
      try {
        document.execCommand("createLink", false, url.trim());
      } catch {}
      if (!this.emailSourceMode) {
        this.captureEmailContentFromEditor();
      }
    }
  }

  onEmailEditorInput(ev: Event): void {
    const el = ev.target as HTMLElement;
    const html = el?.innerHTML || "";
    // Strip style/script/link/iframe from inline editor to avoid bleeding
    this.emailContent = this.stripDangerousTags(html);
  }

  get emailPreviewHtml(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.emailContent || "");
  }

  private captureEmailContentFromEditor(): void {
    const editor = this.emailEditorRef?.nativeElement;
    if (!editor) return;
    this.emailContent = this.stripDangerousTags(editor.innerHTML || "");
  }

  // --- Template helpers for Email/SMS composers ---
  get emailTemplates(): MessageTemplateSummary[] { return this.emailTemplatesData; }

  get smsTemplates(): MessageTemplateSummary[] { return this.smsTemplatesData; }

  onEmailTemplateChange(val: any): void {
    this.emailSelectedTemplateId = val ?? null;
    // Apply immediately on selection
    void this.applyEmailSelectedTemplate();
  }

  onSmsTemplateChange(val: any): void {
    this.smsSelectedTemplateId = val ?? null;
    // Apply immediately on selection
    void this.applySmsSelectedTemplate();
  }

  async applyEmailSelectedTemplate(): Promise<void> {
    if (this.emailTemplateLoading) return;
    const id = this.emailSelectedTemplateId;
    if (id == null) return;
    const tpl = (this.emailTemplatesData || []).find(
      (t) => (t.id ?? t.code ?? null) === id || String(t.id ?? t.code ?? "") === String(id)
    );
    if (!tpl) return;
    const applicantId = this.resolveApplicantId(this.applicant) || this.applicantId;
    this.emailTemplateLoading = true;
    this.emailTemplateError = null;
    try {
      let html: string | null = null;
      if (applicantId) {
        html = await this.loadTemplateEmailHtmlFromServer(tpl, String(applicantId));
      }
      if (!html) {
        html = this.buildLocalEmailHtml(tpl);
      }
      if (!html) {
        Utilities.showToast("Template has no message content", "warning");
        return;
      }
      // Sanitize template so its global CSS (e.g., body/#bodyTable selectors) doesn't bleed into the app.
      // We convert the raw HTML into a fragment, scope inline <style> rules, and strip risky tags.
      this.emailContent = this.sanitizeAndScopeEmailHtml(html);
      // If the rich editor is visible, sync DOM
      this.syncEmailEditorFromContent();
      // Best-effort subject fill if empty
      if (!this.emailSubject?.trim() && tpl.subject) {
        const ctx = this.buildChatTemplateContext();
        let subj = this.interpolateTemplate(tpl.subject, ctx);
        subj = this.replaceAtPlaceholders(subj, ctx) ?? subj;
        subj = this.replaceSquareBracketPlaceholders(subj, ctx);
        this.emailSubject = subj;
      }
    } catch (err) {
      console.error("[ApplicantPanel] applyEmailSelectedTemplate error", err);
      this.emailTemplateError = "Failed to apply template";
      Utilities.showToast("Failed to apply template", "error");
    } finally {
      this.emailTemplateLoading = false;
    }
  }

  async applySmsSelectedTemplate(): Promise<void> {
    if (this.smsTemplateLoading) return;
    const id = this.smsSelectedTemplateId;
    if (id == null) return;
    const tpl = (this.smsTemplatesData || []).find(
      (t) => (t.id ?? t.code ?? null) === id || String(t.id ?? t.code ?? "") === String(id)
    );
    if (!tpl) return;
    const applicantId = this.resolveApplicantId(this.applicant) || this.applicantId;
    this.smsTemplateLoading = true;
    this.smsTemplateError = null;
    try {
      let text: string | null = null;
      if (applicantId) {
        text = await this.loadTemplateMessageFromServer(tpl, String(applicantId));
      }
      if (!text) {
        text = this.buildLocalTemplateMessage(tpl);
      }
      if (!text) {
        Utilities.showToast("Template has no message content", "warning");
        return;
      }
      // Use existing input handler to keep counters in sync
      this.onSmsInput(text);
    } catch (err) {
      console.error("[ApplicantPanel] applySmsSelectedTemplate error", err);
      this.smsTemplateError = "Failed to apply template";
      Utilities.showToast("Failed to apply template", "error");
    } finally {
      this.smsTemplateLoading = false;
    }
  }

  // --- Variable insertion handlers ---
  async onEmailDataKeyTypeChange(type: string): Promise<void> {
    this.emailDataKeyType = type;
    this.emailDataKey = "";
    this.emailDataKeyOptions = await this.getDataKeysForType(type);
  }

  async onSmsDataKeyTypeChange(type: string): Promise<void> {
    this.smsDataKeyType = type;
    this.smsDataKey = "";
    this.smsDataKeyOptions = await this.getDataKeysForType(type);
  }

  onInsertDataKey(channel: 'email' | 'sms', token: string): void {
    // Insert the token exactly as provided by the SP/dropdown (no transformation)
    if (!token) return;
    if (channel === 'email') {
      const editor = this.emailEditorRef?.nativeElement;
      if (editor) {
        this.insertAtContentEditableCaret(editor, token);
        this.emailContent = editor.innerHTML;
      } else {
        this.emailContent = (this.emailContent || '') + token;
      }
      this.emailDataKey = '';
      return;
    }

    // SMS: insert at current caret position when possible
    const area = this.smsArea?.nativeElement ?? null;
    const value = this.smsMessage || '';
    if (!area || area.selectionStart == null || area.selectionEnd == null) {
      // Fallback append
      this.smsMessage = value + token;
      this.onSmsInput(this.smsMessage);
      this.smsDataKey = '';
      return;
    }
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = before + token + after;
    this.smsMessage = next;
    this.onSmsInput(this.smsMessage);
    // Restore focus and caret after inserted token
    setTimeout(() => {
      try {
        area.focus();
        const pos = start + token.length;
        area.setSelectionRange(pos, pos);
      } catch {}
    }, 0);
    this.smsDataKey = '';
  }

  private async loadDataKeyTypes(): Promise<void> {
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.notifcations_datakey_type_list as any,
      parameters: [],
    } as any;
    try {
      const res = await firstValueFrom(
        this.core.executeCommand<DriveWhipCommandResponse<any>>(api)
      );
      const data = Array.isArray(res?.data)
        ? (Array.isArray(res.data[0]) ? res.data[0] : res.data)
        : [];
      const types = (data || [])
        .map((row: any) => (row.value ?? row.id ?? row.TYPE ?? row.type ?? '').toString().trim())
        .filter((v: string) => !!v);
      this.dataKeyTypes = Array.from(new Set(types));
      // Default selections and preload options like Templates page
      if (!this.smsDataKeyType && this.dataKeyTypes.length) this.smsDataKeyType = this.dataKeyTypes[0];
      if (!this.emailDataKeyType && this.dataKeyTypes.length) this.emailDataKeyType = this.dataKeyTypes[0];
      if (this.smsDataKeyType) { void this.onSmsDataKeyTypeChange(this.smsDataKeyType); }
      if (this.emailDataKeyType) { void this.onEmailDataKeyTypeChange(this.emailDataKeyType); }
    } catch (err) {
      console.error('[ApplicantPanel] loadDataKeyTypes error', err);
    }
  }

  private async getDataKeysForType(type: string): Promise<string[]> {
    const key = (type || '').toUpperCase();
    if (!key) return [];
    if (this.dataKeysCache[key]) return this.dataKeysCache[key];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.notifcations_datakey_list as any,
      parameters: [key],
    } as any;
    try {
      const res = await firstValueFrom(
        this.core.executeCommand<DriveWhipCommandResponse<any>>(api)
      );
      const rows = Array.isArray(res?.data)
        ? (Array.isArray(res.data[0]) ? res.data[0] : res.data)
        : [];
      const list = (rows || [])
        .map((row: any) => (row.data_key ?? row.value ?? row.id ?? '').toString().trim())
        .filter((v: string) => !!v);
      this.dataKeysCache[key] = list;
      return list;
    } catch (err) {
      console.error('[ApplicantPanel] getDataKeysForType error', err);
      return [];
    }
  }

  private insertAtContentEditableCaret(el: HTMLElement, text: string): void {
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      el.append(text);
      return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private async loadTemplateEmailHtmlFromServer(
    template: MessageTemplateSummary,
    idApplicant: string
  ): Promise<string | null> {
    const code = (template.code ?? template.id ?? "").toString().trim();
    if (!code) return null;
    const description = (
      template.description ||
      template.subject ||
      code
    ).toString();
    const dataKey = (template.dataKey ?? "").toString();
    const token = ++this._templateApplyToken;
    try {
      const api: IDriveWhipCoreAPI = {
        commandName: DriveWhipAdminCommand.crm_applicants_recollect_menssage,
        parameters: [idApplicant, code, description, dataKey, "email"],
      } as any;
      const res = await firstValueFrom(
        this.core.executeCommand<DriveWhipCommandResponse<any>>(api)
      );
      if (token !== this._templateApplyToken) return null;
      if (!res?.ok) return null;
      let raw: any = res.data;
      if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
      const row = Array.isArray(raw) && raw.length ? raw[0] : raw;
      const html = String(
        row?.message_email ??
          row?.MESSAGE_EMAIL ??
          row?.message ??
          row?.MESSAGE ??
          row?.body ??
          row?.BODY ??
          row?.text ??
          ""
      );
      const normalized = this.normalizeEmailBody(html);
      return normalized && normalized.trim() ? normalized : null;
    } catch (err) {
      return null;
    }
  }

  private buildLocalEmailHtml(template: MessageTemplateSummary): string | null {
    const raw = (template.rawBody || template.content || template.description || "").toString();
    let html = raw.trim();
    if (!html) return null;
    const ctx = this.buildChatTemplateContext();
    html = this.interpolateTemplate(html, ctx);
    html = this.replaceAtPlaceholders(html, ctx);
    html = this.replaceSquareBracketPlaceholders(html, ctx);
    return html;
  }

  // Replace [token] style placeholders e.g., [first_name]
  private replaceSquareBracketPlaceholders(input: string, context: any): string {
    if (!input) return input;
    return input.replace(/\[([A-Za-z0-9_.-]+)\]/g, (_m, token) => {
      const value = this.resolveAtPlaceholderToken(String(token), context);
      return value != null ? value : "";
    });
  }

  // Loaders for dedicated template lists
  private loadSmsTemplates(force: boolean = false): void {
    if (this.smsTemplatesLoading) return;
    if (!force && this.smsTemplatesData.length) return;
    this.smsTemplatesLoading = true;
    this.smsTemplatesError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_notifications_templates_chat_list,
      parameters: [],
    } as any;
    this.core
      .executeCommand<DriveWhipCommandResponse>(api)
      .pipe(finalize(() => (this.smsTemplatesLoading = false)))
      .subscribe({
        next: (res) => {
          if (!res || res.ok === false) {
            const msg = ((res as any)?.error || "Failed to load SMS templates").toString();
            this.smsTemplatesError = msg;
            return;
          }
          let rows: any[] = [];
          const data = (res as any).data;
          if (Array.isArray(data)) rows = Array.isArray(data[0]) ? data[0] : data;
          const normalized = Array.isArray(rows)
            ? rows
                .map((row: any) => this.normalizeTemplateRow(row))
                .filter((row): row is MessageTemplateSummary => !!row)
            : [];
          this.smsTemplatesData = normalized;
        },
        error: (err) => {
          this.smsTemplatesError = ((err as any)?.message || "Failed to load SMS templates").toString();
        },
      });
  }

  private loadEmailTemplates(force: boolean = false): void {
    if (this.emailTemplatesLoading) return;
    if (!force && this.emailTemplatesData.length) return;
    this.emailTemplatesLoading = true;
    this.emailTemplatesError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_notifications_templates_email_list,
      parameters: [],
    } as any;
    this.core
      .executeCommand<DriveWhipCommandResponse>(api)
      .pipe(finalize(() => (this.emailTemplatesLoading = false)))
      .subscribe({
        next: (res) => {
          if (!res || res.ok === false) {
            const msg = ((res as any)?.error || "Failed to load Email templates").toString();
            this.emailTemplatesError = msg;
            return;
          }
          let rows: any[] = [];
          const data = (res as any).data;
          if (Array.isArray(data)) rows = Array.isArray(data[0]) ? data[0] : data;
          const normalized = Array.isArray(rows)
            ? rows
                .map((row: any) => this.normalizeTemplateRow(row))
                .filter((row): row is MessageTemplateSummary => !!row)
            : [];
          this.emailTemplatesData = normalized;
        },
        error: (err) => {
          this.emailTemplatesError = ((err as any)?.message || "Failed to load Email templates").toString();
        },
      });
  }

  private syncEmailEditorFromContent(): void {
    if (this.emailSourceMode) return;
    const editor = this.emailEditorRef?.nativeElement;
    if (!editor) return;
    // Sanitize for inline editor to prevent global CSS/JS side-effects
    editor.innerHTML = this.stripDangerousTags(this.emailContent || "");
  }

  setEmailPreviewMode(mode: "desktop" | "mobile"): void {
    this.emailPreviewMode = mode;
    // Refit after mode change
    setTimeout(() => {
      if (mode === 'desktop') this.fitPreviewToFrame('desktop');
      else this.fitPreviewToFrame('mobile');
    }, 0);
  }

  // Build an iframe HTML to sandbox template CSS/JS from affecting the app while keeping
  // the existing Desktop/Mobile viewer chrome intact.
  get emailSandboxHtml(): string {
    const subject = (this.emailSubject || "[Email subject]").toString();
    const body = this.stripMergeTagsForPreview((this.emailContent || "[Message]").toString());
    const baseCss = `
      :root { color-scheme: light; }
      html, body { margin:0; padding:0; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
      img { max-width: 100%; height: auto; }
      .dw-preview-body { padding: 0; }
    `;
    const doc = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>${baseCss}</style>
        </head>
        <body>
          <div class=\"dw-preview-body\">${body}</div>
        </body>
      </html>`;
    return doc;
  }

  // Hide typical ESP merge tags (e.g., Mailchimp *|...|*) in preview only, without mutating content
  private stripMergeTagsForPreview(html: string): string {
    if (!html) return html;
    try {
      // Remove patterns like *|MC:SUBJECT|*, *|MC_PREVIEW_TEXT|*, *|ANY_TAG|*
      return html.replace(/\*\|[^|]*\|\*/g, "");
    } catch {
      return html;
    }
  }

  // Sandboxed HTML for the Re-collect (disapprove) preview. Keep it isolated without forcing background.
  get recollectSandboxHtml(): string {
    const reason = this.currentRecollectDescription();
    const reasonHtml = reason ? `<div><strong>Reason:</strong> ${this.escapeHtml(reason)}</div>` : "";
    const bodyHtml = this.recollectContent
      ? this.recollectContent
      : `<div>${this.escapeHtml(this.disapproveMessage || "")}</div>`;
    const content = `${reasonHtml}${bodyHtml}`;
    const baseCss = `
      :root { color-scheme: light; }
      html, body { margin:0; padding:0; }
      img { max-width: 100%; height: auto; }
      .dw-preview-body { padding: 0; }
    `;
    const doc = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>${baseCss}</style>
        </head>
        <body>
          <div class="dw-preview-body">${content}</div>
        </body>
      </html>`;
    return doc;
  }
  // (Iframe sandbox removed per request to keep original desktop/mobile viewers)

  // Utility: remove tags that can leak into host app when editing inline
  private stripDangerousTags(html: string): string {
    if (!html) return html;
    try {
      // Remove scripts, iframes and external stylesheets entirely
      let out = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<link\b[^>]*>/gi, "")
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");

      // Keep <style> tags only if they are already safely scoped to .dw-email-scope
      // to avoid leaking rules like body/html/#bodyTable to the host app.
      out = out.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, css: string) => {
        const text = String(css || "");
        // If any selector targets html/body/#bodyTable without the .dw-email-scope prefix, drop the block
        const unsafe = /(\bhtml\b|\bbody\b|#bodyTable)/i.test(text) && !/\.dw-email-scope/i.test(text);
        return unsafe ? "" : `<style>${text}</style>`;
      });
      return out;
    } catch {
      return html;
    }
  }

  /**
   * Sanitize and scope template HTML so global selectors like body, html, #bodyTable
   * only apply inside the preview/editor and do NOT modify the host application.
   * Approach:
   * 1. Parse into a temporary DOM element.
   * 2. Extract <style> tags; rewrite selectors to prefix with .dw-email-scope.
   *    - body, html -> .dw-email-scope
   *    - #bodyTable -> .dw-email-scope #bodyTable
   * 3. Remove external <link> stylesheet tags.
   * 4. Return wrapped HTML: <div class="dw-email-scope">...</div><style scoped>...</style>
   * NOTE: This is a lightweight client-side transform; it won't be perfect for every
   * complex CSS, but prevents the common bleed issues for background/body styles.
   */
  private sanitizeAndScopeEmailHtml(raw: string): string {
    if (!raw) return raw;
    let working = raw;
    try {
      // Remove script/iframe immediately.
      working = working
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
      const container = document.createElement('div');
      container.innerHTML = working;
      const styleEls = Array.from(container.querySelectorAll('style')) as HTMLStyleElement[];
      const scopedRules: string[] = [];
      styleEls.forEach(se => {
        const css = se.textContent || '';
        // Basic selector scoping: split by } keeping braces.
        const transformed = css.replace(/([^{}]+){/g, (match, selector) => {
          // Skip @ rules (@media, @font-face) but still allow inside to be processed recursively.
          if (/^\s*@/i.test(selector)) return match; // leave @media { etc.
          const scopedSelectors = selector
            .split(',')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length)
            .map((s: string) => {
              // Replace "body" or "html" selectors (possibly with qualifiers) with .dw-email-scope
              if (/^(html|body)([\s>:.#]|$)/i.test(s)) {
                return '.dw-email-scope' + s.replace(/^(html|body)/i, '');
              }
              // Prefix everything else unless it already targets .dw-email-scope
              if (s.startsWith('.dw-email-scope')) return s;
              return '.dw-email-scope ' + s;
            })
            .join(', ');
          return scopedSelectors + '{';
        });
        scopedRules.push(transformed);
        se.remove();
      });
      // Remove <link rel="stylesheet"> tags to prevent global leakage
      Array.from(container.querySelectorAll('link[rel="stylesheet"]')).forEach(l => l.remove());
      // Wrap remaining HTML inside scope div
      const inner = container.innerHTML;
      const styleBlock = scopedRules.length ? `<style>${scopedRules.join('\n')}</style>` : '';
      return `<div class="dw-email-scope">${inner}</div>${styleBlock}`;
    } catch (e) {
      console.warn('[ApplicantPanel] sanitizeAndScopeEmailHtml failed', e);
      return raw; // fallback to raw if parsing fails
    }
  }

  // Alias to existing escapeHtml (defined later for timeline/events); avoid duplicate definitions
  private escapeHtml(text: string): string {
    if (text === null || text === undefined) return '';
    const s = text.toString();
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Scale preview content inside iframe to fit available WIDTH (shrink-only) and allow vertical scroll
  fitPreviewToFrame(mode: 'desktop' | 'mobile', frameEl?: HTMLIFrameElement | ElementRef<HTMLIFrameElement> | null): void {
    const iframe: HTMLIFrameElement | null = (frameEl instanceof ElementRef)
      ? frameEl.nativeElement
      : (frameEl as HTMLIFrameElement) || (mode === 'desktop' ? this.desktopFrame?.nativeElement ?? null : this.mobileFrame?.nativeElement ?? null);
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) return;
      const html = doc.documentElement as HTMLElement;
      const body = (doc.body as HTMLElement) || html;
      html.style.overflowX = 'hidden';
      html.style.overflowY = 'auto';
      body.style.overflowX = 'hidden';
      body.style.overflowY = 'auto';
      body.style.transformOrigin = 'top left';
      body.style.margin = '0';
      // Reset transform to measure natural size
      body.style.transform = 'scale(1)';
      // Use scrollWidth/Height to get full content size
      const naturalW = Math.max(body.scrollWidth, body.offsetWidth);
      const naturalH = Math.max(body.scrollHeight, body.offsetHeight);
      const frameW = iframe.clientWidth || (iframe.parentElement?.clientWidth ?? 0);
      if (!naturalW || !naturalH || !frameW) return;
      const scale = Math.min(frameW / naturalW, 1);
      // Fix body box to its natural width so scaling by width works consistently
      body.style.width = naturalW + 'px';
      body.style.height = 'auto';
      body.style.transform = `scale(${scale})`;
    } catch {}
  }

  // Placeholder send handler (wire to backend when available)
  async sendEmail(): Promise<void> {
    const to = (this.emailTo || "").trim();
    if (!to) {
      Utilities.showToast("Recipient (To) is required", "warning");
      return;
    }

    const templateId = this.core.accountCreatedTemplateId || "";
    if (!templateId) {
      Utilities.showToast("Email template is not configured", "warning");
      return;
    }

    const title = (this.emailSubject || "").trim() || "Message from DriveWhip";
    // Use the editor HTML (or source HTML if source mode). Ensure non-empty HTML string
    const message = (this.emailContent || "").trim() || "<p></p>";
    const applicantKey = this.resolveApplicantId(this.applicant) || this.applicantId;

    this.emailSending = true;
    let finalMessage = message;
    try {
      const prepared = await firstValueFrom(
        this.core.prepareNotificationMessage("email", applicantKey ? String(applicantKey) : null, message)
      );
      if ((prepared || "").trim()) {
        finalMessage = prepared;
      }
    } catch (err) {
      console.error("[ApplicantPanel] prepare Email error", err);
      Utilities.showToast(
        this.notificationErrorMessage(err, "Failed to prepare email message"),
        "error"
      );
      this.emailSending = false;
      return;
    }

    try {
      await firstValueFrom(
        this.core.sendTemplateEmail({ title, message: finalMessage, templateId, to: [to] })
      );
      this.closeEmailSidebar();
      Utilities.showToast("Email sent", "success");
    } catch (err) {
      console.error("[ApplicantPanel] sendTemplateEmail error", err);
      Utilities.showToast("Failed to send email", "error");
    } finally {
      this.emailSending = false;
    }
  }

  private currentUserEmail(): string | null {
    try {
      const u: any = (this.authSession as any)?.user || null;
      if (!u) return null;
      const direct = (u.user || "").toString().trim();
      if (direct) return direct;
      // Try parse token claims if present
      const token = (u.token || u.id_token || "").toString();
      if (token && token.split(".").length === 3) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          const claim = (
            payload.email ||
            payload.upn ||
            payload.preferred_username ||
            ""
          ).toString();
          if (claim) return claim;
        } catch {}
      }
    } catch {}
    return null;
  }

  get emailFromOptions(): string[] {
    const opts = new Set<string>();
    const me = this.currentUserEmail();
    if (me) opts.add(me);
    try {
      const u: any = (this.authSession as any)?.user || null;
      const arr: any[] = Array.isArray(u?.emails) ? u.emails : [];
      for (const e of arr) {
        const s = (e || "").toString().trim();
        if (s) opts.add(s);
      }
    } catch {}
    return Array.from(opts);
  }

  closeMenus(): void {
    this.menuOpen = false;
    this.stageMenuOpen = false;
  }

  onDraftMessageChange(value: string) {
    this.draftMessage = value;
    this.draftMessageChange.emit(value);
  }

  openTemplatesModal(): void {
    this.closeMenus();
    this.templatesModalOpen = true;
    this.templateSearchTerm = "";
    if (!this.messageTemplates.length && !this.templatesLoading) {
      this.loadMessageTemplates();
    }
    setTimeout(() => {
      try {
        this.templateSearchInput?.nativeElement?.focus();
      } catch {}
    }, 80);
  }

  closeTemplatesModal(): void {
    this.templatesModalOpen = false;
    this.templateSearchTerm = "";
    this.templateApplyingId = null;
    this.templateApplyLoading = false;
    this.templateApplyError = null;
  }

  navigateToTemplates(): void {
    this.closeTemplatesModal();
    this.router.navigate(["/configuration/templates"]);
  }

  onTemplateSearchChange(value: string): void {
    this.templateSearchTerm = (value ?? "").toString();
  }

  get filteredTemplates(): MessageTemplateSummary[] {
    const term = this.templateSearchTerm.trim().toLowerCase();
    if (!term) {
      return this.messageTemplates;
    }
    return this.messageTemplates.filter((tpl) => {
      const haystack = [
        tpl.description ?? "",
        tpl.subject ?? "",
        tpl.content ?? "",
        tpl.type ?? "",
        tpl.rawBody ?? "",
        tpl.code ?? "",
        tpl.channel ?? "",
        tpl.dataKey ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }

  async selectTemplate(template: MessageTemplateSummary): Promise<void> {
    if (!template) return;
    const applicantId =
      this.resolveApplicantId(this.applicant) || this.applicantId;
    let resolved: string | null = null;
    if (applicantId) {
      resolved = await this.loadTemplateMessageFromServer(
        template,
        String(applicantId)
      );
    } else {
      Utilities.showToast("Applicant id not found", "warning");
    }
    if (!resolved) {
      resolved = this.buildLocalTemplateMessage(template);
      if (!resolved) {
        Utilities.showToast("Template has no message content", "warning");
        return;
      }
    }
    this.onDraftMessageChange(resolved);
    this.closeTemplatesModal();
    setTimeout(() => {
      try {
        this.composerInput?.nativeElement?.focus();
      } catch {}
    }, 60);
  }

  private buildLocalTemplateMessage(
    template: MessageTemplateSummary
  ): string | null {
    const rawSource =
      (template.rawBody && template.rawBody.trim()) ||
      template.content ||
      template.description ||
      "";
    const textSource = rawSource
      ? this.htmlToSmsText(rawSource)
      : (template.content || "").toString();
    let rendered = (textSource || "").trim();
    if (!rendered) {
      return null;
    }
    const context = this.buildChatTemplateContext();
    rendered = this.interpolateTemplate(rendered, context);
    rendered = this.replaceAtPlaceholders(rendered, context);
    rendered = rendered
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!rendered) {
      return null;
    }
    if (rendered.length > 1000) {
      rendered = rendered.slice(0, 1000).trimEnd();
    }
    return rendered;
  }

  private replaceAtPlaceholders(input: string, context: any): string {
    if (!input) return input;
    return input.replace(/@([A-Za-z0-9_.-]+)/g, (_match, token) => {
      const value = this.resolveAtPlaceholderToken(token, context);
      return value != null ? value : "";
    });
  }

  private resolveAtPlaceholderToken(
    token: string,
    context: any
  ): string | null {
    if (!token) return null;
    const normalized = token.trim();
    if (!normalized) return null;
    const results: string[] = [];
    const push = (path: string | null | undefined) => {
      if (!path) return;
      if (!results.includes(path)) results.push(path);
    };
    const base = normalized.replace(/-/g, "_");
    push(base);
    if (base.includes("_")) {
      push(base.replace(/_/g, "."));
    }
    push(`applicant.${base}`);
    if (base.includes("_")) {
      push(`applicant.${base.replace(/_/g, ".")}`);
    }
    const camel = base.replace(/_([a-zA-Z0-9])/g, (_m, ch: string) =>
      ch ? ch.toUpperCase() : ch
    );
    push(camel);
    push(`applicant.${camel}`);
    const pascal =
      camel.length > 0 ? camel[0].toUpperCase() + camel.slice(1) : camel;
    push(`applicant${pascal}`);
    switch (base) {
      case "first_name":
      case "firstname":
        push("applicant.first_name");
        push("applicantFirstName");
        break;
      case "last_name":
      case "lastname":
        push("applicant.last_name");
        push("applicantLastName");
        break;
      case "full_name":
      case "fullname":
        push("applicant.full_name");
        push("applicantFullName");
        break;
      case "stage":
      case "stage_name":
        push("stage.name");
        push("stageName");
        break;
      case "location":
      case "location_name":
        push("location.name");
        push("locationName");
        break;
      case "status":
      case "status_name":
        push("status.statusName");
        push("statusName");
        break;
      case "phone":
      case "phone_number":
      case "applicant_phone":
        push("applicantPhone");
        break;
      case "email":
      case "email_address":
      case "applicant_email":
        push("applicantEmail");
        break;
      case "user":
      case "agent":
        push("user.user");
        push("user.email");
        push("user.name");
        break;
    }
    for (const path of results) {
      const val = this.resolvePath(context, path);
      if (val !== undefined && val !== null) {
        const str = String(val).trim();
        if (str) return str;
      }
    }
    return null;
  }

  private async loadTemplateMessageFromServer(
    template: MessageTemplateSummary,
    idApplicant: string
  ): Promise<string | null> {
    const code = (template.code ?? template.id ?? "").toString().trim();
    if (!code) {
      // No remote code available; fall back to local content without warning
      return null;
    }
    const description = (
      template.description ||
      template.subject ||
      code
    ).toString();
    const dataKey = (template.dataKey ?? "").toString();
    const rawChannel = (template.channel ?? template.type ?? "")
      .toString()
      .trim()
      .toLowerCase();
    const channel = rawChannel.includes("email") ? "email" : "sms";
    const token = ++this._templateApplyToken;
    this.templateApplyingId = template.id ?? template.code ?? null;
    this.templateApplyLoading = true;
    this.templateApplyError = null;
    try {
      const api: IDriveWhipCoreAPI = {
        commandName:
          DriveWhipAdminCommand.crm_applicants_recollect_menssage as any,
        parameters: [idApplicant, code, description, dataKey, channel],
      } as any;
      const res = await firstValueFrom(
        this.core.executeCommand<DriveWhipCommandResponse<any>>(api)
      );
      if (token !== this._templateApplyToken) {
        return null;
      }
      let html = "";
      if (res?.ok) {
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const row = Array.isArray(raw) && raw.length ? raw[0] : raw;
        if (channel === "email") {
          html = this.normalizeEmailBody(
            String(
              row?.message_email ??
                row?.MESSAGE_EMAIL ??
                row?.message ??
                row?.MESSAGE ??
                row?.body ??
                row?.BODY ??
                row?.text ??
                ""
            )
          );
        } else {
          html = String(
            row?.message_sms ??
              row?.MESSAGE_SMS ??
              row?.message ??
              row?.MESSAGE ??
              row?.sms ??
              row?.SMS ??
              row?.body ??
              row?.BODY ??
              row?.text ??
              ""
          );
        }
      } else {
        const errMsg = ((res as any)?.error || "").toString().trim();
        if (errMsg) {
          this.templateApplyError = errMsg;
          Utilities.showToast(errMsg, "warning");
        }
      }
   
      const normalized =
        channel === "email"
          ? this.htmlToSmsText(html).trim()
          : String(html || "").trim();

      return normalized.length > 1000
        ? normalized.slice(0, 1000).trimEnd()
        : normalized;
    } catch (err) {
      if (token === this._templateApplyToken) {
        console.error(
          "[ApplicantPanel] loadTemplateMessageFromServer error",
          err
        );
        this.templateApplyError = "Unable to load the template message.";
        Utilities.showToast("Unable to load the template message.", "error");
      }
      return null;
    } finally {
      if (token === this._templateApplyToken) {
        this.templateApplyLoading = false;
        this.templateApplyingId = null;
      }
    }
  }

  retryLoadTemplates(): void {
    this.loadMessageTemplates(true);
  }

  trackTemplate(
    _index: number,
    item: MessageTemplateSummary
  ): string | number | null {
    return item?.id ?? item?.description ?? null;
  }

  private buildChatTemplateContext(): any {
    const context: any = {
      applicant: this.applicant || {},
    };
    try {
      const app: any = this.applicant || {};
      const rawFirstSource = app.first_name ?? app.firstname ?? app.name ?? "";
      const first = rawFirstSource
        ? String(rawFirstSource).trim().split(" ")[0] ?? ""
        : "";
      const last = String(app.last_name ?? app.lastname ?? "").trim();
      const fullNameCandidate =
        app.full_name ??
        app.display_name ??
        `${app.first_name ?? app.firstname ?? ""} ${
          app.last_name ?? app.lastname ?? ""
        }`;
      const fullName = String(fullNameCandidate ?? "").trim();
      if (first) context.applicantFirstName = first.trim();
      if (last) context.applicantLastName = last;
      if (fullName) context.applicantFullName = fullName;
      const phone = this.getApplicantPhone(app);
      if (phone) context.applicantPhone = phone;
      const email = (app.email ?? app.email_address ?? app.primary_email ?? "")
        .toString()
        .trim();
      if (email) context.applicantEmail = email;
    } catch {
      /* noop */
    }
    if (this.locationName) {
      context.location = { name: this.locationName };
      context.locationName = this.locationName;
    }
    if (this.stageName) {
      context.stage = { name: this.stageName, id: this.currentStageId };
      context.stageName = this.stageName;
    }
    if (this.currentStageId != null) {
      context.stageId = this.currentStageId;
    }
    if (this.status) {
      context.status = this.status;
      context.statusName = this.status.statusName;
    }
    try {
      context.user = this.authSession.user || {};
    } catch {
      context.user = {};
    }
    return context;
  }

  private loadMessageTemplates(force: boolean = false): void {
    if (this.templatesLoading) return;
    if (!force && this.messageTemplates.length) return;
    if (this.templatesRequestSub) {
      this.templatesRequestSub.unsubscribe();
      this.templatesRequestSub = null;
    }
    this.templatesLoading = true;
    this.templatesError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_notifications_templates_chat_list as any,
      parameters: [],
    } as any;
    this.templatesRequestSub = this.core
      .executeCommand<DriveWhipCommandResponse>(api)
      .pipe(
        finalize(() => {
          this.templatesLoading = false;
          this.templatesRequestSub = null;
        })
      )
      .subscribe({
        next: (res) => {
          if (!res || res.ok === false) {
            const message =
              ((res as any)?.error?.toString() || "").trim() ||
              "Failed to load templates";
            this.templatesError = message;
            Utilities.showToast(message, "error");
            return;
          }
          let rows: any[] = [];
          const data = (res as any).data;
          if (Array.isArray(data)) {
            rows = Array.isArray(data[0]) ? data[0] : data;
          }
          const normalized = Array.isArray(rows)
            ? rows
                .map((row: any) => this.normalizeTemplateRow(row))
                .filter((row): row is MessageTemplateSummary => !!row)
            : [];
          this.messageTemplates = normalized;
          this.templatesError = null;
        },
        error: (err) => {
          console.error("[ApplicantPanel] templates load error", err);
          const message =
            ((err as any)?.message?.toString() || "").trim() ||
            "Failed to load templates";
          this.templatesError = message;
          Utilities.showToast(message, "error");
        },
      });
  }

  private normalizeTemplateRow(row: any): MessageTemplateSummary | null {
    if (!row) return null;
    const id =
      row.id ??
      row.id_template ??
      row.template_id ??
      row.idNotificationTemplate ??
      row.idTemplate ??
      null;
    const descriptionRaw =
      row.description ??
      row.template_description ??
      row.name ??
      row.subject ??
      (id != null ? `Template #${id}` : "");
    const description = (descriptionRaw ?? "").toString().trim();
    const subject = (row.subject ?? row.title ?? row.email_subject ?? "")
      .toString()
      .trim();
    const type = (
      row.type ??
      row.channel ??
      row.delivery ??
      row.delivery_method ??
      ""
    )
      .toString()
      .trim();
    const code =
      row.code ??
      row.CODE ??
      row.template_code ??
      row.templateCode ??
      row.event_code ??
      row.event ??
      row.option ??
      null;
    const dataKey =
      row.data_key ??
      row.dataKey ??
      row.datakey ??
      row.data_key_name ??
      row.dataKeyName ??
      row.folder ??
      null;
    const channelRaw =
      row.channel ??
      row.delivery ??
      row.delivery_method ??
      row.deliveryMethod ??
      row.type ??
      row.template_type ??
      null;
    const channel = channelRaw != null ? String(channelRaw).trim() : null;
    const rawBody =
      row.body ??
      row.template_body ??
      row.message ??
      row.sms ??
      row.email_body ??
      row.content ??
      "";
    const rawBodyStr =
      typeof rawBody === "string" ? rawBody : String(rawBody ?? "");
    const content = this.toPlainText(rawBodyStr);
    if (!description && !content) {
      return null;
    }
    const previewSource = (content || description).replace(/\s+/g, " ").trim();
    const preview =
      previewSource.length > 140
        ? previewSource.slice(0, 140).trimEnd() + "..."
        : previewSource;
    return {
      id,
      description: description || previewSource || "Template",
      subject: subject || null,
      type: type || null,
      content,
      rawBody: rawBodyStr,
      code: code != null ? String(code).trim() || null : null,
      dataKey: dataKey != null ? String(dataKey).trim() || null : null,
      channel,
      preview,
    };
  }

  private toPlainText(value: unknown): string {
    if (value === null || value === undefined) return "";
    const source = typeof value === "string" ? value : String(value);
    if (!source.trim()) return "";
    return this.htmlToSmsText(source);
  }

  /** Submit and send an SMS chat message via API without flicker (optimistic + realtime) */
  async onSendMessage(ev: Event): Promise<void> {
    ev.preventDefault();
    const text = (this.draftMessage || "").trim();
    const id = this.resolveApplicantId(this.applicant) || this.applicantId;
    const to = this.getApplicantPhone(this.applicant);
    if (!text) {
      return;
    }
    if (!id) {
      Utilities.showToast("Applicant id not found", "warning");
      return;
    }
    if (!to) {
      Utilities.showToast("Applicant phone not found", "warning");
      return;
    }
    if (this.chatSending) return;

    let finalMessage = text;
    this.chatSending = true;
    try {
      const prepared = await firstValueFrom(
        this.core.prepareNotificationMessage("sms", String(id), text)
      );
      if ((prepared || "").trim()) {
        finalMessage = prepared;
      }
    } catch (err) {
      console.error("[ApplicantPanel] prepare inline SMS error", err);
      Utilities.showToast(
        this.notificationErrorMessage(err, "Failed to prepare SMS message"),
        "error"
      );
      this.chatSending = false;
      return;
    }
    // Optimistic message so user sees it immediately
    const nowIso = new Date().toISOString();
    const optimistic: ApplicantMessage = {
      id: "temp-" + Date.now(),
      direction: "outbound",
      sender: "You",
      body: finalMessage,
      timestamp: new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date()),
      channel: "SMS",
      status: "sending",
      statusLabel: "Sending",
      automated: false,
      dayLabel: new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date()),
      sentAt: nowIso,
      createdBy: this.authSession.user?.user || "You",
    };
    this.messages = [...(this.messages ?? []), optimistic];
    this.refreshResolvedMessages();
    // Force-stick on local send to keep view anchored
    this.scrollMessagesToBottomSoon(0, true);
    const fromNumber = this.defaultSmsFromNumber();
    try {
      await firstValueFrom(
        this.core.sendChatSms({
          from: fromNumber,
          to,
          message: finalMessage,
          id_applicant: String(id),
        })
      );
      this.draftMessage = "";
      this.markOptimisticDelivered(optimistic.id!);
      this.scrollMessagesToBottomSoon(0, true);
    } catch (err) {
      console.error("[ApplicantPanel] sendChatSms error", err);
      this.smsSendFailureToast();
      this.removeOptimistic(optimistic.id!);
    } finally {
      this.chatSending = false;
    }
  }

  private updateRealtimeSubscription(applicantId: string | null): void {
    const normalized = this.normalizeApplicantIdValue(applicantId);
    this.currentRealtimeApplicantId = normalized;
    this.updatePhoneSubscription().catch((err: unknown) => {
      console.debug("[ApplicantPanel] updatePhoneSubscription error", err);
    });
  }

  private normalizeApplicantIdValue(
    value: string | null | undefined
  ): string | null {
    const str = (value ?? "").toString().trim();
    return str ? str.toLowerCase() : null;
  }

  private handleRealtimeMessage(evt: ApplicantChatRealtimeMessage): void {
    if (!evt) return;
    const activeId =
      this.resolveApplicantId(this.applicant) || this.applicantId;
    const normalizedActive = this.normalizeApplicantIdValue(activeId);
    // We attempt two matching strategies: applicantId first, then phone-pair fallback
    let accept = false;
    if (normalizedActive) {
      const incomingId = this.normalizeApplicantIdValue(evt.applicantId);
      if (incomingId && incomingId === normalizedActive) {
        accept = true;
      }
    }
    if (!accept && this.matchesCurrentPhone(evt)) {
      accept = true;
    }
    if (!accept) return;

    // If we matched by applicantId (or otherwise) but we haven't yet established a phone subscription,
    // infer the phone from the realtime event and join its group to keep receiving subsequent events
    // (some backend events may omit applicantId and rely solely on the phone group).
    try {
      if (!this.currentRealtimePhoneNumber) {
        const inferred =
          this.normalizePhone(evt.from) || this.normalizePhone(evt.to);
        if (inferred) {
          // Best-effort join; service is idempotent for already-joined phones
          this.smsRealtime
            .joinPhone(inferred)
            .then(() => {
              this.currentRealtimePhoneNumber = inferred;
              try {
                console.debug(
                  "[ApplicantPanel] Auto-joined phone from realtime",
                  inferred
                );
              } catch {}
            })
            .catch(() => {});
        }
      }
    } catch {}

    const body = (evt.body || "").toString();
    if (!body.trim()) return;

    const candidateId =
      evt.chatId != null
        ? String(evt.chatId)
        : evt.messageSid
        ? `sid-${evt.messageSid}`
        : null;

    // Do not short-circuit when chatId repeats (backend may reuse ids per thread);
    // allow downstream logic to reconcile just like MessengerComponent does.

    const direction: "inbound" | "outbound" =
      (evt.direction || "").toLowerCase() === "outbound"
        ? "outbound"
        : "inbound";
    const sentSource =
      evt.sentAtUtc || evt.createdAtUtc || new Date().toISOString();
    const sentDate = new Date(sentSource);
    const timestampLabel = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(Number.isNaN(sentDate.getTime()) ? new Date() : sentDate);

    const status: MessageStatus | undefined =
      direction === "outbound" ? "delivered" : undefined;

    // Precompute stable day label to avoid divider flicker on first render
    const dayLabel = (() => {
      try {
        const dt = new Date(sentSource);
        if (!Number.isNaN(dt.getTime())) {
          return new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          }).format(dt);
        }
      } catch {}
      return "";
    })();

    const message: ApplicantMessage = {
      id: candidateId || `rt-${direction}-${Date.now()}`,
      direction,
      sender:
        direction === "outbound"
          ? this.authSession.user?.user || "You"
          : this.applicant?.first_name || "Applicant",
      body,
      timestamp: timestampLabel,
      channel: (evt.channel || "SMS").toString() || "SMS",
      status,
      statusLabel: this.defaultStatusLabel(status),
      automated: false,
      dayLabel,
      sentAt: sentSource,
      createdBy:
        direction === "outbound" ? this.authSession.user?.user || null : null,
      __isNew: true,
    };

    const base = this.messages ?? [];
    this.messages = [...base, message];
    // If a persisted outbound arrives, drop matching temporary 'sending' bubble by body
    if (direction === "outbound") {
      const temp = [...(this.messages || [])]
        .reverse()
        .find(
          (m) =>
            (m.id || "").toString().startsWith("temp-") &&
            m.direction === "outbound" &&
            (m.body || "").toString().trim() === body.trim()
        );
      if (temp) {
        this.messages = (this.messages || []).filter((m) => m.id !== temp.id);
      }
    }
    this.refreshResolvedMessages();
    // Remove the "new" highlight after a short delay (non-blocking)
    try {
      setTimeout(() => {
        const cur = this.messages || [];
        const next = cur.map((m) =>
          (m.id || "") === (message.id || "")
            ? ({ ...(m as any), __isNew: false } as any)
            : m
        );
        // Only update if changed
        if (next !== cur) {
          this.messages = next;
          this.refreshResolvedMessages();
        }
      }, 2800);
    } catch {}
    // Auto-scroll only if user is already near bottom
    this.scrollMessagesToBottomSoon(0, false);
  }

  // --- Realtime subscription helpers ---
  private currentRealtimePhoneNumber: string | null = null;

  private defaultSmsFromNumber(): string {
    try {
      const enc = localStorage.getItem('dw.sms.fromNumber');
      if (enc) {
        const val = this.crypto.decrypt<string>(enc);
        const s = (val || '').toString().trim();
        if (s) return s;
      }
    } catch {}
    return this.appConfig.smsDefaultFromNumber;
  }

  private normalizePhone(raw?: string | null): string | null {
    const v = (raw || "").trim();
    if (!v) return null;
    // Strict E.164-ish normalization: collapse to digits and ensure single leading '+'
    const digits = v
      .split("")
      .filter((ch) => /\d/.test(ch))
      .join("");
    if (!digits) return null;
    return `+${digits}`;
  }

  private async updatePhoneSubscription(): Promise<void> {
    try {
      const to = this.getApplicantPhone(this.applicant) || this.smsTo || null;
      const normalizedTo = this.normalizePhone(to);
      const current = this.currentRealtimePhoneNumber;

      if (normalizedTo === current) {
        return;
      }

      if (current && current !== normalizedTo) {
        try {
          await this.smsRealtime.leavePhone(current);
          console.debug(
            "[ApplicantPanel] leavePhone",
            current,
            "group=sms:" + current
          );
        } catch (err: unknown) {
          console.debug("[ApplicantPanel] leavePhone error", current, err);
        } finally {
          this.currentRealtimePhoneNumber = null;
        }
      }

      if (!normalizedTo) {
        return;
      }

      await this.smsRealtime.joinPhone(normalizedTo);
      this.currentRealtimePhoneNumber = normalizedTo;
      console.debug(
        "[ApplicantPanel] joinPhone",
        normalizedTo,
        "group=sms:" + normalizedTo
      );
      try {
        console.debug(
          "[ApplicantPanel] joinedPhones=",
          this.smsRealtime.getJoinedPhones()
        );
        console.log(
          "[ApplicantPanel] Active SignalR group",
          `sms:${normalizedTo}`
        );
      } catch {}
    } catch (err: unknown) {
      console.debug(
        "[ApplicantPanel] updatePhoneSubscription inner error",
        err
      );
    }
  }

  private matchesCurrentPhone(evt: ApplicantChatRealtimeMessage): boolean {
    try {
      if (!evt) return false;
      const target = this.normalizePhone(
        this.getApplicantPhone(this.applicant) ||
          this.smsTo ||
          this.currentRealtimePhoneNumber
      );
      if (!target) return false;
      const from = this.normalizePhone(evt.from);
      const to = this.normalizePhone(evt.to);
      console.debug("[ApplicantPanel] match phone?", {
        target,
        from,
        to,
        meta: (evt as any)?.metadata,
      });
      return from === target || to === target;
    } catch {
      return false;
    }
  }

  private getApplicantPhone(applicant: any): string | null {
    if (!applicant) return null;
    const phone = applicant.phone_number || applicant.phone || null;
    return phone ? String(phone) : null;
  }

  private notificationErrorMessage(error: unknown, fallback: string): string {
    if (!error) return fallback;
    if (typeof error === "string") return error;
    if (error instanceof Error && error.message) return error.message;
    const maybeMessage = (error as any)?.message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
    return fallback;
  }

  /** Show a clear guidance toast when an SMS cannot be sent due to likely phone formatting issues */
  private smsSendFailureToast(): void {
    const msg =
      "The SMS could not be sent. Please make sure the phone number is entered correctly and includes the country code. " +
      "Example: +1XXXXXXXXXX.";
    Utilities.showToast(msg, "error");
  }

  get resolvedMessages(): ApplicantMessage[] {
    return this._resolvedMessages;
  }

  shouldRenderDay(day: string, index: number): boolean {
    if (!day) return false;
    if (index === 0) return true;
    const previous = this._resolvedMessages[index - 1];
    return (previous?.dayLabel ?? "") !== day;
  }

  get displayLocation(): string | null {
    const fromInput = (this.locationName ?? "").toString().trim();
    if (fromInput) return fromInput;
    const fromApplicant = (this.applicant?.locationName ?? "")
      .toString()
      .trim();
    return fromApplicant || null;
  }

  get displayStage(): string | null {
    const fromInput = (this.stageName ?? "").toString().trim();
    if (fromInput) return fromInput;
    const fromApplicant = (this.applicant?.stageName ?? "").toString().trim();
    if (fromApplicant) return fromApplicant;
    const fromStatus = (this.applicant?.status?.stage ?? "").toString().trim();
    return fromStatus || null;
  }

  get resolvedStatus(): ApplicantStatus | null {
    // Prefer the applicant object if it already has status
    const appStatus = this.applicant?.status as ApplicantStatus | undefined;
    if (appStatus && (appStatus.stage || appStatus.statusName))
      return appStatus;
    // Fallback to input status from grid
    const inStatus = this.status as ApplicantStatus | null;
    if (inStatus && (inStatus.stage || inStatus.statusName)) return inStatus;
    // Build minimal status from available inputs
    const stage = this.displayStage || "";
    if (!stage) return null;
    const statusName = "incomplete";
    return { stage, statusName, isComplete: false } as ApplicantStatus;
  }

  /** Returns a deduplicated list of statuses to render as badges, similar to the grid column logic. */
  get resolvedStatuses(): Array<ApplicantStatus & { order?: number }> {
    // Priority: explicit input -> applicant.statuses -> single resolvedStatus
    const src =
      Array.isArray(this.statuses) && this.statuses.length
        ? this.statuses
        : Array.isArray((this.applicant as any)?.statuses) &&
          (this.applicant as any).statuses.length
        ? ((this.applicant as any).statuses as Array<
            ApplicantStatus & { order?: number }
          >)
        : this.resolvedStatus
        ? [this.resolvedStatus]
        : [];
    if (!Array.isArray(src) || !src.length) return [] as any;
    // Deduplicate keeping last occurrence
    const seen = new Set<string>();
    const result: Array<ApplicantStatus & { order?: number }> = [];
    for (let i = src.length - 1; i >= 0; i--) {
      const it: any = src[i] || {};
      const stage = String(it.stage || "").toLowerCase();
      const statusName = String(
        it.statusName || (it.isComplete ? "complete" : "incomplete")
      ).toLowerCase();
      const key = `${stage}|${statusName}|${(it as any).order ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        const orderVal =
          typeof (it as any).order === "number" ? (it as any).order : undefined;
        result.unshift({
          stage: it.stage || "Stage",
          statusName: statusName || "incomplete",
          isComplete: !!it.isComplete,
          order: orderVal,
        });
      }
    }
    return result;
  }

  /** Returns the history array to render in the timeline (prefers explicit input, falls back to applicant.history) */
  get historyItems(): Array<{ type?: string; text?: string; time?: string }> {
    // Prefer dynamically loaded history events
    if (Array.isArray(this.historyEvents) && this.historyEvents.length)
      return this.historyEvents as any;
    // Fall back to explicit input (if provided)
    let source: any[] | null = null;
    if (Array.isArray(this.history) && this.history.length) {
      source = this.history as any[];
    } else if (
      Array.isArray(this.applicant?.history) &&
      this.applicant.history.length
    ) {
      source = this.applicant.history as any[];
    }
    if (source !== this._fallbackHistorySource) {
      this._fallbackHistorySource = source;
      this._normalizedFallbackHistory = this.normalizeFallbackHistory(source);
    }
    return this._normalizedFallbackHistory;
  }

  // Filtering / searching state for the timeline
  filterType: string = "all"; // 'all' | 'message' | 'transition' | 'email' | 'sms' | 'upload' | 'error'
  filterText: string = "";

  get filteredHistoryItems(): Array<any> {
    const items = this.historyItems || [];
    const type = (this.filterType || "all").toString().toLowerCase();
    const text = (this.filterText || "").toString().trim().toLowerCase();
    const filtered = items.filter((it: any) => {
      if (type !== "all") {
        if ((it.type || "").toString().toLowerCase() !== type) return false;
      }
      if (text) {
        const hay = ((it.text || "") + " " + (it.actorName || ""))
          .toString()
          .toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });

    return filtered
      .map((ev) => ({ ...ev, __timestamp: this.resolveEventTimestamp(ev) }))
      .sort((a, b) => {
        const ta = a.__timestamp ?? 0;
        const tb = b.__timestamp ?? 0;
        return tb - ta;
      });
  }

  setFilterType(t: string) {
    this.filterType = t || "all";
  }
  clearFilters() {
    this.filterType = "all";
    this.filterText = "";
  }

  get groupedHistoryItems(): Array<{ dayLabel: string; events: any[] }> {
    const groups: Array<{ dayLabel: string; events: any[] }> = [];
    for (const ev of this.filteredHistoryItems) {
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

  /** Open the inline sidebar with event details; optionally fetch extra detail when available */
  openEventSidebar(ev: any): void {
    if (!ev) return;
    const type = (ev.type || ev.event_type || "").toString().toLowerCase();
    const eventTable = (ev.event_table || "").toString().toLowerCase();
    const idTableStr = (ev.id_event_table ?? ev.idEventTable ?? "0").toString();
    const isDocument =
      type === "document" || eventTable.startsWith("documents");
    const docIdNum = parseInt(idTableStr, 10);
    const hasDocId = !Number.isNaN(docIdNum) && docIdNum > 0;
    // Only allow opening when backend signals detail OR when it's a document with a valid id
    const canOpen = ev.with_detail === true || (isDocument && hasDocId);
    if (!canOpen) return;

    this.selectedHistoryEvent = ev;
    this.eventSidebarOpen = true;
    this.eventDetailError = null;
    // Reset document preview state
    this.eventDoc = null;
    this.eventDocError = null;
    this.eventDocLoading = false;
    // Prefill with whatever we already have
    this.eventDetailText = String(
      ev.body ?? ev.text ?? ev.notes ?? ev.document_name ?? ""
    );
    // If it's a document event, try to load the file preview early (by id_event_table)
    if (isDocument && hasDocId) {
      const idFromApplicant = this.resolveApplicantId(this.applicant);
      const idApplicant = (this.applicantId || idFromApplicant || null) as
        | string
        | null;
      if (idApplicant) {
        const token = this.beginEventDocLoad();
        this.loadEventDocumentPreviewById(idApplicant, docIdNum, token);
      }
    }
    // Fetch extra detail only when explicitly allowed by backend
    const shouldFetch = ev.with_detail === true;
    if (!shouldFetch) return;
    const idFromApplicant = this.resolveApplicantId(this.applicant);
    const idApplicant = (this.applicantId || idFromApplicant || null) as
      | string
      | null;
    if (!idApplicant) return;
    this.eventDetailLoading = true;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicant_event_detail as any,
      parameters: [ev.id_event || ev.id, idApplicant],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        let raw: any = res?.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const row = Array.isArray(raw) && raw.length ? raw[0] : null;
        if (row && typeof row === "object") {
          const detail = String(
            row.message_text ??
              row.message ??
              row.document_name ??
              row.note ??
              row.text ??
              ""
          );
          if (detail) this.eventDetailText = detail;
          // If this is a document event and we didn't get a preview yet, try from detail row
          if (
            (type === "document" ||
              (ev.event_table || "")
                .toString()
                .toLowerCase()
                .startsWith("documents")) &&
            !this.eventDoc
          ) {
            const folder = row.folder ?? row.FOLDER ?? null;
            const name = row.document_name ?? row.DOCUMENT_NAME ?? null;
            const id_applicant_document =
              row.id_applicant_document ?? row.ID_APPLICANT_DOCUMENT ?? null;
            const idFromApplicant2 = this.resolveApplicantId(this.applicant);
            const idApplicant2 = (this.applicantId ||
              idFromApplicant2 ||
              null) as string | null;
            if (idApplicant2) {
              if (id_applicant_document) {
                const parsed = parseInt(String(id_applicant_document), 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                  const token = this.beginEventDocLoad();
                  this.loadEventDocumentPreviewById(
                    idApplicant2,
                    parsed,
                    token
                  );
                }
              } else if (name) {
                // Fallback: build minimal doc object and fetch URL directly if folder/name present
                const doc: ApplicantDocument = {
                  id_applicant_document: 0,
                  id_applicant: String(idApplicant2),
                  data_key: String(row.data_key ?? row.DATA_KEY ?? ""),
                  document_name: String(name),
                  status: row.status ?? row.STATUS ?? null,
                  created_at: row.created_at ?? row.CREATED_AT ?? null,
                  approved_at: row.approved_at ?? row.APPROVED_AT ?? null,
                  approved_by: row.approved_by ?? row.APPROVED_BY ?? null,
                  disapproved_at:
                    row.disapproved_at ?? row.DISAPPROVED_AT ?? null,
                  disapproved_by:
                    row.disapproved_by ?? row.DISAPPROVED_BY ?? null,
                  folder: folder ?? null,
                  url: "",
                };
                const token = this.beginEventDocLoad();
                this.loadEventDocumentUrl(doc, token);
              }
            }
          }
        }
      },
      error: (err) => {
        console.error("[ApplicantPanel] event detail error", err);
        this.eventDetailError = "Failed to load event detail";
      },
      complete: () => {
        this.eventDetailLoading = false;
      },
    });
  }

  closeEventSidebar(): void {
    this.eventSidebarOpen = false;
    this.selectedHistoryEvent = null;
    this.eventDetailLoading = false;
    this.eventDetailError = null;
    this.eventDetailText = "";
    this.eventDocLoading = false;
    this.eventDocError = null;
    this.eventDoc = null;
    try {
      this._eventDocSub?.unsubscribe();
    } catch {}
    this._eventDocSub = null;
  }

  /** Load a single applicant document (by id) for the sidebar preview */
  private loadEventDocumentPreviewById(
    idApplicant: string,
    idApplicantDocument: number,
    token?: number
  ): void {
    try {
      if (!idApplicant || !idApplicantDocument) return;
      const t = token ?? this.beginEventDocLoad();
      const params: any[] = [
        "R",
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
        commandName:
          DriveWhipAdminCommand.crm_applicants_documents_crud_new as any,
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
              this.eventDocError = "File not found";
              return;
            }
            const doc = this.normalizeDocRecord(r);
            this.loadEventDocumentUrl(doc, t);
          },
          error: (err) => {
            console.error(
              "[ApplicantPanel] loadEventDocumentPreviewById error",
              err
            );
            this.eventDocError = "Failed to load file";
            this.eventDocLoading = false;
          },
          complete: () => {},
        });
    } catch (e) {
      this.eventDocError = "Failed to load file";
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
          : this.resolveDocFolderByName(doc.document_name) || "aplicant";
      const docToLoad = { ...doc, folder: effectiveFolder };
      this._eventDocSub = this.core
        .fetchFile(effectiveFolder, doc.document_name || "")
        .subscribe({
          next: (resp: any) => {
            if (t !== this._activeEventDocToken) return; // stale
            // Ensure we set the correct doc only for the active token
            docToLoad.url = resp?.data?.url || docToLoad.url || "";
            this.eventDoc = { ...docToLoad };
            this.eventDocLoading = false;
          },
          error: (err) => {
            console.error("[ApplicantPanel] loadEventDocumentUrl error", err);
            if (t !== this._activeEventDocToken) return; // stale
            this.eventDoc = { ...docToLoad }; // set without URL so actions can still work
            this.eventDocError = "Unable to load file preview";
            this.eventDocLoading = false;
          },
        });
    } catch (e) {
      this.eventDoc = {
        ...doc,
        folder:
          doc.folder ||
          this.resolveDocFolderByName(doc.document_name) ||
          "aplicant",
      };
      this.eventDocError = "Unable to load file preview";
      this.eventDocLoading = false;
    }
  }

  /** Begin a new event-doc load by increasing the active token and cancelling previous */
  private beginEventDocLoad(): number {
    this._activeEventDocToken = ++this._eventDocLoadSeq;
    try {
      this._eventDocSub?.unsubscribe();
    } catch {}
    this._eventDocSub = null;
    this.eventDocLoading = true;
    this.eventDocError = null;
    this.eventDoc = null;
    return this._activeEventDocToken;
  }

  /** Try to infer the folder of a document from already loaded applicant files by name */
  private resolveDocFolderByName(
    name: string | null | undefined
  ): string | null {
    const fileName = (name || "").toString().trim();
    if (!fileName) return null;
    try {
      const groups = this.documentGroups || [];
      for (const g of groups) {
        for (const d of g.items || []) {
          if (
            (d?.document_name || "").toString().trim().toLowerCase() ===
            fileName.toLowerCase()
          ) {
            const fld = (d.folder || "").toString().trim();
            if (fld) return fld;
          }
        }
      }
    } catch {}
    return null;
  }

  openTimelineEvent(ev: any): void {
    if (!ev) return;

    const finish = (detailText?: string) => {
      console.log("Finished processing event:", detailText);
    };

    const who = ev.actorName
      ? `<div><strong>By:</strong> ${this.escapeHtml(ev.actorName)}</div>`
      : "";

    const baseBodyFor = (detailText?: string) => {
      let bodyHtml = "";
      switch ((ev.type || "").toString().toLowerCase()) {
        case "email":
        case "sms":
        case "message":
          bodyHtml = `
            ${who}
            <div class="mt-2"><strong>Channel:</strong> ${this.escapeHtml(
              ev.channel || ev.type
            )}</div>
            <div class="mt-2"><strong>To/From:</strong> ${this.escapeHtml(
              ev.target || ev.recipient || ev.actorName || ""
            )}</div>
            <div class="mt-3"><pre style="white-space:pre-wrap;">${this.escapeHtml(
              detailText || ev.body || ev.text || ""
            )}</pre></div>
          `;
          break;
        case "transition":
        case "stage":
          bodyHtml = `
            ${who}
            <div class="mt-2"><strong>From:</strong> ${this.escapeHtml(
              ev.from || ev.previousStage || ""
            )}</div>
            <div class="mt-2"><strong>To:</strong> ${this.escapeHtml(
              ev.to || ev.newStage || ""
            )}</div>
            <div class="mt-3">${this.escapeHtml(
              detailText || ev.notes || ev.text || ""
            )}</div>
          `;
          break;
        case "upload":
        case "file":
        case "document":
          bodyHtml = `
            ${who}
            <div class="mt-2"><strong>File:</strong> ${this.escapeHtml(
              detailText || ev.fileName || ev.text || ""
            )}</div>
            <div class="mt-2"><strong>Type:</strong> ${this.escapeHtml(
              ev.fileType || ""
            )}</div>
            <div class="mt-2"><strong>Size:</strong> ${this.escapeHtml(
              ev.fileSize || ""
            )}</div>
            <div class="mt-3">${this.escapeHtml(ev.notes || "")}</div>
            ${
              ev.fileUrl
                ? `<div class="mt-3"><a href="${this.escapeHtml(
                    ev.fileUrl
                  )}" target="_blank">View / Download</a></div>`
                : ""
            }
          `;
          break;
        case "note":
          bodyHtml = `${who}<div class="mt-3">${this.escapeHtml(
            detailText || ev.text || ""
          )}</div>`;
          break;
        default:
          bodyHtml = `${who}<div class="mt-2">${this.escapeHtml(
            detailText || ev.text || ""
          )}</div>`;
      }
      return bodyHtml;
    };

    // If event is marked with_detail, fetch detail text
    const idTable = (ev.id_event_table ?? ev.idEventTable ?? "0").toString();
    if (ev.with_detail) {
      const idFromApplicant = this.resolveApplicantId(this.applicant);
      const idApplicant = (this.applicantId || idFromApplicant || null) as
        | string
        | null;
      if (idApplicant) {
        const api: IDriveWhipCoreAPI = {
          commandName: DriveWhipAdminCommand.crm_applicant_event_detail as any,
          parameters: [ev.id_event || ev.id, idApplicant],
        } as any;
        this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
          next: (res) => {
            let raw: any = res?.data;
            if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
            const row = Array.isArray(raw) && raw.length ? raw[0] : null;
            let detailText: string | undefined = undefined;
            if (row && typeof row === "object") {
              detailText = String(
                row.message_text ??
                  row.message ??
                  row.document_name ??
                  row.note ??
                  row.text ??
                  ""
              );
            }
            finish(detailText);
          },
          error: () => finish(undefined),
        });
        return;
      }
    }
    // No detail to fetch
    finish();
  }

  // (Removed duplicate escapeHtml; single implementation located earlier in file)

  /** Map event type to a FontAwesome / marker classes */
  /** Map event type to a Feather icon class (project uses Feather icons) */
  timelineIcon(type?: string): string {
    switch ((type || "").toString().toLowerCase()) {
      case "created":
        return "icon-plus";
      case "transition":
        return "icon-arrow-right";
      case "stage":
        return "icon-corner-up-right";
      case "email":
        return "icon-mail";
      case "mail":
        return "icon-mail";
      case "sms":
        return "icon-message-circle";
      case "note":
        return "icon-file";
      case "document":
        return "icon-file-text";
      case "file":
        return "icon-file-text";
      case "upload":
        return "icon-upload-cloud";
      case "error":
        return "icon-alert-circle";
      default:
        return "icon-circle";
    }
  }

  timelineMarkerClass(type?: string): string {
    switch ((type || "").toString().toLowerCase()) {
      case "created":
        return "bg-primary text-white";
      case "transition":
        return "bg-info text-white";
      case "stage":
        return "bg-info text-white";
      case "email":
        return "bg-success text-white";
      case "mail":
        return "bg-success text-white";
      case "sms":
        return "bg-warning text-dark";
      case "note":
        return "bg-primary text-white";
      case "document":
        return "bg-secondary text-white";
      case "upload":
      case "file":
        return "bg-secondary text-white";
      case "error":
        return "bg-danger text-white";
      default:
        return "bg-secondary text-white";
    }
  }

  timelineActorBadgeClass(role?: string): string {
    const normalized = (role || "").toString().toLowerCase();
    switch (normalized) {
      case "system":
        return "badge bg-secondary-subtle text-secondary";
      case "admin":
      case "reviewer":
        return "badge bg-primary-subtle text-primary";
      case "applicant":
      case "user":
        return "badge bg-success-subtle text-success";
      default:
        return "badge bg-secondary-subtle text-secondary";
    }
  }

  timelineActorLabel(role?: string): string {
    if (!role) return "User";
    const normalized = role.toString().toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  timelineDisplayTime(ev: any): string {
    if (ev.displayTime) return ev.displayTime;
    const ts = this.resolveEventTimestamp(ev);
    if (!ts) return ev.time ?? "";
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return formatter.format(new Date(ts));
  }

  private resolveEventTimestamp(ev: any): number | null {
    if (!ev) return null;
    if (ev.__timestamp && typeof ev.__timestamp === "number")
      return ev.__timestamp;
    const raw = ev.time || ev.timestamp || ev.created_at || ev.createdAt;
    if (!raw) return null;
    const date = new Date(raw);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
  }

  private resolveEventDay(ev: any): string {
    if (ev.dayLabel) return ev.dayLabel;
    const ts = this.resolveEventTimestamp(ev);
    if (!ts) return "Timeline";
    const date = new Date(ts);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "2-digit",
    }).format(date);
  }

  private resolveApplicantId(applicant: any): string | null {
    if (!applicant) return null;
    return applicant.id ??
      applicant.id_applicant ??
      applicant.ID_APPLICANT ??
      applicant.uuid ??
      applicant.guid ??
      null
      ? String(
          applicant.id ??
            applicant.id_applicant ??
            applicant.ID_APPLICANT ??
            applicant.uuid ??
            applicant.guid
        )
      : null;
  }

  private hasApplicantIdentity(applicant: any): boolean {
    if (!applicant) return false;
    const props = [
      "first_name",
      "last_name",
      "FIRST_NAME",
      "LAST_NAME",
      "firstName",
      "lastName",
    ];
    return props.some((prop) => Object.prototype.hasOwnProperty.call(applicant, prop));
  }

  private hydrateApplicantFromCache(id: string): void {
    if (!this.cachedApplicantDetails) return;
    const cachedId = this.resolveApplicantId(this.cachedApplicantDetails);
    if (!cachedId || cachedId !== id) return;
    if (this.hasApplicantIdentity(this.applicant)) return;
    const merged = {
      ...this.cachedApplicantDetails,
      ...this.applicant,
    };
    this.applicant = merged;
    this.editableApplicant = { ...merged };
  }

  private loadApplicantDetails(applicantId: string): void {
    this.applicantDetailsLoading = true;
    this.applicantDetailsError = null;
    const params: any[] = [
      "R",
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

    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res.ok) {
          const err = String(res.error || "Failed to load applicant details");
          this.applicantDetailsError = err;
          Utilities.showToast(err, "error");
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
          this.applicantDetailsError = "Applicant not found";
          this.applicantDetailsLoading = false;
        }
      },
      error: (err) => {
        console.error("[ApplicantPanel] loadApplicantDetails error", err);
        this.applicantDetailsError = "Failed to load applicant details";
        Utilities.showToast(this.applicantDetailsError, "error");
        this.applicantDetailsLoading = false;
      },
      complete: () => {
        this.editableApplicant = this.applicant ? { ...this.applicant } : {};
      },
    });
    // Load answers in parallel
    this.loadApplicantAnswers(applicantId);
  }

  private loadApplicantAnswers(applicantId: string): void {
    this.answersLoading = true;
    this.answersError = null;
    this.answers = [];
    const api: IDriveWhipCoreAPI = {
      commandName:
        DriveWhipAdminCommand.crm_applicants_answers_registration as any,
      parameters: [applicantId],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.answers = [];
          this.answersError = String(res?.error || "Failed to load answers");
          return;
        }
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const list = Array.isArray(raw) ? raw : [];
        this.answers = list.map((r: any) => ({
          id_question: r.id_question ?? r.ID_QUESTION ?? null,
          answer_text: r.answer_text ?? r.ANSWER_TEXT ?? "",
          answered_at: r.answered_at ?? r.ANSWERED_AT ?? null,
          created_at: r.created_at ?? r.CREATED_AT ?? null,
          question: r.question ?? r.QUESTION ?? null,
        }));
      },
      error: (err) => {
        console.error("[ApplicantPanel] loadApplicantAnswers error", err);
        this.answers = [];
        this.answersError = "Failed to load answers";
      },
      complete: () => {
        this.answersLoading = false;
      },
    });
  }

  /** Ensure the event options are loaded once */
  private ensureEventOptions(): void {
    if (this.eventOptions.length > 0 || this.eventOptionsLoading) return;
    this.loadEventOptions();
  }

  private loadEventOptions(): void {
    this.eventOptionsLoading = true;
    this.eventOptionsError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicant_event_options as any,
      parameters: [],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        let rows: any[] = [];
        let raw: any = res?.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        rows = Array.isArray(raw) ? raw : [];
        // Normalize and ensure 'all' is first
        const mapped = rows
          .map((r) => ({
            event_type: String(r.event_type ?? r.type ?? "").toLowerCase(),
            description:
              String(r.description ?? r.label ?? r.name ?? "") || "All events",
          }))
          .filter((o) => o.event_type);
        // Deduplicate by event_type
        const seen = new Set<string>();
        const dedup: Array<{ event_type: string; description: string }> = [];
        for (const o of mapped) {
          if (seen.has(o.event_type)) continue;
          seen.add(o.event_type);
          dedup.push(o);
        }
        dedup.sort((a, b) =>
          a.event_type === "all"
            ? -1
            : b.event_type === "all"
            ? 1
            : a.description.localeCompare(b.description)
        );
        this.eventOptions = dedup.length
          ? dedup
          : [{ event_type: "all", description: "All events" }];
      },
      error: (err) => {
        console.error("[ApplicantPanel] loadEventOptions error", err);
        this.eventOptionsError = "Failed to load event filters";
        // Fallback options
        this.eventOptions = [
          { event_type: "all", description: "All events" },
          { event_type: "notifications", description: "Notification" },
          { event_type: "chats", description: "Chat" },
          { event_type: "documents", description: "Document" },
          { event_type: "notes", description: "Note" },
          { event_type: "stages-history", description: "Stage History" },
        ];
      },
      complete: () => {
        this.eventOptionsLoading = false;
      },
    });
  }

  /** Load events for the history (timeline) */
  private loadApplicantEvents(
    applicantId: string,
    prefix: string = "all",
    force: boolean = false
  ): void {
    if (!applicantId) return;
    if (
      !force &&
      this.historyLoadedForApplicantId === applicantId &&
      this.selectedEventPrefix === prefix &&
      this.historyEvents.length
    )
      return;
    this.historyLoading = true;
    this.historyError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicant_event_read as any,
      parameters: [applicantId, prefix || "all"],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.historyError = String(res?.error || "Failed to load history");
          this.historyEvents = [];
          return;
        }
        // Support multiple result sets: enriched + refs; prefer enriched for display
        const { enriched, refs } = this.parseEventDatasets(res.data);
        const refMap = this.buildEventRefMap(refs);
        const rows = enriched.length ? enriched : refs;
        // Map to the timeline item shape and augment from refs when needed
        const mapped = rows.map((r) => this.normalizeEventRow(r, refMap));
        // Sort desc by time then keep as array for grouping below
        const withTs = mapped.map((ev) => ({
          ...ev,
          __timestamp: this.resolveEventTimestamp(ev),
        }));
        withTs.sort((a, b) => (b.__timestamp ?? 0) - (a.__timestamp ?? 0));
        this.historyEvents = withTs;
        this.historyLoadedForApplicantId = applicantId;
      },
      error: (err) => {
        console.error("[ApplicantPanel] loadApplicantEvents error", err);
        this.historyError = "Failed to load history";
        this.historyEvents = [];
      },
      complete: () => {
        this.historyLoading = false;
      },
    });
  }

  /** Split multiple result sets into enriched vs refs */
  private parseEventDatasets(data: any): { enriched: any[]; refs: any[] } {
    const out = { enriched: [] as any[], refs: [] as any[] };
    if (!data) return out;
    if (Array.isArray(data)) {
      if (data.length && Array.isArray(data[0])) {
        for (const ds of data as any[]) {
          if (!Array.isArray(ds) || ds.length === 0) continue;
          const r = ds[0];
          const isEnriched =
            r &&
            typeof r === "object" &&
            (Object.prototype.hasOwnProperty.call(r, "event_title") ||
              Object.prototype.hasOwnProperty.call(r, "event_date") ||
              Object.prototype.hasOwnProperty.call(r, "event_user") ||
              Object.prototype.hasOwnProperty.call(r, "event_type"));
          if (isEnriched) out.enriched = ds;
          else out.refs = ds;
        }
      } else {
        const arr = data as any[];
        const r = arr[0];
        const isEnriched =
          r &&
          typeof r === "object" &&
          (Object.prototype.hasOwnProperty.call(r, "event_title") ||
            Object.prototype.hasOwnProperty.call(r, "event_date") ||
            Object.prototype.hasOwnProperty.call(r, "event_user") ||
            Object.prototype.hasOwnProperty.call(r, "event_type"));
        if (isEnriched) out.enriched = arr;
        else out.refs = arr;
      }
    }
    return out;
  }

  private buildEventRefMap(refs: any[]): Record<string, any> {
    const map: Record<string, any> = {};
    for (const r of refs || []) {
      const key = String(r.id_event ?? r.event_id ?? r.id ?? "").trim();
      if (!key) continue;
      map[key] = r;
    }
    return map;
  }

  private normalizeEventRow(r: any, refMap?: Record<string, any>): any {
    const id = String(r.event_id ?? r.id ?? r.id_event ?? r.uuid ?? "");
    let eventTable = String(r.event_table ?? r.table ?? "").toLowerCase();
    let idEventTable =
      r.id_event_table != null ? String(r.id_event_table) : "0";
    if ((!eventTable || idEventTable === "0") && refMap && id) {
      const ref = refMap[id];
      if (ref) {
        eventTable = String(ref.event_table ?? "").toLowerCase();
        idEventTable =
          ref.id_event_table != null
            ? String(ref.id_event_table)
            : idEventTable;
      }
    }
    const typeRaw = String(
      r.event_type ?? r.type ?? this.mapEventTableToType(eventTable)
    ).toLowerCase();
    const type = typeRaw === "mail" ? "email" : typeRaw; // normalize
    const text = String(
      r.event_title ??
        r.title ??
        this.defaultTitleForEventTable(eventTable) ??
        r.text ??
        ""
    );
    const time = r.event_date ?? r.date ?? r.created_at ?? r.createdAt ?? null;
    const user = String(r.event_user ?? r.user ?? r.actorName ?? "") || "";
    const role = user.toLowerCase().includes("system") ? "System" : undefined;
    const channel =
      type === "sms" ? "SMS" : type === "email" ? "Email" : undefined;
    // Backend may send a variety of shapes for the detail flag; coerce safely
    const rawWithDetail = (r.with_detail ??
      r.with_details ??
      (r as any).width_details ??
      r.withDetail ??
      r.withDetails) as any;
    const withDetail = this.coerceWithDetailFlag(rawWithDetail);

    return {
      id,
      id_event: String(r.id_event ?? id),
      type,
      text,
      time,
      actorName: user,
      actorRole: role,
      channel,
      event_table: eventTable,
      id_event_table: idEventTable,
      // Trust backend for detail availability; do NOT infer from id_event_table
      with_detail: withDetail,
    };
  }

  private mapEventTableToType(eventTable: string): string {
    if (!eventTable) return "event";
    if (eventTable.startsWith("notifications-sms")) return "sms";
    if (eventTable.startsWith("notifications")) return "email";
    if (eventTable.startsWith("chats")) return "sms";
    if (eventTable.startsWith("documents")) return "document";
    if (eventTable.startsWith("notes")) return "note";
    if (eventTable.startsWith("stages-history")) return "stage";
    return "event";
  }

  private defaultTitleForEventTable(eventTable: string): string {
    const et = (eventTable || "").toLowerCase();
    if (et.startsWith("documents-create")) return "Document uploaded";
    if (et.startsWith("documents-approved")) return "Document approved";
    if (et.startsWith("documents-disapproved")) return "Document disapproved";
    if (et.startsWith("notifications-sms")) return "SMS notification sent";
    if (et.startsWith("notifications")) return "Email notification sent";
    if (et === "chats") return "SMS sent from chat screen";
    if (et.startsWith("chats")) return "SMS message";
    if (et.startsWith("notes-create")) return "Note added";
    if (et.startsWith("notes-updated")) return "Note updated";
    if (et.startsWith("notes")) return "Note";
    if (et.startsWith("stages-history")) return "Stage changed";
    return "Event";
  }

  private normalizeFallbackHistory(source: any[] | null | undefined): any[] {
    if (!Array.isArray(source) || !source.length) return [];
    return source.map((ev) => this.normalizeLooseEvent(ev));
  }

  private normalizeLooseEvent(ev: any): any {
    if (!ev || typeof ev !== "object") return ev;
    const raw =
      ev.with_detail ??
      ev.with_details ??
      (ev as any).width_details ??
      ev.withDetail ??
      ev.withDetails;
    const withDetail = this.coerceWithDetailFlag(raw);
    if (withDetail === ev.with_detail) return ev;
    return {
      ...ev,
      with_detail: withDetail,
      withDetail,
      withDetails: withDetail,
    };
  }

  private coerceWithDetailFlag(raw: any): boolean {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw === 1;
    if (typeof raw === "string") {
      const s = raw.trim().toLowerCase();
      return (
        s === "true" ||
        s === "1" ||
        s === "yes" ||
        s === "y" ||
        s === "t" ||
        s === "si"
      );
    }
    return false;
  }

  onEventPrefixChange(prefix: string): void {
    this.selectedEventPrefix = prefix || "all";
    const idFromApplicant = this.resolveApplicantId(this.applicant);
    const id = (this.applicantId || idFromApplicant || null) as string | null;
    if (id) this.loadApplicantEvents(id, this.selectedEventPrefix, true);
  }

  /** Load documents for applicant and build groups by data_key */
  private loadApplicantDocuments(
    applicantId: string,
    force: boolean = false
  ): void {
    if (!applicantId) return;
    if (!force) {
      if (
        this.docsLoadedForApplicantId === applicantId &&
        this.documentGroups &&
        this.documentGroups.length
      ) {
        return;
      }
    }
    this.docsLoading = true;
    this.docsError = null;
    this.documentGroups = [];
    const params: any[] = [
      "R",
      null, // p_id_applicant_document
      applicantId, // p_id_applicant
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
      commandName: DriveWhipAdminCommand.crm_applicants_documents_crud_new,
      parameters: params,
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.docsError = String(res?.error || "Failed to load files");
          this.documentGroups = [];
          return;
        }
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const rows = Array.isArray(raw) ? raw : [];
        const docs: ApplicantDocument[] = rows
          .map((r) => this.normalizeDocRecord(r))
          .filter(Boolean) as ApplicantDocument[];
        // attach S3 URL
        for (const d of docs) {
          this.core.fetchFile(d.folder || "", d.document_name || "").subscribe({
            next: (response) => {
              d.url = response.data.url;
            },
            error: (err) => {
              console.error("[ApplicantPanel] fetchFile error", err);
              // Keep the document entry without a URL; users can still open/download later.
            },
          });
        }
        this.documentGroups = this.groupDocuments(docs);
        this.docsLoadedForApplicantId = applicantId;
      },
      error: (err) => {
        console.error("[ApplicantPanel] loadApplicantDocuments error", err);
        this.docsError = "Failed to load files";
        this.documentGroups = [];
      },
      complete: () => {
        this.docsLoading = false;
      },
    });
  }

  /** Load SMS chat history for the applicant using SP crm_applicant_chat_history */
  private loadChatHistory(
    applicantId: string,
    page: number = 1,
    force: boolean = false
  ): void {
    if (!applicantId) return;
    if (
      !force &&
      this.chatLoadedForApplicantId === applicantId &&
      this.chatPage === page &&
      this._resolvedMessages.length
    ) {
      this.scrollMessagesToBottomSoon(0, true);
      return;
    }
    this.chatLoading = true;
    this.chatError = null;
    this.chatPage = page;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicant_chat_history as any,
      parameters: [applicantId, page],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          this.chatError = String(res?.error || "Failed to load chat");
          this.messages = [];
          this.refreshResolvedMessages();
          return;
        }
        let rows: any[] = [];
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        rows = Array.isArray(raw) ? raw : [];
        // Normalize and reverse to chronological order (oldest first)
        const normalized = rows.map((r) => this.normalizeChatRecord(r));
        const chronological = normalized.slice().reverse();
        // Keep any optimistic messages that are still temp but only if there isn't a matching persisted outbound with same body
        const optimistic = (this.messages || []).filter((m) =>
          (m.id || "").toString().startsWith("temp-")
        );
        const outboundBodies = new Set(
          chronological
            .filter((m) => m.direction === "outbound")
            .map((m) => (m.body || "").toString().trim())
        );
        const keepOptimistic = optimistic.filter(
          (m) => !outboundBodies.has((m.body || "").toString().trim())
        );
        this.messages = [...chronological, ...keepOptimistic];
        this.refreshResolvedMessages();
        this.chatLoadedForApplicantId = applicantId;
        this.scrollMessagesToBottomSoon(0, true);
      },
      error: (err) => {
        console.error("[ApplicantPanel] loadChatHistory error", err);
        this.chatError = "Failed to load chat";
        this.messages = [];
        this.refreshResolvedMessages();
      },
      complete: () => {
        this.chatLoading = false;
      },
    });
  }

  private normalizeChatRecord(r: any): ApplicantMessage {
    const directionRaw = (r.Direction ?? r.message_direction ?? "")
      .toString()
      .toLowerCase();
    const direction: "inbound" | "outbound" =
      directionRaw === "outbound" ? "outbound" : "inbound";
    const body = String(r.Message ?? r.message_text ?? "");
    const sent = r.Sent ?? r.sent_at ?? r.create ?? r.created_at ?? null;
    const ts = sent ? new Date(sent) : null;
    const timeLabel =
      ts && !Number.isNaN(ts.getTime())
        ? new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).format(ts)
        : "";
    const createdByRaw =
      r.created_by ?? r.CREATED_BY ?? r.create ?? r.Create ?? null;
    const createdBy = createdByRaw ? String(createdByRaw) : null;
    const sender =
      direction === "outbound"
        ? this.authSession.user?.user || "You"
        : this.applicant?.first_name || "Applicant";

    // Try to infer delivery status from backend fields; if absent, default outbound to delivered
    const statusRaw: string = String(
      r.Status ??
        r.status ??
        r.delivery_status ??
        r.DeliveryStatus ??
        r.MessageStatus ??
        ""
    ).toLowerCase();
    let status: MessageStatus | undefined = undefined;
    if (statusRaw.includes("deliver")) {
      status =
        statusRaw.includes("not") || statusRaw.includes("undelivered")
          ? "not_delivered"
          : "delivered";
    } else if (statusRaw.includes("fail") || statusRaw.includes("error")) {
      status = "not_delivered";
    } else if (
      statusRaw.includes("pending") ||
      statusRaw.includes("queue") ||
      statusRaw.includes("send")
    ) {
      status = "pending";
    }
    if (!status && direction === "outbound") {
      // Default assumption: once persisted, outbound messages are effectively delivered
      status = "delivered";
    }
    return {
      id: String(r.ID ?? r.id_chat ?? ""),
      direction,
      sender,
      body,
      timestamp: timeLabel,
      channel: "SMS",
      status,
      statusLabel: this.defaultStatusLabel(status),
      automated: false,
      dayLabel: "",
      sentAt: sent,
      createdBy,
    };
  }

  private markOptimisticDelivered(tempId: string): void {
    if (!this.messages || !tempId) return;
    this.messages = this.messages.map((m) =>
      m.id === tempId
        ? { ...m, status: "delivered" as any, statusLabel: "Delivered" }
        : m
    );
    // If a non-temp outbound with same body exists, drop the temp one to avoid duplicates
    const temp = this.messages.find((m) => m.id === tempId);
    if (temp && temp.direction === "outbound") {
      const hasPersisted = this.messages.some(
        (m) =>
          (m.id || "").toString().startsWith("temp-") === false &&
          m.direction === "outbound" &&
          (m.body || "").toString().trim() ===
            (temp.body || "").toString().trim()
      );
      if (hasPersisted) {
        this.messages = this.messages.filter((m) => m.id !== tempId);
      }
    }
    this.refreshResolvedMessages();
  }

  private removeOptimistic(tempId: string): void {
    if (!this.messages || !tempId) return;
    this.messages = this.messages.filter((m) => m.id !== tempId);
    this.refreshResolvedMessages();
  }

  /**
   * Smoothly stick to bottom if the user is near the bottom, or force when requested.
   * Prevents jarring jumps while reading older messages.
   */
  private scrollMessagesToBottomSoon(
    delay: number = 50,
    force: boolean = false
  ): void {
    setTimeout(() => {
      try {
        const el = this.messagesScroll?.nativeElement;
        if (!el) return;
        const threshold = 120;
        const distanceFromBottom =
          el.scrollHeight - el.clientHeight - el.scrollTop;
        if (force || distanceFromBottom <= threshold) {
          el.scrollTop = el.scrollHeight;
        }
      } catch {}
    }, delay);
  }

  private normalizeDocRecord(r: any): ApplicantDocument {
    return {
      id_applicant_document: Number(
        r.id_applicant_document ?? r.ID_APPLICANT_DOCUMENT ?? r.id ?? 0
      ),
      id_applicant: String(
        r.id_applicant ?? r.ID_APPLICANT ?? r.idApplicant ?? ""
      ),
      data_key: String(r.data_key ?? r.DATA_KEY ?? ""),
      document_name: String(r.document_name ?? r.DOCUMENT_NAME ?? ""),
      status:
        r.status ?? r.STATUS ?? null ? String(r.status ?? r.STATUS) : null,
      created_at: r.created_at ?? r.CREATED_AT ?? null,
      approved_at: r.approved_at ?? r.APPROVED_AT ?? null,
      approved_by: r.approved_by ?? r.APPROVED_BY ?? null,
      disapproved_at: r.disapproved_at ?? r.DISAPPROVED_AT ?? null,
      disapproved_by: r.disapproved_by ?? r.DISAPPROVED_BY ?? null,
      folder: r.folder ?? r.FOLDER ?? null,
      url: "",
    };
  }

  private groupDocuments(docs: ApplicantDocument[]): DocumentGroup[] {
    const map = new Map<string, ApplicantDocument[]>();
    for (const d of docs) {
      const key = d.data_key || "Files";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    // sort docs by created_at desc inside each group
    const groups: DocumentGroup[] = Array.from(map.entries()).map(
      ([dataKey, items]) => ({
        dataKey,
        items: items.slice().sort((a, b) => {
          const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
          const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
          return tb - ta;
        }),
      })
    );
    // sort groups alphabetically by dataKey
    groups.sort((a, b) => a.dataKey.localeCompare(b.dataKey));
    return groups;
  }

  isImageDocument(doc: ApplicantDocument | null | undefined): boolean {
    if (!doc) return false;
    const name = (doc.document_name || "").toLowerCase();
    return /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.bmp|\.svg)$/.test(name);
  }

  /** True if the document is a PDF */
  isPdfDocument(doc: ApplicantDocument | null | undefined): boolean {
    return this.documentExtension(doc) === "pdf";
  }

  /** True if the document is a Word-like document (doc, docx, rtf, odt) */
  isWordDocument(doc: ApplicantDocument | null | undefined): boolean {
    const ext = this.documentExtension(doc);
    return ["doc", "docx", "rtf", "odt"].includes(ext);
  }

  documentExtension(doc: ApplicantDocument | null | undefined): string {
    if (!doc?.document_name) return "";
    const parts = doc.document_name.split(".");
    if (parts.length < 2) return "";
    return parts.pop()!.toLowerCase();
  }

  private documentKindFromExtension(ext: string): string {
    if (!ext) return "other";
    if (/(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(`.${ext}`)) return "image";
    if (ext === "pdf") return "pdf";
    if (["doc", "docx", "rtf", "odt"].includes(ext)) return "word";
    if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "sheet";
    if (["ppt", "pptx", "odp"].includes(ext)) return "slides";
    if (["txt", "md", "json", "xml"].includes(ext)) return "text";
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
    if (["mp3", "wav", "aac", "ogg", "flac"].includes(ext)) return "audio";
    if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
    return "other";
  }

  documentTypeLabel(doc: ApplicantDocument | null | undefined): string {
    const ext = this.documentExtension(doc);
    const kind = this.documentKindFromExtension(ext);
    switch (kind) {
      case "image":
        return "Image";
      case "pdf":
        return "PDF document";
      case "word":
        return "Word document";
      case "sheet":
        return "Spreadsheet";
      case "slides":
        return "Presentation";
      case "text":
        return "Text file";
      case "archive":
        return "Archive";
      case "audio":
        return "Audio";
      case "video":
        return "Video";
      default:
        return "File";
    }
  }

  /** Return a SafeResourceUrl for embedding a PDF in an <iframe> */
  pdfViewerSrc(doc: ApplicantDocument | null | undefined) {
    const url =
      doc?.url ||
      (doc
        ? this.core.getFileUrl(
            String(doc.folder || ""),
            String(doc.document_name || "")
          )
        : "");
    const viewUrl = url
      ? `${url}#toolbar=0&navpanes=0&zoom=page-width`
      : "about:blank";
    return this.sanitizer.bypassSecurityTrustResourceUrl(viewUrl);
  }

  /** Return a SafeResourceUrl for Office Online viewer embedding Word-like docs */
  officeViewerSrc(doc: ApplicantDocument | null | undefined) {
    const url =
      doc?.url ||
      (doc
        ? this.core.getFileUrl(
            String(doc.folder || ""),
            String(doc.document_name || "")
          )
        : "");
    if (!url)
      return this.sanitizer.bypassSecurityTrustResourceUrl("about:blank");
    const encoded = encodeURIComponent(url);
    const viewUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encoded}&wdPrint=0&wdDownloadButton=1`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(viewUrl);
  }

  documentIcon(doc: ApplicantDocument | null | undefined): string {
    const ext = this.documentExtension(doc);
    const kind = this.documentKindFromExtension(ext);
    switch (kind) {
      case "image":
        return "icon-image";
      case "pdf":
        return "icon-file-text";
      case "word":
        return "icon-file";
      case "sheet":
        return "icon-grid";
      case "slides":
        return "icon-sliders";
      case "text":
        return "icon-file-text";
      case "archive":
        return "icon-package";
      case "audio":
        return "icon-music";
      case "video":
        return "icon-film";
      default:
        return "icon-file";
    }
  }

  docStatusLabel(status: string | null | undefined): string {
    if (!status) return "Pending";
    const normalized = status.toString().replace(/[_-]+/g, " ").trim();
    return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  viewDocument(group: DocumentGroup, doc: ApplicantDocument, ev?: Event): void {
    if (!doc) return;
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (this.isImageDocument(doc)) {
      this.openImageViewer(group, doc);
      return;
    }
    this.openDocument(doc);
  }

  /** Open the in-app image viewer for the selected group/doc (falls back to openDocument for non-images) */
  openImageViewer(group: DocumentGroup, doc?: ApplicantDocument): void {
    try {
      const images = (group?.items || []).filter((d) =>
        this.isImageDocument(d)
      );
      if (!images.length) {
        // No images in this group, fallback to open in new tab if doc provided
        if (doc) {
          this.openDocument(doc);
        }
        return;
      }
      const startId = doc?.id_applicant_document;
      const idx = startId
        ? Math.max(
            0,
            images.findIndex((d) => d.id_applicant_document === startId)
          )
        : 0;
      this.viewerDocs = images;
      this.viewerIndex = idx >= 0 ? idx : 0;
      this.viewerZoom = 1;
      this.viewerRotate = 0;
      this.viewerPanX = 0;
      this.viewerPanY = 0;
      this.imageViewerOpen = true;
      this.loadViewerUrl();
    } catch (e) {
      console.error("[ApplicantPanel] openImageViewer error", e);
    }
  }

  loadViewerUrl(): void {
    const cur = this.viewerDocs[this.viewerIndex];
    if (!cur) {
      this.viewerCurrentUrl = "";
      return;
    }
    this.viewerLoading = true;
    this.core.fetchFile(cur.folder || "", cur.document_name || "").subscribe({
      next: (resp: any) => {
        const fresh = resp?.data?.url || cur.url || "";
        cur.url = fresh;
        this.viewerCurrentUrl = fresh;
        this.viewerLoading = false;
        // reset pan each time we load a new image
        this.viewerPanX = 0;
        this.viewerPanY = 0;
        // Optional: preload next
        const next = this.viewerDocs[this.viewerIndex + 1];
        if (next) {
          this.core
            .fetchFile(next.folder || "", next.document_name || "")
            .subscribe({
              next: (r: any) => {
                next.url = r?.data?.url || next.url || "";
              },
              error: () => {},
            });
        }
      },
      error: (err) => {
        console.error("[ApplicantPanel] loadViewerUrl error", err);
        this.viewerLoading = false;
        Utilities.showToast("Unable to load image", "error");
      },
    });
  }

  nextImage(): void {
    if (!this.viewerDocs.length) return;
    this.viewerIndex = (this.viewerIndex + 1) % this.viewerDocs.length;
    this.viewerZoom = 1;
    this.viewerRotate = 0;
    this.viewerPanX = 0;
    this.viewerPanY = 0;
    this.loadViewerUrl();
  }

  prevImage(): void {
    if (!this.viewerDocs.length) return;
    this.viewerIndex =
      (this.viewerIndex - 1 + this.viewerDocs.length) % this.viewerDocs.length;
    this.viewerZoom = 1;
    this.viewerRotate = 0;
    this.viewerPanX = 0;
    this.viewerPanY = 0;
    this.loadViewerUrl();
  }

  closeImageViewer(): void {
    this.imageViewerOpen = false;
    this.viewerCurrentUrl = "";
    this.viewerDocs = [];
    this.viewerIndex = 0;
    this.viewerZoom = 1;
    this.viewerRotate = 0;
    this.viewerPanX = 0;
    this.viewerPanY = 0;
    this.isPanning = false;
  }

  zoomIn(): void {
    this.viewerZoom = Math.min(this.viewerZoom + 0.25, 5);
  }
  zoomOut(): void {
    this.viewerZoom = Math.max(this.viewerZoom - 0.25, 0.25);
    if (this.viewerZoom <= 1) {
      this.viewerPanX = 0;
      this.viewerPanY = 0;
    }
  }
  resetZoom(): void {
    this.viewerZoom = 1;
    this.viewerRotate = 0;
    this.viewerPanX = 0;
    this.viewerPanY = 0;
  }
  rotateClockwise(): void {
    this.viewerRotate = (this.viewerRotate + 90) % 360;
  }

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

  onViewerTouchEnd(_ev: TouchEvent): void {
    if (this.isPanning) this.isPanning = false;
  }

  downloadDocument(doc: ApplicantDocument): void {
    try {
      const name = doc.document_name || "download";
      // Always fetch a fresh signed URL to avoid 403 due to short-lived tokens
      this.core.fetchFile(doc.folder || "", doc.document_name || "").subscribe({
        next: (response: any) => {
          const freshUrl =
            response?.data?.url ||
            doc.url ||
            this.core.getFileUrl(
              String(doc.folder || ""),
              String(doc.document_name || "")
            );
          if (!freshUrl) {
            Utilities.showToast("File URL not available", "warning");
            return;
          }
          this.forceDownload(freshUrl, name);
        },
        error: (err) => {
          console.error(
            "[ApplicantPanel] downloadDocument fetchFile error",
            err
          );
          Utilities.showToast("Unable to download file", "error");
        },
      });
    } catch {
      Utilities.showToast("Unable to download file", "error");
    }
  }

  /** Open the document in a new tab using a fresh signed URL (avoids stale links) */
  openDocument(doc: ApplicantDocument, ev?: Event): void {
    try {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      this.core.fetchFile(doc.folder || "", doc.document_name || "").subscribe({
        next: (response: any) => {
          const freshUrl =
            response?.data?.url ||
            doc.url ||
            this.core.getFileUrl(
              String(doc.folder || ""),
              String(doc.document_name || "")
            );
          if (!freshUrl) {
            Utilities.showToast("File URL not available", "warning");
            return;
          }
          // If it is an image, open in viewer; otherwise, open in new tab
          if (this.isImageDocument(doc)) {
            // Ensure list includes only this doc to avoid navigating to other groups unexpectedly
            this.viewerDocs = [{ ...doc, url: freshUrl }];
            this.viewerIndex = 0;
            this.viewerZoom = 1;
            this.viewerRotate = 0;
            this.viewerPanX = 0;
            this.viewerPanY = 0;
            this.viewerCurrentUrl = freshUrl;
            this.imageViewerOpen = true;
          } else {
            window.open(freshUrl, "_blank", "noopener");
          }
        },
        error: (err) => {
          console.error("[ApplicantPanel] openDocument fetchFile error", err);
          Utilities.showToast("Unable to open file", "error");
        },
      });
    } catch {
      Utilities.showToast("Unable to open file", "error");
    }
  }

  /** Refresh a document's signed URL (useful for preview <img> on error) */
  refreshDocUrl(doc: ApplicantDocument): void {
    try {
      this.core.fetchFile(doc.folder || "", doc.document_name || "").subscribe({
        next: (response: any) => {
          doc.url = response?.data?.url || doc.url || "";
        },
        error: (err) => {
          console.warn("[ApplicantPanel] refreshDocUrl error", err);
        },
      });
    } catch {
      /* noop */
    }
  }

  private async forceDownload(url: string, fileName: string): Promise<void> {
    try {
      // Use CORS-friendly fetch without credentials; many storage providers (e.g., S3)
      // will reject cross-origin requests with credentials, causing a redirect fallback.
      const res = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok || res.status === 0)
        throw new Error(`HTTP ${res.status || 0}`);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName || "download";
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
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = url;
        document.body.appendChild(iframe);
        // Clean up iframe later; if no download is triggered, this is a no-op
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {
            /* noop */
          }
        }, 30000);
      } catch {
        Utilities.showToast("Download failed", "error");
      }
    }
  }

  approveDocument(doc: ApplicantDocument): void {
    // Approval without notification; pass explicit overrides for consistency
    this.updateDocumentStatus(doc, "APPROVED", {
      eventCode: null,
      sendNotification: false,
      typeNotification: null,
      dataKeyOverride: doc?.data_key || null,
      documentNameOverride: doc?.document_name || null,
    });
  }

  disapproveDocument(doc: ApplicantDocument): void {
    // Immediate disapproval without notification
    this.updateDocumentStatus(doc, "DISAPPROVED", {
      eventCode: null,
      sendNotification: false,
      typeNotification: null,
      dataKeyOverride: doc?.data_key || null,
      documentNameOverride: doc?.document_name || null,
    });
  }

  // Open the re-collect panel instead of immediately disapproving
  openDisapproveSidebar(doc: ApplicantDocument): void {
    this.disapproveDoc = doc;
    this.disapproveSidebarOpen = true;
    this.disapproveReason = "";
    this.disapproveCustomReason = "";
    this.recollectSourceMode = false;
    this.recollectTemplateLoading = false;
    this.recollectTemplateError = null;
    this._recollectTemplateToken++;
    this.applyRecollectTemplate("");
    this.disapproveSendSms = false;
    this.disapproveNotifyOwner = false;
    this.ensureRecollectOptions();
    setTimeout(() => {
      if (this.recollectEditorRef?.nativeElement) {
        this.recollectEditorRef.nativeElement.innerHTML = "";
      }
    });
  }

  closeDisapproveSidebar(): void {
    this.disapproveSidebarOpen = false;
  }

  async onDisapproveReasonChange(val: string): Promise<void> {
    this.disapproveReason = val || "";
    if (val !== "RECOLLECT_CUSTOM") {
      this.disapproveCustomReason = "";
    }
    if (!val) {
      this._recollectTemplateToken++;
      this.recollectTemplateLoading = false;
      this.recollectTemplateError = null;
      this.applyRecollectTemplate("");
      return;
    }
    if (val === "RECOLLECT_CUSTOM") {
      this._recollectTemplateToken++;
      this.recollectTemplateLoading = false;
      this.recollectTemplateError = null;
      this.applyRecollectTemplate("");
      return;
    }
    await this.loadRecollectTemplateForSelection(val);
  }

  get disapproveReasonValid(): boolean {
    if (this.disapproveReason === "RECOLLECT_CUSTOM")
      return !!this.disapproveCustomReason.trim();
    return !!(this.disapproveReason || "").trim();
  }

  get disapprovePreviewText(): string {
    const reason = this.currentRecollectDescription();
    const base = reason ? `Reason: ${reason}` : "";
    const msg = this.disapproveMessage?.trim()
      ? `\n\n${this.disapproveMessage.trim()}`
      : "";
    return `${base}${msg}`.trim();
  }

  get disapproveSubject(): string {
    const label = this.currentRecollectDescription() || "Document";
    return `[ACTION REQUIRED] Please Re-send: ${label}`;
  }

  get disapproveTo(): string {
    return this.applicant?.email || "applicant";
  }

  setDisapprovePreviewMode(mode: "desktop" | "mobile"): void {
    this.disapprovePreviewMode = mode;
  }

  // Re-collect editor controls (mirror of email composer)
  recollectExec(cmd: string, value?: string): void {
    try {
      document.execCommand(cmd, false, value);
      // sync content
      this.captureRecollectContentFromEditor();
    } catch {}
  }

  toggleRecollectSource(): void {
    this.recollectSourceMode = !this.recollectSourceMode;
    if (!this.recollectSourceMode) {
      // switching back to WYSIWYG: push source into editor
      this.syncRecollectEditorFromContent();
    }
  }

  recollectInsertLink(): void {
    const url = prompt("Enter URL");
    if (!url) return;
    this.recollectExec("createLink", url);
  }

  onRecollectEditorInput(_ev: Event): void {
    this.captureRecollectContentFromEditor();
  }

  private captureRecollectContentFromEditor(): void {
    const el = this.recollectEditorRef?.nativeElement;
    if (!el) return;
    // Drop unsafe tags and keep only safely scoped styles to avoid leaking to host app
    this.recollectContent = this.stripDangerousTags(el.innerHTML || "");
    // keep a plain-text version for SMS counters and fallback (preserve links)
    this.disapproveMessage = this.htmlToSmsText(this.recollectContent).slice(
      0,
      1000
    );
  }

  private syncRecollectEditorFromContent(): void {
    const el = this.recollectEditorRef?.nativeElement;
    if (!el) return;
    el.innerHTML = this.recollectContent || "";
  }

  onRecollectSourceChange(val: string): void {
    // When editing source, sanitize as-you-type to prevent global leakage
    this.recollectContent = this.stripDangerousTags(val || "");
    // derive SMS-friendly text preserving anchor hrefs
    this.disapproveMessage = this.htmlToSmsText(this.recollectContent).slice(
      0,
      1000
    );
  }

  get recollectCharCount(): number {
    return (this.disapproveMessage || "").length;
  }
  get recollectSmsSegments(): number {
    const len = this.recollectCharCount;
    if (len === 0) return 0;
    return Math.ceil(len / 160);
  }

  get recollectPreviewHtml(): SafeHtml {
    const reason = this.currentRecollectDescription();
    const reasonHtml = reason
      ? `<div><strong>Reason:</strong> ${this.escapeHtml(reason)}</div>`
      : "";
    const bodyHtml = this.recollectContent
      ? this.recollectContent
      : `<div>${this.escapeHtml(this.disapproveMessage || "")}</div>`;
    const html = `${reasonHtml}${bodyHtml}`;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private async loadRecollectTemplateForSelection(code: string): Promise<void> {
    const doc = this.disapproveDoc;
    const idApplicant =
      this.resolveApplicantId(this.applicant) || this.applicantId;
    if (!doc || !code || code === "RECOLLECT_CUSTOM" || !idApplicant) {
      this.applyRecollectTemplate("", undefined);
      return;
    }

    const description = this.disapproveReasonMap[code] || code;
    const dataKey = (doc.data_key || doc.document_name || "").toString();
    const token = ++this._recollectTemplateToken;
    this.recollectTemplateLoading = true;
    this.recollectTemplateError = null;

    const api: IDriveWhipCoreAPI = {
      commandName:
        DriveWhipAdminCommand.crm_applicants_recollect_menssage as any,
      parameters: [String(idApplicant), code, description, dataKey, "email"],
    } as any;

    try {
      const res = await firstValueFrom(
        this.core.executeCommand<DriveWhipCommandResponse<any>>(api)
      );
      if (token !== this._recollectTemplateToken) {
        return;
      }

      let emailBody = "";
      let smsBody = "";
      if (res?.ok) {
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const row = Array.isArray(raw) && raw.length ? raw[0] : raw;
        emailBody = String(
          row?.message_email ??
            row?.MESSAGE_EMAIL ??
            row?.message ??
            row?.MESSAGE ??
            ""
        );
        smsBody = String(
          row?.message_sms ??
            row?.MESSAGE_SMS ??
            row?.sms ??
            row?.SMS ??
            ""
        );
      }

      const normalizedEmail = this.normalizeEmailBody(emailBody);
      const normalizedSms = smsBody.trim();
      this.applyRecollectTemplate(normalizedEmail, normalizedSms);
    } catch (err) {
      if (token !== this._recollectTemplateToken) {
        return;
      }
      console.error(
        "[ApplicantPanel] loadRecollectTemplateForSelection error",
        err
      );
      this.recollectTemplateError = "Failed to load re-collect message";
      this.applyRecollectTemplate("", undefined);
      Utilities.showToast("Unable to load the re-collect message.", "error");
    } finally {
      if (token === this._recollectTemplateToken) {
        this.recollectTemplateLoading = false;
      }
    }
  }

  private applyRecollectTemplate(emailHtml: string, smsPlain?: string): void {
    const normalizedEmail = emailHtml || "";
    // Scope styles (body/html/#bodyTable → .dw-email-scope …) and strip dangerous tags
    this.recollectContent = this.sanitizeAndScopeEmailHtml(normalizedEmail);
    const smsSource = (smsPlain && smsPlain.trim())
      ? smsPlain.trim()
      : this.htmlToSmsText(this.recollectContent);
    this.disapproveMessage = smsSource.slice(0, 1000);
    if (this.recollectSourceMode) {
      // textarea binding updates automatically in source mode
      return;
    }
    this.syncRecollectEditorFromContent();
  }

  private normalizeEmailBody(body: string): string {
    const raw = (body ?? "").toString();
    if (!raw.trim()) return "";
    if (/[<][a-zA-Z]+/.test(raw)) {
      return raw;
    }
    // Treat as plain text -> convert newlines to paragraphs for editor display
    const lines = raw.split(/\r?\n/).map((line) => line.trim());
    return lines
      .map((line) => (line ? `<p>${this.escapeHtml(line)}</p>` : '<p><br></p>'))
      .join("");
  }

  private plainTextFromHtml(html: string): string {
    if (!html) return "";
    if (typeof document !== "undefined") {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      const text = tmp.innerText || tmp.textContent || "";
      return text.replace(/\u00a0/g, " ").trim();
    }
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private htmlToSmsText(html: string): string {
    if (!html) return "";
    if (typeof document !== "undefined") {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      // Replace anchors with "text: href" to preserve URLs in SMS
      const anchors = Array.from(
        tmp.querySelectorAll("a")
      ) as HTMLAnchorElement[];
      for (const a of anchors) {
        const text = (a.textContent || "").trim();
        const href = (a.getAttribute("href") || "").trim();
        const replacement = document.createTextNode(
          href ? (text ? `${text}: ${href}` : href) : text
        );
        a.parentNode?.replaceChild(replacement, a);
      }
      // Convert <br> to newlines
      const brs = Array.from(tmp.querySelectorAll("br"));
      for (const br of brs) {
        br.parentNode?.replaceChild(document.createTextNode("\n"), br);
      }
      // Extract text
      let text = (tmp.innerText || tmp.textContent || "").replace(
        /\u00a0/g,
        " "
      );
      // Normalize whitespace and limit consecutive blank lines
      text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      text = text.replace(/\n{3,}/g, "\n\n");
      return text.trim();
    }
    // Fallback regex-based conversion
    return html
      .replace(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi,
        (_m, href, inner) => {
          const t = String(inner)
            .replace(/<[^>]+>/g, "")
            .trim();
          return t ? `${t}: ${href}` : href;
        }
      )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Submit the re-collect request: generate messages via SP and send Email (+ optional SMS)
  async sendDisapprove(): Promise<void> {
    if (
      !this.disapproveDoc ||
      !this.disapproveReasonValid ||
      this.disapproveSending
    )
      return;
    const idApplicant =
      this.resolveApplicantId(this.applicant) || this.applicantId;
    if (!idApplicant) {
      Utilities.showToast("Applicant id not found", "warning");
      return;
    }
    const emailTo = (
      this.applicant?.email ||
      this.applicant?.email_address ||
      ""
    )
      .toString()
      .trim();
    const smsTo = (this.getApplicantPhone(this.applicant) || "")
      .toString()
      .trim();
    const subject = this.disapproveSubject;

    // Require at least Email or (if checked) SMS target
    if (!emailTo && !this.disapproveSendSms) {
      Utilities.showToast("Applicant email not found", "warning");
      return;
    }
    if (this.disapproveSendSms && !smsTo) {
      Utilities.showToast("Applicant phone not found for SMS", "warning");
      return;
    }

    this.disapproveSending = true;
    try {
      const emailHtml = this.recollectContent?.trim()
        ? this.recollectContent
        : this.buildRecollectEmailHtmlFallback();

      if (emailTo) {
        const templateId = this.core.accountCreatedTemplateId || "";
        if (!templateId) {
          Utilities.showToast("Email template is not configured", "warning");
        } else {
          let finalEmailHtml = emailHtml;
          try {
            const preparedEmail = await firstValueFrom(
              this.core.prepareNotificationMessage(
                "email",
                String(idApplicant),
                emailHtml
              )
            );
            if ((preparedEmail || "").trim()) {
              finalEmailHtml = preparedEmail;
            }
          } catch (err) {
            console.error("[ApplicantPanel] Re-collect email preparation error", err);
            Utilities.showToast(
              this.notificationErrorMessage(err, "Failed to prepare email message"),
              "error"
            );
            this.disapproveSending = false;
            return;
          }
          try {
            await firstValueFrom(
              this.core.sendTemplateEmail({
                title: subject,
                message: finalEmailHtml,
                templateId,
                to: [emailTo],
              })
            );
          } catch (e) {
            console.error("[ApplicantPanel] Re-collect email send error", e);
            Utilities.showToast("Failed to send email", "error");
          }
        }
      }

      if (this.disapproveSendSms && smsTo) {
        let smsText = (this.disapproveMessage || "").toString().trim();
        if (!smsText) {
          smsText = this.htmlToSmsText(emailHtml);
        }
        if (!smsText) {
          smsText = this.currentRecollectDescription();
        }
        if (!smsText) {
          Utilities.showToast("No SMS message available", "warning");
          this.disapproveSending = false;
          return;
        }
        try {
          const preparedSms = await firstValueFrom(
            this.core.prepareNotificationMessage(
              "sms",
              String(idApplicant),
              smsText
            )
          );
          if ((preparedSms || "").trim()) {
            smsText = preparedSms;
          }
        } catch (err) {
          console.error("[ApplicantPanel] Re-collect SMS preparation error", err);
          Utilities.showToast(
            this.notificationErrorMessage(err, "Failed to prepare SMS message"),
            "error"
          );
          this.disapproveSending = false;
          return;
        }
        smsText = (smsText || "").trim().slice(0, 1000);
        const from = this.defaultSmsFromNumber();
        try {
          await firstValueFrom(
            this.core.sendChatSms({
              from,
              to: smsTo,
              message: smsText,
              id_applicant: String(idApplicant),
            })
          );
        } catch (e) {
          console.error("[ApplicantPanel] Re-collect SMS send error", e);
          this.smsSendFailureToast();
        }
      }

      // 3) Update status and log notification in history via SP extra params
      const eventCode = (this.disapproveReason || "").trim() || null;
      const typeNotification = this.disapproveSendSms ? (emailTo ? 3 : 1) : 2; // if no SMS, it's email-only; earlier validation ensures at least one channel
      this.updateDocumentStatus(this.disapproveDoc, "DISAPPROVED", {
        eventCode,
        sendNotification: true,
        typeNotification,
        dataKeyOverride: this.disapproveDoc?.data_key || null,
        documentNameOverride: this.disapproveDoc?.document_name || null,
      });
      Utilities.showToast("Re-collect notification sent", "success");
      this.closeDisapproveSidebar();
    } finally {
      this.disapproveSending = false;
    }
  }

  /** Ensure recollect reason options are loaded (from crm_notifications_templates_combos('RECOLLECT_DOCUMENTS')) */
  private ensureRecollectOptions(): void {
    if (
      this.disapproveReasonOptions.length > 0 ||
      this.disapproveOptionsLoading
    )
      return;
    this.loadRecollectOptions();
  }

  private loadRecollectOptions(): void {
    this.disapproveOptionsLoading = true;
    this.disapproveOptionsError = null;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand
        .crm_notifications_templates_combos as any,
      parameters: ["RECOLLECT_DOCUMENTS"],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        let raw: any = res?.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const rows = Array.isArray(raw) ? raw : [];
        const items: Array<{ code: string; description: string }> = [];
        const map: Record<string, string> = {};
        for (const r of rows) {
          // SP returns flexible columns; normalize to { code, description }
          // Prefer textual event/code fields; fall back to id-based keys if needed.
          const code = String(
            r.option ?? r.OPTION ?? r.event ?? r.EVENT ?? r.code ?? r.CODE ?? r.key ?? r.KEY ?? r.type ?? r.TYPE ?? ""
          ).trim() || String(
            r.id ?? r.ID ?? r.template_id ?? r.TEMPLATE_ID ?? r.id_template ?? r.ID_TEMPLATE ?? ""
          ).trim();
          const description = String(
            r.description ?? r.DESCRIPTION ?? r.label ?? r.LABEL ?? r.name ?? r.NAME ?? r.template_name ?? r.TEMPLATE_NAME ?? r.subject ?? r.SUBJECT ?? code
          ).trim();
          if (!code || !description) continue;
          if (!map[code]) {
            map[code] = description;
            items.push({ code, description });
          }
        }
        // Ensure custom option exists if backend doesn't include it
        if (!map["RECOLLECT_CUSTOM"]) {
          map["RECOLLECT_CUSTOM"] = "Custom reason";
          items.push({ code: "RECOLLECT_CUSTOM", description: "Custom reason" });
        }
        this.disapproveReasonMap = map;
        this.disapproveReasonOptions = items;
      },
      error: (err) => {
        console.error("[ApplicantPanel] loadRecollectOptions error", err);
        this.disapproveOptionsError = "Failed to load re-collect reasons";
      },
      complete: () => {
        this.disapproveOptionsLoading = false;
      },
    });
  }

  /** Resolve selected reason description (map code->description or custom text) */
  private currentRecollectDescription(): string {
    if ((this.disapproveReason || "") === "RECOLLECT_CUSTOM")
      return (this.disapproveCustomReason || "").trim();
    const code = (this.disapproveReason || "").trim();
    return this.disapproveReasonMap[code] || code;
  }

  /** Build a simple HTML body as fallback if SP returns no email body */
  private buildRecollectEmailHtmlFallback(): string {
    const reason = this.currentRecollectDescription();
    const reasonHtml = reason
      ? `<div><strong>Reason:</strong> ${this.escapeHtml(reason)}</div>`
      : "";
    const bodyHtml = this.recollectContent
      ? this.recollectContent
      : `<div>${this.escapeHtml(this.disapproveMessage || "")}</div>`;
    return `${reasonHtml}${bodyHtml}`;
  }

  /** Helper: whether current selection is custom reason */
  isCustomRecollect(): boolean {
    return (this.disapproveReason || "") === "RECOLLECT_CUSTOM";
  }

  private updateDocumentStatus(
    doc: ApplicantDocument,
    status: string,
    opts?: {
      eventCode?: string | null;
      sendNotification?: boolean;
      typeNotification?: number | null; // 1: SMS, 2: EMAIL, 3: BOTH
      dataKeyOverride?: string | null;
      documentNameOverride?: string | null;
    }
  ): void {
    if (!doc || !doc.id_applicant_document) return;
    const now = new Date();
    const fmt = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
    const approved_at = status.toUpperCase() === "APPROVED" ? fmt(now) : null;
    const approved_by =
      status.toUpperCase() === "APPROVED" ? this.currentUserIdentifier() : null;
    const disapproved_at =
      status.toUpperCase() === "DISAPPROVED" ? fmt(now) : null;
    const disapproved_by =
      status.toUpperCase() === "DISAPPROVED"
        ? this.currentUserIdentifier()
        : null;
    const data_key = (opts?.dataKeyOverride ?? doc.data_key ?? null) as any;
    const document_name = (opts?.documentNameOverride ??
      doc.document_name ??
      null) as any;
    const id_stage =
      (doc as any)?.id_stage ??
      this.currentStageIdNum ??
      this.applicant?.stageId ??
      this.applicant?.raw?.id_stage ??
      null;
    const eventCode = (opts?.eventCode ?? null) as any;
    const sendNotification = opts?.sendNotification ? 1 : 0; // BOOL -> tinyint
    const typeNotification = (opts?.typeNotification ?? null) as any;
    const params: any[] = [
      "U", // p_action
      doc.id_applicant_document, // p_id_applicant_document
      doc.id_applicant, // p_id_applicant
      id_stage, // p_id_stage
      data_key, // p_data_key
      document_name, // p_document_name
      status, // p_status
      approved_at, // p_approved_at
      approved_by, // p_approved_by
      disapproved_at, // p_disapproved_at
      disapproved_by, // p_disapproved_by
      eventCode, // p_eventcode
      sendNotification, // p_send_notification (BOOL)
      typeNotification, // p_type_notification (1 sms, 2 email, 3 ambos)
    ];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_documents_crud_new,
      parameters: params,
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        if (!res?.ok) {
          Utilities.showToast(
            String(res?.error || "Failed to update document"),
            "error"
          );
          return;
        }
        Utilities.showToast("Document updated", "success");
        const id = this.resolveApplicantId(this.applicant) || this.applicantId;
        if (id) {
          // force reload
          this.docsLoadedForApplicantId = null;
          this.loadApplicantDocuments(String(id), true);
          // Notify parent (grid) that applicant data changed so it can refresh status column
          try {
            this.applicantSaved.emit({ id: String(id), payload: {} });
          } catch {}
        }
      },
      error: (err) => {
        console.error("[ApplicantPanel] updateDocumentStatus error", err);
        Utilities.showToast("Failed to update document", "error");
      },
      complete: () => {},
    });
  }

  private isStatusRecollecting(status: string | null | undefined): boolean {
    const s = (status || "").toString().trim().toUpperCase();
    return (
      s === "RECOLLECTING" ||
      s === "RE-COLLECTING" ||
      s === "RE-COLLECTING FILE" ||
      s === "RE COLLECTING FILE" ||
      s.includes("RE-COLLECT")
    );
  }

  private isStatusApproved(status: string | null | undefined): boolean {
    return (status || "").toString().trim().toUpperCase() === "APPROVED";
  }

  private isStatusDisapproved(status: string | null | undefined): boolean {
    return (status || "").toString().trim().toUpperCase() === "DISAPPROVED";
  }

  private isStatusPending(status: string | null | undefined): boolean {
    return (status || "").toString().trim().toUpperCase() === "PENDING";
  }

  private docStatusClassByStatus(status: string | null | undefined): string {
    if (this.isStatusApproved(status)) return "text-success";
    if (this.isStatusDisapproved(status)) return "text-danger";
    if (this.isStatusRecollecting(status)) return "text-warning";
    return "text-secondary";
  }

  docStatusClass(doc: ApplicantDocument): string {
    return this.docStatusClassByStatus(doc?.status);
  }

  /** Compute a group-level status: if any item is Re-collecting, show that; else if any Disapproved; else if any Pending; else if any Approved; else fallback first item's status. */
  getGroupStatus(
    group: { items?: ApplicantDocument[] } | null | undefined
  ): string | null {
    const items = group?.items || [];
    if (!items.length) return null;
    if (items.some((d) => this.isStatusRecollecting(d.status)))
      return "Re-collecting File";
    if (items.some((d) => this.isStatusDisapproved(d.status)))
      return "Disapproved";
    if (items.some((d) => this.isStatusPending(d.status))) return "Pending";
    if (items.some((d) => this.isStatusApproved(d.status))) return "Approved";
    // Fallback to the first non-empty status
    const firstStatus =
      items.find((d) => !!d.status)?.status || items[0].status || null;
    return firstStatus || null;
  }

  groupStatusClass(
    group: { items?: ApplicantDocument[] } | null | undefined
  ): string {
    return this.docStatusClassByStatus(this.getGroupStatus(group));
  }

  isGroupRecollecting(
    group: { items?: ApplicantDocument[] } | null | undefined
  ): boolean {
    const items = group?.items || [];
    return items.some((d) => this.isStatusRecollecting(d.status));
  }

  // Public helpers for template conditionals per-document
  isDocRecollecting(doc: ApplicantDocument | null | undefined): boolean {
    return this.isStatusRecollecting(doc?.status);
  }
  isDocApproved(doc: ApplicantDocument | null | undefined): boolean {
    return this.isStatusApproved(doc?.status);
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
    if (typeof data === "object") return data;
    return null;
  }

  private applyApplicantRecord(record: any): void {
    if (!record) return;
    const normalized = this.normalizeApplicantRecord(record);
    console.log(normalized);
    // Merge cautiously: do not overwrite existing non-empty names with empty strings
    const merged = { ...this.applicant, ...normalized } as any;
    if (this.applicant?.first_name && !normalized.first_name) {
      merged.first_name = this.applicant.first_name;
    }
    if (this.applicant?.last_name && !normalized.last_name) {
      merged.last_name = this.applicant.last_name;
    }
    // Recompute combined name to ensure header consistency
    const fn = (merged.first_name || '').toString().trim();
    const ln = (merged.last_name || '').toString().trim();
    merged.name = [fn, ln].filter(Boolean).join(' ').trim() || merged.name || '';
    this.cachedApplicantDetails = { ...merged };
    this.applicant = merged;
    this.editableApplicant = { ...merged };
    this.updatePhoneSubscription().catch(() => {});
  }

  private normalizeApplicantRecord(record: any): any {
    // Preserve existing first/last name if the read payload happens to omit them
    const firstName = this.coalesce(
      record.first_name,
      record.FIRST_NAME,
      record.firstName,
      this.applicant?.first_name,
      ""
    );
    const lastName = this.coalesce(
      record.last_name,
      record.LAST_NAME,
      record.lastName,
      this.applicant?.last_name,
      ""
    );
    const email = this.coalesce(record.email, record.EMAIL, "");
    const phone = this.coalesce(record.phone_number, record.PHONE_NUMBER, "");
    const id = this.coalesce(
      record.id_applicant,
      record.ID_APPLICANT,
      record.id,
      this.resolveApplicantId(record),
      this.resolveApplicantId(this.applicant)
    );
    const countryCode = this.coalesce(
      record.country_code,
      record.COUNTRY_CODE,
      ""
    );
    const stateCode = this.coalesce(record.state_code, record.STATE_CODE, "");
    const street = this.coalesce(record.street, record.STREET, "");
    const city = this.coalesce(record.city, record.CITY, "");
    const zip = this.coalesce(record.zip_code, record.ZIP_CODE, "");
    const createdAt = this.coalesce(record.created_at, record.CREATED_AT, null);
    const updatedAt = this.coalesce(record.updated_at, record.UPDATED_AT, null);
    const referral = this.coalesce(
      record.referral_name,
      record.REFERRAL_NAME,
      ""
    );
    const acceptTerms = this.booleanize(
      record.accept_terms ?? record.ACCEPT_TERMS
    );
    const allowMsgUpdates = this.booleanize(
      record.allow_msg_updates ?? record.ALLOW_MSG_UPDATES
    );
    const allowCalls = this.booleanize(
      record.allow_calls ?? record.ALLOW_CALLS
    );
    const isActive = this.booleanize(
      record.is_active ?? record.IS_ACTIVE ?? true
    );

    const detailItems: { label: string; value: string }[] = [];
    const addDetail = (label: string, value: any) => {
      if (value === null || value === undefined || value === "") return;
      detailItems.push({ label, value: String(value) });
    };
    addDetail("Referral", referral);
    addDetail("Phone", phone);
    addDetail("Email", email);
    addDetail(
      "Address",
      [street, city, stateCode, zip].filter(Boolean).join(", ")
    );
    addDetail("Country", countryCode);
    addDetail("Accept terms", acceptTerms ? "Yes" : "No");
    addDetail("Allow messaging updates", allowMsgUpdates ? "Yes" : "No");
    addDetail("Allow calls", allowCalls ? "Yes" : "No");
    if (createdAt) addDetail("Created at", createdAt);
    if (updatedAt) addDetail("Updated at", updatedAt);

    return {
      id,
      id_applicant: id,
      first_name: firstName,
      last_name: lastName,
      name:
        [firstName, lastName].filter(Boolean).join(" ").trim() ||
        (this.applicant?.name ?? ""),
      email,
      phone,
      phone_number: phone,
      referral_name: referral,
      accept_terms: acceptTerms,
      allow_msg_updates: allowMsgUpdates,
      allow_calls: allowCalls,
      is_active: isActive,
      // returned by READ branch of crm_applicants_crud when p_id_applicant provided
      go_to_driver: this.booleanize(
        record.go_to_driver ?? (record.GO_TO_DRIVER as any) ?? false
      ),
      country_code: countryCode,
      state_code: stateCode,
      street,
      city,
      zip_code: zip,
      created_at: createdAt,
      updated_at: updatedAt,
      details: detailItems,
      updated_by:
        record.updated_by ??
        record.UPDATED_BY ??
        this.applicant?.updated_by ??
        null,
      created_by:
        record.created_by ??
        record.CREATED_BY ??
        this.applicant?.created_by ??
        null,
    };
  }

  private coalesce<T>(...values: T[]): T | null {
    for (const v of values) {
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  }

  private booleanize(value: any): boolean {
    if (typeof value === "boolean") return value;
    if (value === null || value === undefined) return false;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      return (
        lowered === "1" ||
        lowered === "true" ||
        lowered === "yes" ||
        lowered === "y"
      );
    }
    return Boolean(value);
  }

  get stageIconClass(): string {
    const icon =
      (this.stageIcon ?? "").trim() || (this.applicant?.stageIcon ?? "").trim();
    return icon || "icon-layers";
  }

  // Whether to show the Approve-as-Driver CTA in More actions
  get showApproveDriver(): boolean {
    const v =
      (this.applicant as any)?.go_to_driver ??
      (this.applicant as any)?.GO_TO_DRIVER;
    return this.booleanize(v);
  }

  get stageMenuOptions(): StageMenuOption[] {
    const source = this.availableStages ?? [];
    return source.map((stage: any) => {
      const rawId =
        stage?.id_stage ?? stage?.id ?? stage?.idStage ?? stage?.ID ?? null;
      const numId = rawId === null || rawId === undefined ? NaN : Number(rawId);
      const safeId = Number.isFinite(numId) ? numId : -1; // avoid 0/NaN collisions
      return {
        id: safeId,
        name: (stage?.name ?? "").toString(),
        type: (stage?.type ?? "Stage").toString(),
      } as StageMenuOption;
    });
  }

  get stageMenuViewOptions(): StageMenuViewOption[] {
    return this.stageMenuOptions.map((option) => ({
      ...option,
      typeLabel: this.formatStageTypeLabel(option.type),
    }));
  }

  private formatStageTypeLabel(type: string): string {
    const trimmed = (type ?? "").toString().trim();
    if (!trimmed) return "Stages";
    const withSpaces = trimmed
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
    const words = withSpaces.split(" ").filter(Boolean);
    if (!words.length) return "Stages";
    return words
      .map((word) => {
        const upper = word.toUpperCase();
        if (word.length <= 3 && word === upper) return upper;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ");
  }

  // ===== Phone editor helpers =====
  toggleCountryMenu(e?: Event): void {
    if (e) e.stopPropagation();
    this.countryMenuOpen = !this.countryMenuOpen;
    if (this.countryMenuOpen) {
      this.filteredCountries = PHONE_COUNTRIES.slice();
      this.countrySearch = "";
      setTimeout(() => this.countrySearchInput?.nativeElement?.focus(), 0);
    }
  }
  closeCountryMenu(): void {
    this.countryMenuOpen = false;
  }
  onCountrySearch(term: string): void {
    this.countrySearch = term;
    const t = term.trim().toLowerCase();
    if (!t) {
      this.filteredCountries = PHONE_COUNTRIES.slice();
      return;
    }
  this.filteredCountries = PHONE_COUNTRIES.filter((c: PhoneCountry) =>
      c.name.toLowerCase().includes(t) || c.iso2.includes(t) || c.dial.startsWith(t.replace(/^\+/, ""))
    );
  }
  selectCountry(c: PhoneCountry): void {
    this.selectedCountry = c;
    this.closeCountryMenu();
    // recompute E.164 value on country change
    this.composeE164FromEditor();
  }
  onPhoneLocalChange(val: string): void {
    // format for display for US/CA, else keep digits/space
    const onlyDigits = val.replace(/\D+/g, "");
    if (this.selectedCountry.dial === "1") {
      this.phoneLocal = this.formatNanp(onlyDigits);
    } else {
      this.phoneLocal = onlyDigits;
    }
    this.composeE164FromEditor();
  }
  private composeE164FromEditor(): void {
    const digits = this.phoneLocal.replace(/\D+/g, "");
    const code = this.selectedCountry?.dial ?? "";
    const e164 = digits ? `+${code}${digits}` : code ? `+${code}` : "";
    if (!this.editableApplicant) this.editableApplicant = {};
    this.editableApplicant.phone = e164;
  }
  private initPhoneFromValue(value: string): void {
    const input = String(value || "").trim();
    if (input.startsWith("+")) {
      const digits = input.replace(/\D+/g, "");
      // find country by longest matching dial
      let match: PhoneCountry | null = null;
      for (const c of PHONE_COUNTRIES.slice().sort((a: PhoneCountry, b: PhoneCountry)=> b.dial.length - a.dial.length)) {
        if (digits.startsWith(c.dial)) { match = c; break; }
      }
      this.selectedCountry = match || this.selectedCountry;
      const localDigits = match ? digits.slice(match.dial.length) : digits;
      this.phoneLocal = this.selectedCountry.dial === "1" ? this.formatNanp(localDigits) : localDigits;
    } else {
      // default to US and use raw digits
      this.selectedCountry = PHONE_COUNTRIES.find((c: PhoneCountry)=>c.iso2==='us') || this.selectedCountry;
      const digits = input.replace(/\D+/g, "");
      this.phoneLocal = this.formatNanp(digits);
      this.composeE164FromEditor();
    }
  }
  private formatNanp(d: string): string {
    const s = (d || "").slice(0, 10);
    if (!s) return "";
    const a = s.slice(0, 3);
    const b = s.slice(3, 6);
    const c = s.slice(6, 10);
    if (s.length <= 3) return a;
    if (s.length <= 6) return `${a} ${b}`;
    return `${a} ${b} ${c}`;
  }
  flagUrl(iso?: string | null): string {
    if (!iso) return "https://flagcdn.com/24x18/un.png";
    return `https://flagcdn.com/24x18/${iso.toLowerCase()}.png`;
  }

  @HostListener('document:click')
  onDocClick(): void {
    if (this.countryMenuOpen) {
      this.closeCountryMenu();
    }
  }

  // Normalize currentStageId to a number when possible for safe comparisons in template
  get currentStageIdNum(): number | null {
    const v: any = this.currentStageId;
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private isReviewFiles(stage: string | null | undefined): boolean {
    const s = (stage || "").toString().trim().toLowerCase();
    return s === "review files";
  }

  private isAllFilesApproved(stage: string | null | undefined): boolean {
    const s = (stage || "").toString().trim().toLowerCase();
    return s === "all files approved";
  }

  private isRecollecting(stage: string | null | undefined): boolean {
    const s = (stage || "").toString().trim().toLowerCase();
    // Match phrases like "Re-collecting", case-insensitive
    return /\bre-collecting\b/i.test(s);
  }

  statusBadgeClass(status: ApplicantStatus | null | undefined): string {
    if (!status) return "bg-secondary-subtle text-secondary";
    const stage = (status.stage || "").toString();
    if (this.isAllFilesApproved(stage)) return "bg-success-subtle text-success";
    if (this.isReviewFiles(stage)) return "bg-info text-white";
    if (this.isRecollecting(stage)) return "bg-info-subtle text-info";
    return status.isComplete
      ? "bg-success-subtle text-success"
      : "bg-primary-subtle text-primary";
  }

  statusBadgeIcon(status: ApplicantStatus | null | undefined): string {
    if (!status) return "icon-shield";
    const stage = (status.stage || "").toString();
    if (this.isAllFilesApproved(stage)) return "icon-check-circle";
    if (this.isReviewFiles(stage)) return "icon-folder";
    if (this.isRecollecting(stage)) return "icon-clock";
    return status.isComplete ? "icon-check-circle" : "icon-shield";
  }

  private toTitleCaseSimple(s: string): string {
    const t = (s || "").toString().trim();
    if (!t) return "";
    return t
      .split(/\s+/)
      .map((w) =>
        w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""
      )
      .join(" ");
  }

  statusBadgeText(status: ApplicantStatus | null | undefined): string {
    if (!status) return "Status";
    const stage = (status.stage || "Stage").toString().trim();
    // For special stages, show only the stage text (grid behavior parity)
    if (
      this.isAllFilesApproved(stage) ||
      this.isReviewFiles(stage) ||
      this.isRecollecting(stage)
    ) {
      return stage;
    }
    const raw = (status.statusName ?? "").toString().trim();
    const name = raw ? this.toTitleCaseSimple(raw) : "Incomplete";
    return `${stage || "Stage"} - ${name}`;
  }

  statusMetaClass(status: MessageStatus | undefined): string {
    switch (status) {
      case "not_delivered":
        return "text-warning";
      case "delivered":
        return "text-success";
      case "pending":
      case "sending":
        return "text-secondary";
      default:
        return "text-secondary";
    }
  }

  statusMetaIcon(status: MessageStatus | undefined): string {
    switch (status) {
      case "not_delivered":
        return "icon-alert-triangle";
      case "delivered":
        return "icon-check-circle";
      case "pending":
      case "sending":
        return "icon-refresh-cw";
      default:
        return "icon-message-circle";
    }
  }

  private refreshResolvedMessages(): void {
    const source: ApplicantMessage[] =
      Array.isArray(this.messages) && this.messages.length > 0
        ? (this.messages as ApplicantMessage[])
        : Array.isArray(this.applicant?.messages)
        ? (this.applicant!.messages as ApplicantMessage[])
        : [];

    this._resolvedMessages = source.map((msg, idx) => {
      const direction = (msg.direction ?? "inbound") as "inbound" | "outbound";
      // Replace {{ applicant.name }} with actual name if present in body
      let body = msg.body ?? "";
      // Interpolate any {{ ... }} placeholders using applicant fields (supports dotted paths)
      body = this.interpolateTemplate(body, {
        applicant: this.applicant || {},
      });
      // Determine sentAt and day label
      const anyMsg: any = msg as any;
      const sentAt = msg.sentAt ?? anyMsg.sent ?? anyMsg.created_at ?? null;
      let dayLabel = msg.dayLabel ?? "";
      if (!dayLabel && sentAt) {
        const dt = new Date(sentAt);
        if (!Number.isNaN(dt.getTime())) {
          dayLabel = new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          }).format(dt);
        }
      }
      // Avatar initial: prefer createdBy (from backend) then sender
      const createdBy = (msg.createdBy ?? null) as string | null;
      const sourceForInitial =
        createdBy && createdBy.trim() ? createdBy : msg.sender ?? "";
      const avatar =
        (msg.avatar ?? "").toString().trim() ||
        (sourceForInitial || "").slice(0, 1).toUpperCase();
      return {
        ...msg,
        id: msg.id ?? `msg-${idx}`,
        direction,
        sender: msg.sender ?? (direction === "outbound" ? "You" : "Whip"),
        body,
        timestamp: msg.timestamp ?? "",
        channel: msg.channel ?? "SMS",
        status: msg.status,
        statusLabel: msg.statusLabel ?? this.defaultStatusLabel(msg.status),
        automated: msg.automated ?? false,
        dayLabel,
        avatar,
      };
    });
  }

  // Simple template interpolation: replaces {{ path.to.value }} using values from ctx
  private interpolateTemplate(template: string, ctx: any): string {
    if (!template || typeof template !== "string") return template as any;
    return template.replace(/{{\s*([\w\.]+)\s*}}/g, (_match, path) => {
      const value = this.resolvePath(ctx, path);
      return value !== undefined && value !== null ? String(value) : "";
    });
  }

  private resolvePath(obj: any, path: string): any {
    try {
      if (!obj || !path) return undefined;
      const parts = path.split(".");
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
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_notes_crud,
      parameters: ["R", null, applicantId, null, null, null, null],
    };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: (res) => {
        if (!res.ok) {
          Utilities.showToast("Failed to load notes", "error");
          this.notes = [];
          return;
        }
        let raw: any = [];
        if (Array.isArray(res.data)) {
          const top = res.data as any[];
          if (top.length > 0 && Array.isArray(top[0])) raw = top[0];
          else raw = top;
        }
        this.notes = Array.isArray(raw) ? raw : [];
      },
      error: (err) => {
        console.error("[ApplicantPanel] loadNotes error", err);
        Utilities.showToast("Failed to load notes", "error");
        this.notes = [];
      },
      complete: () => {
        this.notesLoading = false;
      },
    });
  }

  onAddNote(ev: Event): void {
    ev.preventDefault();
    const text = (this.newNoteText ?? "").toString().trim();
    if (!text || !this.applicant || !this.applicant.id) return;
    this.notesSaving = true;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_notes_crud,
      parameters: [
        "C",
        null,
        this.applicant.id,
        text,
        1,
        this.authSession.user?.user || "system",
        null,
      ],
    };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: (res) => {
        if (!res.ok) {
          Utilities.showToast(
            String(res.error || "Failed to save note"),
            "error"
          );
          return;
        }
        Utilities.showToast("Note added", "success");
        this.newNoteText = "";
        // reload notes
        this.loadNotes(this.applicant.id);
      },
      error: (err) => {
        console.error("[ApplicantPanel] saveNote error", err);
        Utilities.showToast("Failed to save note", "error");
      },
      complete: () => {
        this.notesSaving = false;
      },
    });
  }

  copyToClipboard(text: string | null | undefined, key?: string): void {
    if (!text) return;
    const setFeedback = (k?: string) => {
      this.copyFeedbackKey = k ?? null;
      if (this._copyFeedbackTimer) {
        clearTimeout(this._copyFeedbackTimer);
        this._copyFeedbackTimer = null;
      }
      if (k)
        this._copyFeedbackTimer = setTimeout(() => {
          this.copyFeedbackKey = null;
          this._copyFeedbackTimer = null;
        }, 2000);
    };
    try {
      void navigator.clipboard.writeText(String(text)).then(
        () => setFeedback(key),
        () => setFeedback(undefined)
      );
    } catch (e) {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = String(text);
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setFeedback(key);
      } catch {
        setFeedback(undefined);
      }
      document.body.removeChild(ta);
    }
  }

  isEditingNote(n: any): boolean {
    return (
      this.editingNoteId !== null &&
      this.editingNoteId ===
        (n?.id || n?.id_note || n?.id_applicant_note || n?.id_note_applicant)
    );
  }

  startEditNote(n: any): void {
    this.editingNoteId =
      n?.id ??
      n?.id_note ??
      n?.id_applicant_note ??
      n?.id_note_applicant ??
      null;
    this.editingNoteText = n?.note ?? "";
  }

  cancelEdit(): void {
    this.editingNoteId = null;
    this.editingNoteText = "";
  }

  saveEditedNote(n: any): void {
    if (!this.applicant || !this.applicant.id) return;
    const noteId = this.editingNoteId;
    const text = (this.editingNoteText ?? "").toString().trim();
    if (!noteId || !text) {
      Utilities.showToast("Note must not be empty", "warning");
      return;
    }
    this.notesSaving = true;
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_notes_crud,
      parameters: [
        "U",
        noteId,
        this.applicant.id,
        text,
        1,
        this.authSession.user?.user || "system",
        null,
      ],
    };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: (res) => {
        if (!res.ok) {
          Utilities.showToast(
            String(res.error || "Failed to update note"),
            "error"
          );
          return;
        }
        Utilities.showToast("Note updated", "success");
        this.cancelEdit();
        if (this.applicant && this.applicant.id)
          this.loadNotes(this.applicant.id);
      },
      error: (err) => {
        console.error("[ApplicantPanel] updateNote error", err);
        Utilities.showToast("Failed to update note", "error");
      },
      complete: () => {
        this.notesSaving = false;
      },
    });
  }

  deleteNote(n: any): void {
    const noteId =
      n?.id ??
      n?.id_note ??
      n?.id_applicant_note ??
      n?.id_note_applicant ??
      null;
    if (!noteId) {
      Utilities.showToast("Note id not found", "warning");
      return;
    }
    void Swal.fire({
      title: "Delete note?",
      text: "This will remove the note permanently.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
      allowOutsideClick: false,
    }).then((result) => {
      if (!result.isConfirmed) return;
      this.notesSaving = true;
      const api: IDriveWhipCoreAPI = {
        commandName: DriveWhipAdminCommand.crm_applicants_notes_crud,
        parameters: [
          "D",
          noteId,
          this.applicant?.id ?? null,
          null,
          null,
          this.authSession.user?.user || "system",
          null,
        ],
      };
      this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
        next: (res) => {
          if (!res.ok) {
            Utilities.showToast(
              String(res.error || "Failed to delete note"),
              "error"
            );
            return;
          }
          Utilities.showToast("Note deleted", "success");
          if (this.applicant && this.applicant.id)
            this.loadNotes(this.applicant.id);
        },
        error: (err) => {
          console.error("[ApplicantPanel] deleteNote error", err);
          Utilities.showToast("Failed to delete note", "error");
        },
        complete: () => {
          this.notesSaving = false;
        },
      });
    });
  }

  /** Confirm with the user and then move applicant to a specific stage id */
  moveToStage(stageId: number | null, note?: string): void {
    if (!this.applicant || !this.applicant.id) {
      Utilities.showToast("Applicant id not found", "warning");
      return;
    }
    if (!stageId) {
      Utilities.showToast("Invalid target stage", "warning");
      return;
    }

    // Find stage name for nicer confirmation text
    const stage = this.stageMenuOptions.find(
      (s) => Number(s.id) === Number(stageId)
    );
    const stageName = stage?.name ?? "selected stage";
    const applicantName =
      (this.applicant?.name ?? "").toString() || "applicant";

    void Swal.fire({
      title: "Move applicant?",
      text: `Move ${applicantName} to ${stageName}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Move",
      cancelButtonText: "Cancel",
      allowOutsideClick: false,
    }).then((result) => {
      if (result.isConfirmed) {
        this.performMoveToStage(stageId, note);
      }
    });
  }

  /** Internal: perform the backend call to record the stage history */
  private performMoveToStage(stageId: number | null, note?: string): void {
    if (!this.applicant || !this.applicant.id) return;
    const movedBy = this.authSession.user?.user || "system";
    const params = [
      "C",
      null,
      this.applicant.id,
      stageId,
      null,
      note ?? null,
      movedBy,
      null,
    ];
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_applicants_stages_history_crud,
      parameters: params,
    };
    this.movingStage = true;
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: (res) => {
        if (!res.ok) {
          Utilities.showToast(
            String(res.error || "Failed to move applicant"),
            "error"
          );
          return;
        }
        Utilities.showToast("Applicant moved", "success");
        this.closeMenus();
        // reload notes/history for visibility
        if (this.applicant && this.applicant.id)
          this.loadNotes(this.applicant.id);
        // notify parent to refresh lists if needed
        this.stageMoved.emit({
          idApplicant: this.applicant.id,
          toStageId: Number(stageId),
        });
      },
      error: (err) => {
        console.error("[ApplicantPanel] performMoveToStage error", err);
        Utilities.showToast("Failed to move applicant", "error");
      },
      complete: () => {
        this.movingStage = false;
      },
    });
  }

  /** Move applicant to the next stage based on availableStages' sort order */
  moveToNextStage(): void {
    const options = (this.availableStages ?? [])
      .slice()
      .sort(
        (a, b) =>
          (a.sort_order ?? a.sortOrder ?? 0) -
          (b.sort_order ?? b.sortOrder ?? 0)
      );
    if (!options || options.length === 0) {
      Utilities.showToast("No stage options available", "warning");
      return;
    }
    const currentId = Number(
      this.currentStageId ??
        this.applicant?.stageId ??
        this.applicant?.raw?.id_stage ??
        this.applicant?.raw?.stage_id ??
        0
    );
    let idx = options.findIndex(
      (s: any) => Number(s.id_stage ?? s.id ?? s.idStage ?? 0) === currentId
    );
    if (idx < 0) idx = -1; // treat as before first
    const next = options[idx + 1] ?? null;
    if (!next) {
      Utilities.showToast("No next stage available", "info");
      return;
    }
    const nextId = Number(next.id_stage ?? next.id ?? next.idStage ?? 0);
    this.moveToStage(nextId);
  }

  /** Move applicant to Rejected stage if present (by name 'Rejected' case-insensitive) */
  rejectApplicant(): void {
    const options = this.availableStages ?? [];
    const rejected =
      options.find(
        (s: any) => String(s.name || "").toLowerCase() === "rejected"
      ) ||
      options.find((s: any) =>
        String(s.name || "")
          .toLowerCase()
          .includes("reject")
      );
    if (!rejected) {
      Utilities.showToast("No Rejected stage configured", "warning");
      return;
    }
    const rid = Number(
      rejected.id_stage ?? rejected.id ?? rejected.idStage ?? 0
    );
    this.moveToStage(rid);
  }

  // Wrapper to invoke move with permission check so confirmation modal always runs when allowed
  onStageClick(stageId: number | null): void {
    // close menus immediately for a snappy feel and to prevent overlay interference
    this.closeMenus();
    if (!this.canMove()) {
      Utilities.showToast(
        "You do not have permission to move applicants",
        "warning"
      );
      return;
    }
    this.moveToStage(stageId);
  }

  onMoveNextClick(): void {
    if (!this.canMove()) {
      Utilities.showToast(
        "You do not have permission to move applicants",
        "warning"
      );
      return;
    }
    this.moveToNextStage();
  }

  onRejectClick(): void {
    if (!this.canMove()) {
      Utilities.showToast(
        "You do not have permission to move applicants",
        "warning"
      );
      return;
    }
    this.rejectApplicant();
  }

  /** Confirm and approve the applicant as Driver (calls REST DriverOnboarding endpoint) */
  approveAsDriver(): void {
    this.closeMenus();
    // Resolve applicant id robustly
    const id = ((): string | null => {
      const direct = this.applicantId ?? this.applicant?.id ?? null;
      if (direct) return String(direct);
      const a: any = this.applicant || {};
      const candidates = [
        a.id_applicant,
        a.ID_APPLICANT,
        a.IdApplicant,
        a.idApplicant,
        a.applicantId,
        a.applicant_id,
        a.id,
        a.ID,
        a.Id,
        a.uuid,
        a.guid,
      ];
      const found = candidates.find(
        (v: any) => v !== null && v !== undefined && v !== ""
      );
      return found !== undefined ? String(found) : null;
    })();
    if (!id) {
      Utilities.showToast("Applicant id not found", "warning");
      return;
    }

    void Swal.fire({
      title: "Approve as Driver?",
      text: "Are you sure you want to approve this applicant as a Driver?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, approve",
      cancelButtonText: "Cancel",
      focusCancel: true,
      reverseButtons: true,
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !Swal.isLoading(),
      preConfirm: async () => {
        try {
          const res = await firstValueFrom(
            this.core.driverOnboarding(String(id))
          );
          // If backend uses a wrapped response with ok=false, surface as error
          if (res && (res as any).ok === false) {
            const msg = ((res as any).error || "Failed to approve").toString();
            throw new Error(msg);
          }
          return res;
        } catch (err: any) {
          Swal.showValidationMessage(
            (err?.message || "Request failed").toString()
          );
          throw err;
        }
      },
    }).then((result) => {
      if (result.isConfirmed) {
        Utilities.showToast("Applicant approved as Driver", "success");
        // Ask parent views to refresh stages and grid
        try {
          const toStageId = this.currentStageIdNum ?? 0;
          this.stageMoved.emit({ idApplicant: String(id), toStageId });
        } catch {}
        // Optionally refresh this panel's applicant info
        try {
          if (id) {
            this.loadApplicantDetails(String(id));
          }
        } catch {}
      }
    });
  }

  private defaultStatusLabel(
    status: MessageStatus | undefined
  ): string | undefined {
    switch (status) {
      case "not_delivered":
        return "Not delivered";
      case "delivered":
        return "Delivered";
      case "pending":
        return "Pending";
      case "sending":
        return "Sending";
      default:
        return undefined;
    }
  }
}

interface MessageTemplateSummary {
  id: string | number | null;
  description: string;
  subject: string | null;
  content: string;
  rawBody: string;
  type: string | null;
  code: string | null;
  dataKey: string | null;
  channel: string | null;
  preview: string;
}

interface ApplicantStatus {
  stage: string;
  statusName: string;
  isComplete: boolean;
}

type MessageStatus =
  | "delivered"
  | "not_delivered"
  | "pending"
  | "sending"
  | undefined;

interface ApplicantMessage {
  id?: string;
  direction?: "inbound" | "outbound";
  sender?: string;
  body?: string;
  timestamp?: string;
  channel?: string;
  status?: MessageStatus;
  statusLabel?: string;
  automated?: boolean;
  dayLabel?: string;
  avatar?: string;
  // extra metadata used for grouping and avatar resolution
  sentAt?: any;
  createdBy?: string | null;
  /** transient: highlight new socket messages */
  __isNew?: boolean;
}

interface StageMenuOption {
  id: number;
  name: string;
  type: string;
}

interface StageMenuViewOption extends StageMenuOption {
  typeLabel: string;
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
