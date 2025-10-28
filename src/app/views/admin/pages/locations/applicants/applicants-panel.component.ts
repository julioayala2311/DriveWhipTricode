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
import Swal from "sweetalert2";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
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

@Component({
  selector: "app-applicant-panel",
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  private authSession = inject(AuthSessionService);
  private sanitizer = inject(DomSanitizer);
  private smsRealtime = inject(SmsChatSignalRService);
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

  // SMS composer sidebar state
  smsSidebarOpen = false;
  smsFrom: string = "";
  smsTo: string = "";
  smsMessage: string = "";
  smsDelay = false;
  smsSending = false;

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

  employmentProfileSnapshot: string = '{"id":"61192fe2-c13d-3e6b-b28e-1155147845a2","account":"019a0b0b-62a0-25bd-5102-11b4d292a7e8","address":{"city":null,"line1":null,"line2":null,"state":null,"country":"SV","postal_code":null},"first_name":"Juan","last_name":"Zamora","full_name":"Juan Zamora","birth_date":null,"email":"zamora125@hotmail.com","phone_number":"+50377461468","picture_url":"https://api.argyle.com/v2/payroll-documents/019a0b0e-9a2c-eca8-a5b6-a2d9c921e31c/file","employment_status":null,"employment_type":"contractor","job_title":"Driver","ssn":null,"marital_status":null,"gender":null,"hire_date":"2020-04-04","original_hire_date":"2020-04-04","termination_date":null,"termination_reason":null,"employer":"uber","base_pay":{"amount":null,"period":null,"currency":null},"pay_cycle":null,"platform_ids":{"employee_id":null,"position_id":null,"platform_user_id":null},"created_at":"2025-10-22T08:34:57.708Z","updated_at":"2025-10-22T08:34:57.708Z","metadata":{"driverStatus":"scanner_common.data.MissingT","raw_employment_type":"Contractor"},"employment":"8675e413-ef4f-3ea0-8f4f-008128c81d47"}'; 

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
    const found = (this.moveToStageOptions || []).find((st) => Number(st.id) === sid);
    return found?.name || "";
  }

  // Open SMS composer using iPhone preview
  openSmsSidebar(): void {
    this.closeMenus();
    if (this.eventSidebarOpen) this.closeEventSidebar();
    if (this.emailSidebarOpen) this.closeEmailSidebar();

    const to = this.getApplicantPhone(this.applicant) || "";
    const defaultFrom = "8774142766";
    this.smsFrom = defaultFrom;
    this.smsTo = to;
    this.smsMessage = "";
    this.smsDelay = false;
    this.smsSidebarOpen = true;
  }

  closeSmsSidebar(): void {
    this.smsSidebarOpen = false;
  }

  viewEmploymentSummary(): void {
    if (!this.employmentProfileSnapshot) {
      Swal.fire({
        icon: "info",
        title: "Argyle Information",
        text: "Argyle information are not available for this applicant.",
        confirmButtonText: "Close",
      });
      return;
    }

    const html = this.buildEmploymentDetailsMarkup(
      JSON.parse(this.employmentProfileSnapshot)
    );
    Swal.fire({
      title: "Argyle Information",
      html,
      width: 800,
      customClass: { popup: "employment-profile-popup" },
      showCloseButton: true,
      focusConfirm: false,
      confirmButtonText: "Close",
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

  sendSms(): void {
    const text = (this.smsMessage || "").trim();
    const id = this.resolveApplicantId(this.applicant) || this.applicantId;
    const to = (this.smsTo || "").trim();
    const from = (this.smsFrom || "").trim();
    if (!text || !id || !to || !from || this.smsSending) return;

    // Optimistic add to chat stream if visible
    const optimistic: ApplicantMessage = {
      id: "temp-sms-" + Date.now(),
      direction: "outbound",
      sender: "You",
      body: text,
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

    this.smsSending = true;
    this.core
      .sendChatSms({ from, to, message: text, id_applicant: String(id) })
      .subscribe({
        next: (_res) => {
          // Mark optimistic as delivered and close sidebar
          try {
            this.markOptimisticDelivered(optimistic.id || "");
          } catch {}
          this.closeSmsSidebar();
        },
        error: (_err) => {
          // Remove optimistic and surface an error toast via history or simply keep message with not_delivered
          try {
            this.removeOptimistic(optimistic.id || "");
          } catch {}
        },
        complete: () => {
          this.smsSending = false;
        },
      });
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
  resendLastMessage(): void {
    if (!this.canResendMessage()) return;
    this.closeMenus();

    const id = this.resolveApplicantId(this.applicant) || this.applicantId;
    const to = (this.getApplicantPhone(this.applicant) || "").trim();
    const from = (this.smsFrom || "8774142766").trim();
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
    const text = (last?.body || "").toString().trim();
    if (!text) {
      Utilities.showToast("No outbound SMS found to resend", "info");
      return;
    }

    // Optimistic append
    const optimistic: ApplicantMessage = {
      id: "temp-resend-" + Date.now(),
      direction: "outbound",
      sender: "You",
      body: text,
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

    this.core
      .sendChatSms({ from, to, message: text, id_applicant: String(id) })
      .subscribe({
        next: () => {
          try {
            this.markOptimisticDelivered(optimistic.id || "");
          } catch {}
          Utilities.showToast("Message resent", "success");
        },
        error: () => {
          try {
            this.removeOptimistic(optimistic.id || "");
          } catch {}
          Utilities.showToast("Failed to resend message", "error");
        },
      });
  }

  // Permission helpers - assumptions:
  // - authSession.user?.roles is an array of role strings (e.g. ['admin','reviewer']).
  // If your app uses a different shape, adjust hasRole/hasAnyRole accordingly.
  private userRoles(): string[] {
    const u: any = (this.authSession as any).user;
    // console.debug(u, 'datos de usuario');
    if (!u) return [];
    // Prefer an explicit roles array
    if (Array.isArray(u.roles) && u.roles.length > 0)
      return u.roles.map((r: any) => String(r));
    // Fallback to a single-string role property
    if (typeof u.role === "string" && u.role.trim() !== "")
      return [u.role.trim()];
    // Some sessions provide `roles` as a comma-separated string or `role` claim in the token.
    if (typeof u.roles === "string" && u.roles.trim() !== "") {
      return u.roles
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    // Try to parse JWT token payload (if present) to extract claims like `role` or `roles`
    try {
      const token = (u.token ?? (this.authSession as any).token) as
        | string
        | undefined;
      if (token && typeof token === "string") {
        const parts = token.split(".");
        if (parts.length >= 2) {
          const payload = JSON.parse(atob(parts[1]));
          if (payload) {
            if (Array.isArray(payload.roles) && payload.roles.length > 0)
              return payload.roles.map((r: any) => String(r));
            if (typeof payload.role === "string" && payload.role.trim() !== "")
              return [payload.role.trim()];
            if (
              typeof payload.roles === "string" &&
              payload.roles.trim() !== ""
            )
              return payload.roles
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean);
          }
        }
      }
    } catch (e) {
      // ignore parse errors
    }
    return [];
  }

  private hasAnyRole(roles: string[]): boolean {
    const ur = this.userRoles().map((r: string) =>
      (r || "").toString().toLowerCase()
    );
    return roles.some((rr) => ur.includes(rr.toLowerCase()));
  }

  canMove(): boolean {
    return this.hasAnyRole(["ADMIN", "Administrator", "reviewer"]);
  }
  canEditNotes(): boolean {
    return this.hasAnyRole(["ADMIN", "Administrator", "reviewer"]);
  }
  canDeleteNotes(): boolean {
    return this.hasAnyRole(["ADMIN", "Administrator"]);
  }
  canEditApplicant(): boolean {
    return this.hasAnyRole(["ADMIN", "Administrator", "reviewer"]);
  }
  canDeleteApplicant(): boolean {
    return this.hasAnyRole(["ADMIN", "Administrator"]);
  }
  // Note editing state
  private editingNoteId: any = null;
  editingNoteText: string = "";
  // Applicant editing state
  isEditingApplicant: boolean = false;
  editableApplicant: any = {};
  applicantSaving: boolean = false;
  applicantDeleting: boolean = false;

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
    // close menu when editing begins
    this.closeMenus();
  }

  cancelEditApplicant(): void {
    this.isEditingApplicant = false;
    this.editableApplicant = this.applicant ? { ...this.applicant } : {};
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
      this.updateRealtimeSubscription(id);
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
      if (this.activeTab === "files" && id) {
        this.loadApplicantDocuments(id);
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
        this.loadApplicantDocuments(id);
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
    this.realtimeSub = this.smsRealtime
      .messages()
      .subscribe((msg) => this.handleRealtimeMessage(msg));
    // use capture phase to avoid being canceled by stopPropagation on inner handlers
    document.addEventListener("click", this._outsideClickListener, true);
  }

  ngOnDestroy(): void {
    if (this.realtimeSub) {
      this.realtimeSub.unsubscribe();
      this.realtimeSub = null;
    }
    if (this.currentRealtimeApplicantId) {
      this.smsRealtime.leaveApplicant(this.currentRealtimeApplicantId).catch(() => {});
      this.currentRealtimeApplicantId = null;
    }
    // Leave phone-pair group if joined
    if (this.currentRealtimePhonePairKey) {
      const [a, b] = this.currentRealtimePhonePairKey.split("|");
      if (a && b) {
        (this.smsRealtime as any).leavePhonePair?.(a, b)?.catch?.(() => {});
      }
      this.currentRealtimePhonePairKey = null;
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
    this.emailSidebarOpen = true;
    setTimeout(() => this.syncEmailEditorFromContent(), 0);
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
    if (this.moveToLocationId) this.loadWorkflowsForLocation(this.moveToLocationId);
  }

  onMoveToStageChange(raw: any): void {
    const id = Number(raw);
    this.moveToStageId = Number.isFinite(id) && id > 0 ? id : null;
  }

  private ensureMoveToLocations(): void {
    if (this.moveToLocationsLoading || this.moveToLocationOptions.length) return;
    this.moveToLocationsLoading = true;
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_locations_dropdown, parameters: [] } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        this.moveToLocationsLoading = false;
        try {
          let rows: any[] = [];
          if (res.ok && Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
          const mapped = (rows || []).map(r => ({
            id: Number(r.id_location ?? r.ID_LOCATION ?? r.id ?? r.value),
            name: String(r.name ?? r.NAME ?? r.label ?? r.LABEL ?? '')
          })).filter(x => Number.isFinite(x.id) && x.name);
          mapped.sort((a,b)=> a.name.localeCompare(b.name));
          this.moveToLocationOptions = mapped;
          // preselect current by name if possible
          const currentLocName = (this.locationName || '').trim().toLowerCase();
          const preset = mapped.find(m => m.name.trim().toLowerCase() === currentLocName);
          if (preset) {
            this.moveToLocationId = preset.id;
            this.loadWorkflowsForLocation(preset.id);
          }
        } catch (e) {
          this.moveToError = 'Failed to parse locations list';
        }
      },
      error: () => {
        this.moveToLocationsLoading = false;
        this.moveToError = 'Failed to load locations';
      }
    });
  }

  private loadWorkflowsForLocation(locationId: number): void {
    if (!locationId) return;
    this.moveToWorkflowsLoading = true;
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_workflows_list, parameters: [] } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        this.moveToWorkflowsLoading = false;
        try {
          let rows: any[] = [];
          if (res.ok && Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
          const filtered = (rows || []).filter(r => Number(r.id_location ?? r.ID_LOCATION ?? 0) === Number(locationId));
          const wf = filtered[0];
          this.moveToWorkflowId = wf ? Number(wf.id_workflow ?? wf.ID_WORKFLOW ?? wf.id) : null;
          if (this.moveToWorkflowId) this.loadStagesForWorkflow(this.moveToWorkflowId);
          else this.moveToStageOptions = [];
        } catch {
          this.moveToError = 'Failed to parse workflows list';
        }
      },
      error: () => {
        this.moveToWorkflowsLoading = false;
        this.moveToError = 'Failed to load workflows';
      }
    });
  }

  private loadStagesForWorkflow(workflowId: number): void {
    if (!workflowId) return;
    this.moveToStagesLoading = true;
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_list, parameters: [workflowId] } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        this.moveToStagesLoading = false;
        try {
          let rows: any[] = [];
          if (res.ok && Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
          const mapped = (rows || []).map(r => ({ id: Number(r.id_stage ?? r.ID_STAGE ?? r.id), name: String(r.name ?? r.stage_name ?? r.NAME ?? '') }))
            .filter(x => Number.isFinite(x.id) && x.name)
            .sort((a,b)=> a.name.localeCompare(b.name));
          this.moveToStageOptions = mapped;
          const currentId = this.currentStageIdNum;
          if (currentId != null && mapped.some(m => m.id === currentId)) this.moveToStageId = currentId;
          else this.moveToStageId = mapped.length ? mapped[0].id : null;
        } catch {
          this.moveToError = 'Failed to parse stages list';
        }
      },
      error: () => {
        this.moveToStagesLoading = false;
        this.moveToError = 'Failed to load stages';
      }
    });
  }

  submitMoveTo(): void {
    if (this.moveToSaving) return;
    const applId = this.resolveApplicantId(this.applicant) || this.applicantId;
    if (!this.moveToLocationId || !this.moveToStageId || !applId) {
      this.moveToError = 'Select a location and stage';
      return;
    }
    const user = this.currentUserIdentifier();
    // SP signature: (p_id_location, p_id_stage, p_id_applicant, p_user)
    const params: any[] = [ this.moveToLocationId, this.moveToStageId, applId, user ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_applicants_moveto_new, parameters: params } as any;
    this.moveToSaving = true;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        this.moveToSaving = false;
        if (!res.ok) {
          this.moveToError = String(res.error || 'Failed to move applicant');
          Utilities.showToast(this.moveToError, 'error');
          return;
        }
        Utilities.showToast('Applicant moved', 'success');
        this.moveToOpen = false;
        if (applId && this.moveToStageId) this.stageMoved.emit({ idApplicant: String(applId), toStageId: Number(this.moveToStageId) });
      },
      error: () => {
        this.moveToSaving = false;
        this.moveToError = 'Failed to move applicant';
        Utilities.showToast(this.moveToError, 'error');
      }
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
    this.emailContent = el?.innerHTML || "";
  }

  get emailPreviewHtml(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.emailContent || "");
  }

  private captureEmailContentFromEditor(): void {
    const editor = this.emailEditorRef?.nativeElement;
    if (!editor) return;
    this.emailContent = editor.innerHTML || "";
  }

  private syncEmailEditorFromContent(): void {
    if (this.emailSourceMode) return;
    const editor = this.emailEditorRef?.nativeElement;
    if (!editor) return;
    editor.innerHTML = this.emailContent || "";
  }

  setEmailPreviewMode(mode: "desktop" | "mobile"): void {
    this.emailPreviewMode = mode;
  }

  // Placeholder send handler (wire to backend when available)
  sendEmail(): void {
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

    this.emailSending = true;
    this.core
      .sendTemplateEmail({ title, message, templateId, to: [to] })
      .subscribe({
        next: () => {
          this.emailSending = false;
          this.closeEmailSidebar();
          Utilities.showToast("Email sent", "success");
        },
        error: () => {
          this.emailSending = false;
          Utilities.showToast("Failed to send email", "error");
        },
      });
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

  /** Submit and send an SMS chat message via API, then reload chat history */
  onSendMessage(ev: Event): void {
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
    // Optimistic message so user sees it immediately
    const optimistic: ApplicantMessage = {
      id: "temp-" + Date.now(),
      direction: "outbound",
      sender: "You",
      body: text,
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

    this.chatSending = true;
    const fromNumber = "8774142766";
    this.core
      .sendChatSms({
        from: fromNumber,
        to,
        message: text,
        id_applicant: String(id),
      })
      .subscribe({
        next: (_res) => {
          // Clear composer, mark optimistic as delivered and refresh history (force) after a tiny delay
          this.draftMessage = "";
          this.markOptimisticDelivered(optimistic.id!);
          this.scrollMessagesToBottomSoon();
          setTimeout(() => {
            this.loadChatHistory(String(id), 1, true);
            // extra cleanup shortly after to catch late-arriving persistence
            setTimeout(() => {
              try {
                const outboundBodies = new Set(
                  (this.messages || [])
                    .filter(
                      (m) =>
                        (m.id || "").toString().startsWith("temp-") === false &&
                        m.direction === "outbound"
                    )
                    .map((m) => (m.body || "").toString().trim())
                );
                this.messages = (this.messages || []).filter(
                  (m) =>
                    !(
                      (m.id || "").toString().startsWith("temp-") &&
                      outboundBodies.has((m.body || "").toString().trim())
                    )
                );
                this.refreshResolvedMessages();
              } catch {}
            }, 400);
          }, 350);
          Utilities.showToast("Message sent", "success");
        },
        error: (err) => {
          console.error("[ApplicantPanel] sendChatSms error", err);
          Utilities.showToast("Failed to send message", "error");
          this.removeOptimistic(optimistic.id!);
        },
        complete: () => {
          this.chatSending = false;
        },
      });
  }

  private updateRealtimeSubscription(applicantId: string | null): void {
    const normalized = this.normalizeApplicantIdValue(applicantId);
    if (normalized === this.currentRealtimeApplicantId) {
      // Even if applicantId didn't change, ensure phone-pair subscription is up-to-date
      this.updatePhonePairSubscription();
      return;
    }

    const previous = this.currentRealtimeApplicantId;
    this.currentRealtimeApplicantId = normalized;

    if (previous) {
      this.smsRealtime.leaveApplicant(previous).catch((err) => {
        console.debug("[ApplicantPanel] leaveApplicant", previous, err);
      });
    }

    if (normalized) {
      this.smsRealtime.joinApplicant(normalized).then(() => {
        console.debug("[ApplicantPanel] joinApplicant", normalized);
      }).catch((err) => {
        console.debug("[ApplicantPanel] joinApplicant error", normalized, err);
      });
    }

    // Also (re)join phone-pair group based on current applicant phone and active From number
    this.updatePhonePairSubscription();
  }

  private normalizeApplicantIdValue(value: string | null | undefined): string | null {
    const str = (value ?? "").toString().trim();
    return str ? str.toLowerCase() : null;
  }

  private handleRealtimeMessage(evt: ApplicantChatRealtimeMessage): void {
    if (!evt) return;
    const activeId = this.resolveApplicantId(this.applicant) || this.applicantId;
    const normalizedActive = this.normalizeApplicantIdValue(activeId);
    // We attempt two matching strategies: applicantId first, then phone-pair fallback
    let accept = false;
    if (normalizedActive) {
      const incomingId = this.normalizeApplicantIdValue(evt.applicantId);
      if (incomingId && incomingId === normalizedActive) {
        accept = true;
      }
    }
    if (!accept) {
      // Fallback: match by normalized phone pair (order-insensitive)
      if (this.matchesCurrentPhonePair(evt)) {
        accept = true;
      }
    }
    if (!accept) return;

    const body = (evt.body || "").toString();
    if (!body.trim()) return;

    const candidateId = evt.chatId != null
      ? String(evt.chatId)
      : evt.messageSid
      ? `sid-${evt.messageSid}`
      : null;

    if (candidateId) {
      const duplicate = (this.messages || []).some(
        (m) => (m.id || "").toString() === candidateId
      );
      if (duplicate) {
        return;
      }
    }

    const direction: "inbound" | "outbound" =
      (evt.direction || "").toLowerCase() === "outbound" ? "outbound" : "inbound";
    const sentSource = evt.sentAtUtc || evt.createdAtUtc || new Date().toISOString();
    const sentDate = new Date(sentSource);
    const timestampLabel = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(Number.isNaN(sentDate.getTime()) ? new Date() : sentDate);

    const status: MessageStatus | undefined =
      direction === "outbound" ? "delivered" : undefined;

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
      dayLabel: "",
      sentAt: sentSource,
      createdBy: direction === "outbound" ? this.authSession.user?.user || null : null,
    };

    const base = this.messages ?? [];
    this.messages = [...base, message];
    this.refreshResolvedMessages();
    this.scrollMessagesToBottomSoon();

    if (this.realtimeRefreshTimer) {
      clearTimeout(this.realtimeRefreshTimer);
    }
    const applicantKey = (activeId || "").toString();
    if (applicantKey) {
      this.realtimeRefreshTimer = setTimeout(() => {
        this.loadChatHistory(applicantKey, 1, true);
        this.realtimeRefreshTimer = null;
      }, 800);
    }
  }

  // --- Realtime by phone-pair (fallback when applicantId is missing) ---
  private currentRealtimePhonePairKey: string | null = null;

  private defaultSmsFromNumber(): string {
    // Keep in sync with openSmsSidebar/resend logic
    return "8774142766";
  }

  private normalizePhone(raw?: string | null): string | null {
    const v = (raw || "").trim();
    if (!v) return null;
    // Strict E.164-ish normalization: collapse to digits and ensure single leading '+'
    const digits = v.split("").filter((ch) => /\d/.test(ch)).join("");
    if (!digits) return null;
    return `+${digits}`;
  }

  private normalizedPairKey(a?: string | null, b?: string | null): string | null {
    const na = this.normalizePhone(a);
    const nb = this.normalizePhone(b);
    if (!na || !nb) return null;
    return na <= nb ? `${na}|${nb}` : `${nb}|${na}`;
    }

  private updatePhonePairSubscription(): void {
    try {
      const to = this.getApplicantPhone(this.applicant) || this.smsTo || null;
      const from = this.smsFrom || this.defaultSmsFromNumber();
      const key = this.normalizedPairKey(from, to);
      if (!key) {
        // Leave previous if any
        if (this.currentRealtimePhonePairKey) {
          const [pa, pb] = this.currentRealtimePhonePairKey.split("|");
          if (pa && pb) (this.smsRealtime as any).leavePhonePair?.(pa, pb)?.then?.(() => {
            console.debug('[ApplicantPanel] leavePhonePair', this.currentRealtimePhonePairKey, 'group=smspair:' + this.currentRealtimePhonePairKey);
          })?.catch?.((e: unknown) => console.debug('[ApplicantPanel] leavePhonePair error', e));
          this.currentRealtimePhonePairKey = null;
        }
        return;
      }
      if (key === this.currentRealtimePhonePairKey) return;
      // Leave previous first
      if (this.currentRealtimePhonePairKey) {
        const [pa, pb] = this.currentRealtimePhonePairKey.split("|");
        if (pa && pb) (this.smsRealtime as any).leavePhonePair?.(pa, pb)?.then?.(() => {
          console.debug('[ApplicantPanel] leavePhonePair', this.currentRealtimePhonePairKey, 'group=smspair:' + this.currentRealtimePhonePairKey);
        })?.catch?.((e: unknown) => console.debug('[ApplicantPanel] leavePhonePair error', e));
      }
      const [a, b] = key.split("|");
      // Log the smspair group name and attempt to join it. Use the service's joinPhonePair (may be cast to any).
      (this.smsRealtime as any)
        .joinPhonePair?.(a, b)
        ?.then?.(() => {
          this.currentRealtimePhonePairKey = key;
          console.debug('[ApplicantPanel] joinPhonePair', key, 'group=smspair:' + key);
          // If debug helpers are available on the service, show subscription state
          try {
            const subscribed = (this.smsRealtime as any).isSubscribedToPhonePair?.(a, b) ?? null;
            console.debug('[ApplicantPanel] subscribedToPhonePair', subscribed, 'joinedPhonePairs=', (this.smsRealtime as any).getJoinedPhonePairs?.() ?? null);
          } catch (e) {
            console.debug('[ApplicantPanel] subscription inspect error', e);
          }
        })
        ?.catch?.((err: unknown) => console.debug("[ApplicantPanel] joinPhonePair error", err));
    } catch (e) {
      console.debug("[ApplicantPanel] updatePhonePairSubscription error", e);
    }
  }

  private matchesCurrentPhonePair(evt: ApplicantChatRealtimeMessage): boolean {
    try {
      if (!evt) return false;
      const to = this.getApplicantPhone(this.applicant) || this.smsTo || null;
      const from = this.smsFrom || this.defaultSmsFromNumber();
      const activeKey = this.normalizedPairKey(from, to);
      if (!activeKey) return false;
      const evtKey = this.normalizedPairKey(evt.from, evt.to);
      console.debug('[ApplicantPanel] match phonePair?', { activeKey, evtKey, meta: (evt as any)?.metadata });
      return !!evtKey && evtKey === activeKey;
    } catch {
      return false;
    }
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
      console.log('Finished processing event:', detailText);
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

  // Simple HTML escaper for modal content
  private escapeHtml(input: any): string {
    if (input === null || input === undefined) return "";
    const s = input.toString();
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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
  private loadApplicantDocuments(applicantId: string): void {
    if (!applicantId) return;
    if (
      this.docsLoadedForApplicantId === applicantId &&
      this.documentGroups &&
      this.documentGroups.length
    )
      return;
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
      this.scrollMessagesToBottomSoon();
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
        this.scrollMessagesToBottomSoon();
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

  /** Open the in-app image viewer for the selected group/doc (falls back to openDocument for non-images) */
  openImageViewer(
    group: DocumentGroup,
    doc?: ApplicantDocument,
    ev?: Event
  ): void {
    try {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
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
    this.recollectContent = el.innerHTML;
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
    this.recollectContent = val || "";
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
      this.applyRecollectTemplate("");
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

      let html = "";
      if (res?.ok) {
        let raw: any = res.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const row = Array.isArray(raw) && raw.length ? raw[0] : raw;
        html = String(row?.message ?? row?.MESSAGE ?? "") || "";
      }

      if (!html) {
        this.applyRecollectTemplate("");
        this.recollectTemplateError = "Template message not available";
        Utilities.showToast(
          "No template message configured for this option.",
          "warning"
        );
      } else {
        this.applyRecollectTemplate(html);
      }
    } catch (err) {
      if (token !== this._recollectTemplateToken) {
        return;
      }
      console.error(
        "[ApplicantPanel] loadRecollectTemplateForSelection error",
        err
      );
      this.recollectTemplateError = "Failed to load re-collect message";
      this.applyRecollectTemplate("");
      Utilities.showToast("Unable to load the re-collect message.", "error");
    } finally {
      if (token === this._recollectTemplateToken) {
        this.recollectTemplateLoading = false;
      }
    }
  }

  private applyRecollectTemplate(html: string): void {
    const normalized = html || "";
    this.recollectContent = normalized;
    const plain = this.htmlToSmsText(normalized).slice(0, 1000);
    this.disapproveMessage = plain;
    if (this.recollectSourceMode) {
      // textarea binding updates automatically in source mode
      return;
    }
    this.syncRecollectEditorFromContent();
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
          try {
            await firstValueFrom(
              this.core.sendTemplateEmail({
                title: subject,
                message: emailHtml,
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
        smsText = (smsText || "").trim().slice(0, 1000);
        const from = "8774142766";
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
          Utilities.showToast("Failed to send SMS", "error");
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

  /** Ensure recollect reason options are loaded (from crm_applicants_recollect_options) */
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
      commandName:
        DriveWhipAdminCommand.crm_applicants_recollect_options as any,
      parameters: [],
    } as any;
    this.core.executeCommand<DriveWhipCommandResponse<any>>(api).subscribe({
      next: (res) => {
        let raw: any = res?.data;
        if (Array.isArray(raw)) raw = Array.isArray(raw[0]) ? raw[0] : raw;
        const rows = Array.isArray(raw) ? raw : [];
        const items: Array<{ code: string; description: string }> = [];
        const map: Record<string, string> = {};
        for (const r of rows) {
          // SP returns: option (event code), description (label)
          const code = String(
            r.option ?? r.OPTION ?? r.event ?? r.EVENT ?? r.code ?? r.CODE ?? ""
          ).trim();
          const description = String(
            r.description ?? r.DESCRIPTION ?? code
          ).trim();
          if (!code || !description) continue;
          if (!map[code]) {
            map[code] = description;
            items.push({ code, description });
          }
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
          this.loadApplicantDocuments(String(id));
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

  docStatusClass(doc: ApplicantDocument): string {
    const s = (doc.status || "").toString().toUpperCase();
    if (s === "APPROVED") return "text-success";
    if (s === "DISAPPROVED") return "text-danger";
    if (
      s === "RECOLLECTING" ||
      s === "RE-COLLECTING" ||
      s === "RE-COLLECTING FILE"
    )
      return "text-warning";
    return "text-secondary";
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
    this.applicant = { ...this.applicant, ...normalized };
    this.editableApplicant = { ...this.applicant };
  }

  private normalizeApplicantRecord(record: any): any {
    const firstName = this.coalesce(
      record.first_name,
      record.FIRST_NAME,
      record.firstName,
      ""
    );
    const lastName = this.coalesce(
      record.last_name,
      record.LAST_NAME,
      record.lastName,
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
        (record.go_to_driver ?? (record.GO_TO_DRIVER as any)) ?? false
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
    const v = (this.applicant as any)?.go_to_driver ?? (this.applicant as any)?.GO_TO_DRIVER;
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

  // Normalize currentStageId to a number when possible for safe comparisons in template
  get currentStageIdNum(): number | null {
    const v: any = this.currentStageId;
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  statusBadgeClass(status: ApplicantStatus | null | undefined): string {
    if (!status) {
      return "bg-secondary-subtle text-secondary";
    }
    return status.isComplete
      ? "bg-success-subtle text-success"
      : "bg-primary-subtle text-primary";
  }

  statusBadgeIcon(status: ApplicantStatus | null | undefined): string {
    if (!status) return "icon-shield";
    return status.isComplete ? "icon-check-circle" : "icon-shield";
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
