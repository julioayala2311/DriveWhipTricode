import { CommonModule } from "@angular/common";
import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
  ViewEncapsulation,
  inject,
} from "@angular/core";
import { ICellRendererAngularComp } from "ag-grid-angular";
import { ICellRendererParams } from "ag-grid-community";
import { Overlay, OverlayModule, OverlayRef, ConnectionPositionPair, FlexibleConnectedPositionStrategy } from "@angular/cdk/overlay";
import { PortalModule, TemplatePortal } from "@angular/cdk/portal";
import { AuthSessionService } from "../../../../../core/services/auth/auth-session.service";
import {
  RoutePermissionAction,
  RoutePermissionService,
} from "../../../../../core/services/auth/route-permission.service";

export type ApplicantQuickAction =
  | "openPanel"
  | "sendEmail"
  | "sendSms"
  | "resendSms"
  | "moveToModal"
  | "moveNext"
  | "moveToStage"
  | "reject"
  | "approveDriver"
  | "editApplicant"
  | "deleteApplicant";

interface RendererParams extends ICellRendererParams {
  context: {
    componentParent?: {
      handleQuickAction?: (
        applicant: any,
        action: ApplicantQuickAction,
        payload?: any
      ) => void;
      canResendQuickAction?: (applicant: any) => boolean;
    };
  };
}

interface StageMenuViewOption {
  id: number;
  name: string;
  type: string;
  typeLabel: string;
}

