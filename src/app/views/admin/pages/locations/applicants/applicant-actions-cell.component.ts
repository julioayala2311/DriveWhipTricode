import { CommonModule } from "@angular/common";
import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
} from "@angular/core";
import { ICellRendererAngularComp } from "ag-grid-angular";
import { ICellRendererParams } from "ag-grid-community";
import { Overlay, OverlayModule, OverlayRef } from "@angular/cdk/overlay";
import { PortalModule, TemplatePortal } from "@angular/cdk/portal";

export type ApplicantQuickAction =
  | "openPanel"
  | "sendEmail"
  | "sendSms"
  | "resendSms"
  | "moveToModal"
  | "moveNext"
  | "reject";

interface RendererParams extends ICellRendererParams {
  context: {
    componentParent?: {
      handleQuickAction?: (
        applicant: any,
        action: ApplicantQuickAction
      ) => void;
    };
  };
}

@Component({
  selector: "app-applicant-actions-cell",
  standalone: true,
  imports: [CommonModule, OverlayModule, PortalModule],
  template: `
    <div class="actions-cell" (click)="$event.stopPropagation()">
      <div class="dropdown" [class.open]="open">
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
          <div class="actions-dropdown" role="menu">
            <button
              type="button"
              class="dropdown-item"
              (click)="fire('openPanel', $event)"
            >
              <i class="feather icon-sidebar me-2"></i>
              Open panel
            </button>
            <div class="dropdown-divider"></div>
            <button
              type="button"
              class="dropdown-item"
              (click)="fire('sendEmail', $event)"
            >
              <i class="feather icon-mail me-2"></i>
              Send email
            </button>
            <button
              type="button"
              class="dropdown-item"
              (click)="fire('sendSms', $event)"
            >
              <i class="feather icon-smartphone me-2"></i>
              Send SMS
            </button>
            <button
              type="button"
              class="dropdown-item"
              (click)="fire('resendSms', $event)"
            >
              <i class="feather icon-repeat me-2"></i>
              Resend message
            </button>
            <div class="dropdown-divider"></div>
            <button
              type="button"
              class="dropdown-item"
              (click)="fire('moveToModal', $event)"
            >
              <i class="feather icon-share-2 me-2"></i>
              Move to...
            </button>
            <button
              type="button"
              class="dropdown-item"
              (click)="fire('moveNext', $event)"
            >
              <i class="feather icon-trending-up me-2"></i>
              Move to next stage
            </button>
            <button
              type="button"
              class="dropdown-item text-danger"
              (click)="fire('reject', $event)"
            >
              <i class="feather icon-alert-octagon me-2"></i>
              Reject
            </button>
          </div>
        </ng-template>
      </div>
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
      .actions-dropdown {
        min-width: 204px;
        background: rgba(15, 23, 42, 0.96);
        color: rgba(226, 232, 240, 0.95);
        border-radius: 0.75rem;
        border: 1px solid rgba(99, 102, 241, 0.25);
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(12px);
        padding: 0.3rem 0;
        display: flex;
        flex-direction: column;
      }
      .dropdown-item {
        width: 100%;
        text-align: left;
        background: transparent;
        border: none;
        padding: 0.45rem 1rem;
        font-size: 0.86rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: inherit;
        transition: background 140ms ease;
      }
      .dropdown-item:hover {
        background: rgba(59, 130, 246, 0.22);
      }
      .dropdown-divider {
        height: 1px;
        margin: 0.35rem 0;
        background: rgba(148, 163, 184, 0.25);
      }
      .dropdown-item i {
        font-size: 0.9rem;
        color: rgba(148, 163, 184, 0.9);
      }
      :host ::ng-deep .applicant-actions-panel {
        border-radius: 0.75rem;
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
  private params!: RendererParams;
  @ViewChild("trigger", { static: false })
  triggerButton?: ElementRef<HTMLButtonElement>;
  @ViewChild("menuTemplate", { static: false })
  menuTemplate?: TemplateRef<unknown>;
  private overlayRef: OverlayRef | null = null;
  private menuPortal: TemplatePortal<any> | null = null;

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

  fire(action: ApplicantQuickAction, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
    const applicant = this.params?.data;
    const parent = this.params?.context?.componentParent;
    parent?.handleQuickAction?.(applicant, action);
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

    const initialPosition = this.overlay.position().global().left("0px").top("0px");

    this.overlayRef = this.overlay.create({
      hasBackdrop: true,
      backdropClass: "applicant-actions-backdrop",
      panelClass: "applicant-actions-panel",
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      positionStrategy: initialPosition,
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
    this.repositionMenu();
  }

  private closeMenu(): void {
    this.open = false;
    if (this.overlayRef) {
      this.overlayRef.detach();
    }
  }

  private repositionMenu(): void {
    if (!this.overlayRef || !this.triggerButton) {
      return;
    }

    const triggerEl = this.triggerButton.nativeElement;
    const panel = this.overlayRef.overlayElement;

    // Ensure measurements after rendering
    const measureAndUpdate = () => {
      const triggerRect = triggerEl.getBoundingClientRect();
      const menuRect = panel.getBoundingClientRect();
      const padding = 12;
      let left = triggerRect.left;
      let top = triggerRect.bottom + 6;

      if (left + menuRect.width + padding > window.innerWidth) {
        left = Math.max(padding, window.innerWidth - menuRect.width - padding);
      } else {
        left = Math.max(padding, left);
      }

      if (top + menuRect.height + padding > window.innerHeight) {
        const alternateTop = triggerRect.top - menuRect.height - 6;
        if (alternateTop >= padding) {
          top = alternateTop;
        } else {
          top = Math.max(padding, window.innerHeight - menuRect.height - padding);
        }
      }

      const strategy = this.overlay
        .position()
        .global()
        .left(`${Math.round(left)}px`)
        .top(`${Math.round(top)}px`);
      this.overlayRef?.updatePositionStrategy(strategy);
    };

    // Wait a tick so the panel has dimensions
    requestAnimationFrame(measureAndUpdate);
  }

  private disposeOverlay(): void {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
    this.menuPortal = null;
  }
}