@Component({
  selector: "app-applicant-actions-cell",
  standalone: true,
  imports: [CommonModule, OverlayModule, PortalModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="actions-cell" (click)="$event.stopPropagation()">
      <button
        type="button"
        class="btn btn-link btn-sm px-1"
        (click)="toggle($event)"
        aria-label="More actions"
        #trigger
      >
        <i class="feather icon-more-vertical"></i>
      </button>

      <ng-template #menuTemplate>
        <div class="actions-menu" role="menu" (click)="$event.stopPropagation()">
          <div class="menu-section">
            <button
              type="button"
              class="menu-item"
              (click)="fire('sendEmail', $event)"
            >
              <span class="icon"><i class="feather icon-mail"></i></span>
              <span>Send Email</span>
            </button>
            <button
              type="button"
              class="menu-item"
              (click)="fire('sendSms', $event)"
            >
              <span class="icon"><i class="feather icon-smartphone"></i></span>
              <span>Send Text/SMS</span>
            </button>
            <!-- <button
              type="button"
              class="menu-item"
              [class.disabled]="!canResend"
              [disabled]="!canResend"
              (click)="onResendClick($event)"
            >
              <span class="icon"><i class="feather icon-repeat"></i></span>
              <span>Resend Message</span>
            </button> -->
          </div>

          <div class="menu-divider"></div>

          <div class="menu-section stage-section">
            <button
              type="button"
              class="menu-item has-submenu"
              (click)="toggleStageMenu($event)"
              (keydown.enter)="toggleStageMenu($event)"
              (keydown.space)="toggleStageMenu($event)"
              [attr.aria-expanded]="stageMenuOpen"
            >
              <span class="icon"
                ><i class="feather icon-corner-up-right"></i
              ></span>
              <span>Move to Stage...</span>
              <i
                class="feather ms-auto"
                [ngClass]="stageMenuOpen ? 'icon-chevron-up' : 'icon-chevron-right'"
              ></i>
            </button>
            <div
              class="submenu"
              *ngIf="stageMenuOpen"
              (click)="$event.stopPropagation()"
              [class.flip]="stageMenuToLeft"
            >
              <div class="submenu-title">Move to Stage</div>
              <div class="submenu-list">
                <button
                  type="button"
                  class="submenu-item"
                  *ngFor="let stage of stageMenuViewOptions"
                  [class.current]="isCurrentStage(stage.id)"
                  [disabled]="isCurrentStage(stage.id)"
                  (click)="onStageSelect(stage.id, $event)"
                >
                  <span class="submenu-item-name">{{ stage.name }}</span>
                  <span class="submenu-item-type">{{ stage.typeLabel }}</span>
                </button>
              </div>
            </div>
            <button
              type="button"
              class="menu-item"
              *ngIf="canMove"
              (click)="fire('moveNext', $event)"
            >
              <span class="icon"
                ><i class="feather icon-trending-up"></i
              ></span>
              <span>Move to Next Stage</span>
            </button>
            <button
              type="button"
              class="menu-item"
              (click)="fire('moveToModal', $event)"
            >
              <span class="icon"><i class="feather icon-share-2"></i></span>
              <span>Move to...</span>
            </button>
            <button
              type="button"
              class="menu-item text-danger"
              *ngIf="canMove"
              (click)="fire('reject', $event)"
            >
              <span class="icon"
                ><i class="feather icon-alert-octagon"></i
              ></span>
              <span>Reject</span>
            </button>
          </div>

          <div class="menu-divider" *ngIf="showApproveDriver"></div>

          <div class="menu-section" *ngIf="showApproveDriver">
            <button
              type="button"
              class="menu-item"
              (click)="fire('approveDriver', $event)"
            >
              <span class="icon"><i class="feather icon-user-check"></i></span>
              <span>Approve as Driver</span>
            </button>
          </div>

          <div class="menu-divider"></div>

          <div class="menu-section">
            <button
              type="button"
              class="menu-item"
              *ngIf="canEditApplicant"
              (click)="fire('editApplicant', $event)"
            >
              <span class="icon"><i class="feather icon-edit-3"></i></span>
              <span>Edit Applicant</span>
            </button>
            <button
              type="button"
              class="menu-item text-danger"
              *ngIf="canDeleteApplicant"
              (click)="fire('deleteApplicant', $event)"
            >
              <span class="icon"><i class="feather icon-trash-2"></i></span>
              <span>Delete Applicant</span>
            </button>
          </div>
        </div>
      </ng-template>
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        height: 100%;
      }
      .actions-cell {
        position: relative;
      }
      .btn-link {
        color: var(--bs-secondary-color, #6c757d);
      }
      .btn-link:hover {
        color: var(--bs-primary, #0d6efd);
      }
      /* Overlay panel content styling (scoped via panelClass) */
      .applicant-actions-panel .actions-menu {
        position: relative;
        min-width: 240px;
        background: var(--bs-body-bg);
        border-radius: 16px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.25);
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding: 0.5rem;
        z-index: 2500;
      }
      /* Base menu-item look (buttons inside overlay menu) */
      .applicant-actions-panel .menu-item {
        border: none;
        background: transparent;
        color: var(--bs-body-color, #1f2937);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.45rem 0.6rem;
        border-radius: 10px;
        font-size: 0.86rem;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        width: 100%;
        transition: background 0.18s ease, color 0.18s ease;
      }
      .applicant-actions-panel .menu-item .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        color: var(--bs-secondary-color, rgba(0, 0, 0, 0.55));
      }
      .applicant-actions-panel .menu-item:not(:disabled):hover {
        background: rgba(var(--bs-primary-rgb, 13, 110, 253), 0.07);
        color: var(--bs-primary, #0d6efd);
      }
      .applicant-actions-panel .menu-item.text-danger:not(:disabled):hover {
        color: var(--bs-danger, #dc3545);
        background: rgba(var(--bs-danger-rgb, 220, 53, 69), 0.06);
      }
      .applicant-actions-panel .menu-item:disabled {
        cursor: default;
        opacity: 0.65;
      }

      .applicant-actions-panel .submenu {
        position: absolute;
        top: 0;
        left: calc(100% + 12px);
        min-width: 260px;
        padding: 0.75rem 0.85rem 0.9rem;
        border-radius: 14px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        background: var(--bs-body-bg);
        box-shadow: 0 16px 36px -24px rgba(15, 23, 42, 0.48);
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        z-index: 1055;
        max-height: calc(100vh - 120px);
        overflow: hidden;
      }
      .applicant-actions-panel .submenu::before {
        content: "";
        position: absolute;
        top: 14px;
        left: -10px;
        width: 12px;
        height: 12px;
        background: inherit;
        border-left: 1px solid rgba(15, 23, 42, 0.1);
        border-top: 1px solid rgba(15, 23, 42, 0.1);
        transform: rotate(45deg);
      }
      .applicant-actions-panel .submenu.flip {
        left: auto;
        right: calc(100% + 12px);
      }
      .applicant-actions-panel .submenu.flip::before {
        display: none;
      }
      .applicant-actions-panel .submenu-title {
        font-size: 0.74rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.32px;
        color: var(--bs-secondary-color, rgba(0, 0, 0, 0.62));
      }
      .applicant-actions-panel .submenu-list {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        max-height: 60vh;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        padding-right: 0.25rem;
      }
      .applicant-actions-panel .submenu-item {
        border: none;
        background: transparent;
        color: var(--bs-body-color, #1f2937);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.45rem 0.6rem;
        border-radius: 10px;
        font-size: 0.82rem;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        transition: background 0.18s ease, color 0.18s ease;
      }
      .applicant-actions-panel .submenu-item-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .applicant-actions-panel .submenu-item:not(:disabled):hover {
        background: rgba(var(--bs-primary-rgb, 13, 110, 253), 0.07);
        color: var(--bs-primary, #0d6efd);
      }
      .applicant-actions-panel .submenu-item.current {
        background: rgba(var(--bs-primary-rgb, 13, 110, 253), 0.12);
        color: var(--bs-primary, #0d6efd);
        font-weight: 600;
      }
      .applicant-actions-panel .submenu-item:disabled {
        cursor: default;
        opacity: 0.6;
        color: var(--bs-secondary-color, rgba(0, 0, 0, 0.55));
        background: transparent;
      }
      .applicant-actions-panel .submenu-item-type {
        font-size: 0.74rem;
        font-weight: 500;
        color: var(--bs-secondary-color, rgba(0, 0, 0, 0.55));
        margin-left: 1rem;
        white-space: nowrap;
      }
      .applicant-actions-panel .submenu-item:not(:disabled):hover .submenu-item-type,
      .applicant-actions-panel .submenu-item.current .submenu-item-type {
        color: inherit;
      }
      :host ::ng-deep .applicant-actions-panel {
        border-radius: 16px;
      }
      :host ::ng-deep .applicant-actions-backdrop {
        background: transparent;
      }
    `,
  ],
})
export class ApplicantActionsCellComponent
  implements ICellRendererAngularComp, OnDestroy
{
  open = false;
  stageMenuOpen = false;
  stageMenuToLeft = false;
  private params!: RendererParams;
  private readonly authSession = inject(AuthSessionService);
  private readonly permissions = inject(RoutePermissionService);

  @ViewChild("trigger", { static: false })
  triggerButton?: ElementRef<HTMLButtonElement>;
  @ViewChild("menuTemplate", { static: false })
  menuTemplate?: TemplateRef<unknown>;
  private overlayRef: OverlayRef | null = null;
  private menuPortal: TemplatePortal<any> | null = null;
  private positionStrategy?: FlexibleConnectedPositionStrategy;

  constructor(
    private host: ElementRef<HTMLElement>,
    private overlay: Overlay,
    private viewContainerRef: ViewContainerRef
  ) {}

  agInit(params: RendererParams): void {
    this.params = params;
  }

  refresh(params: RendererParams): boolean {
    this.params = params;
    this.closeMenu();
    return true;
  }

  toggle(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.open ? this.closeMenu() : this.openMenu();
  }

  fire(action: ApplicantQuickAction, event: MouseEvent, payload?: any): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
    const applicant = this.params?.data;
    const parent = this.parentComponent;
    parent?.handleQuickAction?.(applicant, action, payload);
  }

  onResendClick(event: MouseEvent): void {
    if (!this.canResend) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.fire("resendSms", event);
  }

  toggleStageMenu(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.stageMenuOpen = !this.stageMenuOpen;
    if (this.stageMenuOpen) {
      setTimeout(() => this.evaluateStageMenuAlignment(), 0);
    } else {
      this.stageMenuToLeft = false;
    }
    requestAnimationFrame(() => this.repositionMenu());
  }

  onStageSelect(stageId: number, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.fire("moveToStage", event, stageId);
  }

  isCurrentStage(stageId: number): boolean {
    const current = this.currentStageIdNum;
    return current !== null && Number(stageId) === current;
  }

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: Event): void {
    if (!this.open) return;
    const target = event.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.closeMenu();
    }
  }

  @HostListener("window:scroll")
  @HostListener("window:resize")
  onViewportChange(): void {
    if (this.open) {
      this.repositionMenu();
      if (this.stageMenuOpen) {
        this.evaluateStageMenuAlignment();
      }
    }
  }

  ngOnDestroy(): void {
    this.disposeOverlay();
  }

  private openMenu(): void {
    const triggerEl = this.triggerButton?.nativeElement;
    const template = this.menuTemplate;
    if (!triggerEl || !template) {
      return;
    }

    this.disposeOverlay();
    this.stageMenuOpen = false;
    this.stageMenuToLeft = false;

    const positions: ConnectionPositionPair[] = [
      { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
      { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
      { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
      { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
    ];

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(triggerEl)
      .withPositions(positions)
      .withFlexibleDimensions(false)
      .withPush(true)
      .withViewportMargin(8);

    // Reposition when ag-Grid viewport scrolls
    const gridRoot = this.host.nativeElement.closest('.ag-root-wrapper') as HTMLElement | null;
    const gridViewport = gridRoot?.querySelector('.ag-body-viewport') as HTMLElement | null;
    if (gridViewport) {
      try {
        gridViewport.addEventListener('scroll', () => this.repositionMenu(), { passive: true });
      } catch {}
    }

    this.positionStrategy = positionStrategy;

    this.overlayRef = this.overlay.create({
      hasBackdrop: true,
      backdropClass: "applicant-actions-backdrop",
      panelClass: "applicant-actions-panel",
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      positionStrategy,
    });

    this.overlayRef.backdropClick().subscribe(() => this.closeMenu());
    this.overlayRef.keydownEvents().subscribe((ev) => {
      if (ev.key === "Escape") {
        this.closeMenu();
      }
    });

    this.menuPortal = new TemplatePortal(template, this.viewContainerRef);
    this.overlayRef.attach(this.menuPortal);
    this.open = true;
    this.overlayRef.updatePosition();
    setTimeout(() => this.evaluateStageMenuAlignment(), 0);
  }

  private closeMenu(): void {
    this.open = false;
    this.stageMenuOpen = false;
    this.stageMenuToLeft = false;
    if (this.overlayRef) {
      this.overlayRef.detach();
    }
  }

  private repositionMenu(): void {
    if (!this.overlayRef) return;
    try {
      if (this.positionStrategy) {
        this.positionStrategy.apply();
      } else {
        this.overlayRef.updatePosition();
      }
    } catch {
      this.overlayRef.updatePosition();
    }
  }

  private disposeOverlay(): void {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
    this.menuPortal = null;
  }

  private get parentComponent(): any {
    return this.params?.context?.componentParent as any;
  }

  get canResend(): boolean {
    const parent = this.parentComponent;
    if (parent?.canResendQuickAction) {
      try {
        return parent.canResendQuickAction(this.params?.data ?? null);
      } catch {
        return true;
      }
    }
    return true;
  }

  get canMove(): boolean {
    return this.hasPermission("Update");
  }

  get canEditApplicant(): boolean {
    return this.hasPermission("Update");
  }

  get canDeleteApplicant(): boolean {
    return this.hasPermission("Delete");
  }

  get showApproveDriver(): boolean {
    const applicant: any = this.params?.data ?? {};
    const raw = applicant?.raw ?? applicant;
    return this.booleanize(raw?.go_to_driver ?? raw?.GO_TO_DRIVER);
  }

  get stageMenuViewOptions(): StageMenuViewOption[] {
    const parent = this.parentComponent as any;
    const source: any[] = Array.isArray(parent?.stageOptions)
      ? parent.stageOptions
      : [];
    return source.map((stage: any) => {
      const rawId =
        stage?.id_stage ?? stage?.id ?? stage?.idStage ?? stage?.ID ?? null;
      const numId = rawId === null || rawId === undefined ? NaN : Number(rawId);
      const safeId = Number.isFinite(numId) ? numId : -1;
      const name = (stage?.name ?? "").toString();
      const type = (stage?.type ?? "Stage").toString();
      return {
        id: safeId,
        name,
        type,
        typeLabel: this.formatStageTypeLabel(type),
      };
    });
  }

  get currentStageIdNum(): number | null {
    const applicant: any = this.params?.data ?? {};
    const candidates = [
      applicant?.stageId,
      applicant?.raw?.id_stage,
      applicant?.raw?.stage_id,
      applicant?.raw?.stageId,
      applicant?.raw?.idStage,
    ];
    for (const value of candidates) {
      if (value === null || value === undefined) continue;
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return null;
  }
  private hasPermission(action: RoutePermissionAction): boolean {
    try {
      return this.permissions.canCurrent(action);
    } catch {
      return false;
    }
  }

  private booleanize(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      return ["1", "true", "yes", "y"].includes(lowered);
    }
    return Boolean(value);
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

  private evaluateStageMenuAlignment(): void {
    if (!this.overlayRef || !this.stageMenuOpen) {
      return;
    }
    const panelEl = this.overlayRef.overlayElement;
    const menuEl = panelEl.querySelector(".actions-menu") as
      | HTMLElement
      | null;
    if (!menuEl) {
      this.stageMenuToLeft = false;
      return;
    }
    const submenuEl = panelEl.querySelector(".submenu") as
      | HTMLElement
      | null;
    const submenuWidth = submenuEl
      ? submenuEl.getBoundingClientRect().width
      : 280;
    const spacing = 12;
    const menuRect = menuEl.getBoundingClientRect();
    const fitsRight =
      menuRect.right + submenuWidth + spacing <= window.innerWidth;
    const fitsLeft = menuRect.left - submenuWidth - spacing >= spacing;
    this.stageMenuToLeft = !fitsRight && fitsLeft;
  }
}
