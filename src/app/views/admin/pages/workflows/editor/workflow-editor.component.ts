import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ActivatedRoute, Router } from "@angular/router";
import { DriveWhipCoreService } from "../../../../../core/services/drivewhip-core/drivewhip-core.service";
import {
  IDriveWhipCoreAPI,
  DriveWhipCommandResponse,
} from "../../../../../core/models/entities.model";
import { DriveWhipAdminCommand } from "../../../../../core/db/procedures";
import { Utilities } from "../../../../../Utilities/Utilities";
import { finalize, forkJoin, of } from 'rxjs';

/**
 * WorkflowEditorComponent
 * Displays a primary header bar with workflow name centered and a two-column layout:
 * - Left narrow column: vertical stages list (adapted from locations carousel but vertical)
 * - Right column: placeholder for future workflow editing forms
 */
@Component({
  selector: "dw-workflow-editor",
  standalone: true,
  imports: [CommonModule, DragDropModule],
  templateUrl: "./workflow-editor.component.html",
  styleUrl: "./workflow-editor.component.scss",
})
export class WorkflowEditorComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private core = inject(DriveWhipCoreService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly workflowName = signal<string>("Loading…");
  readonly stages = signal<any[]>([]);
  readonly selectedStageId = signal<number | null>(null);
  readonly savingOrder = signal(false);
  readonly filterText = signal('');
  // Keep original order snapshot to detect changes
  private initialOrder: number[] = [];

  // Computed flag to know if order changed
  readonly orderDirty = computed(() => {
    const current = this.stages().map((s) => s.id_stage);
    return current.join(',') !== this.initialOrder.join(',');
  });

  // Count of stages whose index changed (still useful for user feedback)
  readonly changedCount = computed(() => {
    if (!this.orderDirty()) return 0;
    const originalIndex = new Map<number, number>();
    this.initialOrder.forEach((id, i) => originalIndex.set(id, i));
    return this.stages().reduce((acc, s, i) => acc + (originalIndex.get(s.id_stage) === i ? 0 : 1), 0);
  });

  // Filtered list (disable drag if filtering to avoid inconsistent indexes)
  readonly filteredStages = computed(() => {
    const term = this.filterText().trim().toLowerCase();
    if (!term) return this.stages();
    return this.stages().filter(s => (s.name || '').toLowerCase().includes(term));
  });

  readonly hasStages = computed(() => this.stages().length > 0);

  private workflowId: number | null = null;

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      const raw = p.get("id");
      this.workflowId = raw ? Number(raw) : null;
      if (this.workflowId != null && !Number.isNaN(this.workflowId)) {
        this.loadWorkflow();
        this.loadStages();
      } else {
        this.error.set("Invalid workflow id");
      }
    });
  }

  private loadWorkflow(): void {
    if (this.workflowId == null) return;
    // Reuse crm_workflows_list and filter client side (adjust SP if needed later)
    this.loading.set(true);
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_workflows_list,
      parameters: [],
    };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: (res) => {
        if (!res.ok) {
          this.error.set("Failed to load workflow");
          return;
        }
        let rows: any[] = [];
        if (Array.isArray(res.data)) {
          rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
        }
        const match = rows.find((r) => r.id_workflow === this.workflowId);
        if (match) {
          this.workflowName.set(match.name || `Workflow #${this.workflowId}`);
        } else {
          this.workflowName.set(`Workflow #${this.workflowId}`);
        }
      },
      error: () => this.error.set("Failed to load workflow"),
      complete: () => this.loading.set(false),
    });
  }

  private loadStages(): void {
    if (this.workflowId == null) return;
    this.loading.set(true);
    const api: IDriveWhipCoreAPI = {
      commandName: DriveWhipAdminCommand.crm_stages_list,
      parameters: [this.workflowId],
    };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: (res) => {
        if (!res.ok) {
          return;
        }
        let raw: any[] = [];
        if (Array.isArray(res.data))
          raw = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
        const list = Array.isArray(raw) ? raw : [];
        const normalized = list
          .map((r) => ({
            id_stage: r.id_stage,
            id_stage_type: r.id_stage_type, // needed for icon mapping
            name: r.name,
            type: r.type,
            applicants_count: r.applicants_count,
            sort_order: r.sort_order,
          }))
          .filter((s) => s.name)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        this.stages.set(normalized);
        // Refresh original order snapshot after loading from backend
        this.initialOrder = normalized.map(s => s.id_stage);
      },
      error: () => {},
      complete: () => this.loading.set(false),
    });
  }

  selectStage(id: number): void {
    this.selectedStageId.set(id);
  }

  trackStage = (_: number, item: any) => item?.id_stage ?? item?.id;

  // Icon mapping similar to locations component
  private readonly stageIconMap: Record<number, string> = {
    1: 'icon-file-text',      // Data / form collection
    2: 'icon-sliders',        // Rules / configuration
    3: 'icon-user-check',     // Approval / review
    4: 'icon-clock',          // Waiting / scheduling
    5: 'icon-shield',         // Compliance / security
    6: 'icon-briefcase',      // Business operation
    7: 'icon-truck',          // Logistics / movement
    8: 'icon-bar-chart-2',    // Analytics / KPI
    9: 'icon-zap',            // Automation / trigger
    10: 'icon-layers'         // Generic / fallback group
  };

  stageIcon(type?: number | string | null): string {
    if (type === null || type === undefined) return 'icon-layers';
    const t = (typeof type === 'string') ? Number(type) : type;
    if (!Number.isFinite(t)) return 'icon-layers';
    return this.stageIconMap[t as number] ?? 'icon-layers';
  }

  // Drag & Drop handler (supports filtered view). Always active.
  onStageDrop(event: CdkDragDrop<any[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const full = [...this.stages()];
    const filtered = this.filteredStages();
    // If no filter active, simple move
    if (!this.filterText()) {
      moveItemInArray(full, event.previousIndex, event.currentIndex);
    } else {
      // Filtered reorder: map indices through filtered subset
      const moved = filtered[event.previousIndex];
      if (!moved) return;
      const targetRef = filtered[event.currentIndex];
      const from = full.findIndex(s => s.id_stage === moved.id_stage);
      if (from < 0) return;
      // Remove moved
      full.splice(from, 1);
      if (!targetRef) {
        // Dropped beyond last filtered item: append to end of sequence spanned by filtered subset
        full.push(moved);
      } else {
        const to = full.findIndex(s => s.id_stage === targetRef.id_stage);
        if (to < 0) { full.push(moved); }
        else {
          // Decide insert position relative to direction
            const insertIndex = (event.currentIndex > event.previousIndex) ? to + 1 : to;
            full.splice(insertIndex <= full.length ? insertIndex : full.length, 0, moved);
        }
      }
    }
    // Normalize sort_order sequentially
    full.forEach((s, i) => s.sort_order = i + 1);
    this.stages.set(full);
  }

  // Build payload for save (id_stage + sort_order) – used in saveOrder()
  private buildOrderPayload(): { id_stage: number; sort_order: number }[] {
    return this.stages().map(s => ({ id_stage: s.id_stage, sort_order: s.sort_order ?? 0 }));
  }

  // Persist new ordering (placeholder until backend SP implemented)
  saveOrder(): void {
    if (!this.orderDirty() || this.savingOrder()) return;
    if (this.workflowId == null) return;
    const payload = this.buildOrderPayload();
    // TODO: Replace with real stored procedure (e.g., DriveWhipAdminCommand.crm_stages_reorder)
    // Example expected API contract (proposed):
    // commandName: crm_stages_reorder
    // parameters: [ p_id_workflow, p_json_payload ] where payload is JSON string of array
    // const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_reorder, parameters: [this.workflowId, JSON.stringify(payload)] };
    // this.savingOrder.set(true);
    // this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({ ... })

    const before = [...this.initialOrder];
    const after = this.stages().map(s => s.id_stage);
    const diff = after.map((id, idx) => ({
      position: idx + 1,
      id_stage: id,
      changed: before[idx] !== id,
      sort_order: payload[idx]?.sort_order
    }));
    // Persistence using existing CRUD SP (U action updating only sort_order)
    this.persistOrder(payload);
  }

  // Reset to original order snapshot
  resetOrder(): void {
    if (!this.orderDirty()) return;
    const mapOriginalIndex = new Map<number, number>();
    this.initialOrder.forEach((id, idx) => mapOriginalIndex.set(id, idx));
    const restored = [...this.stages()].sort((a, b) => (mapOriginalIndex.get(a.id_stage) ?? 0) - (mapOriginalIndex.get(b.id_stage) ?? 0));
    restored.forEach((s, idx) => s.sort_order = idx + 1);
    this.stages.set(restored);
    // Ensure scroll container returns to top (smooth UX)
    queueMicrotask(() => {
      const el = document.querySelector('.stages-scroll') as HTMLElement | null;
      if (el) el.scrollTop = 0;
    });
  }

  onFilterInput(value: string): void { this.filterText.set(value); }

  /**
   * Persist order calling crm_stages_crud with action 'U' for each stage whose position changed.
   * SP signature:
   *  crm_stages_crud(
   *    p_action, p_id_stage, p_id_workflow, p_id_stage_type, p_name, p_sort_order, p_is_active, p_created_by, p_updated_by
   *  )
   * For update we must send: 'U', id_stage, id_workflow, id_stage_type, name, sort_order, is_active, NULL(created_by), currentUser(updated_by)
   */
  private persistOrder(payload: { id_stage: number; sort_order: number }[]): void {
    // Determine which stages actually moved (position changed compared to initialOrder)
    const initialIndexMap = new Map<number, number>();
    this.initialOrder.forEach((id, idx) => initialIndexMap.set(id, idx));
    const changed = this.stages().filter((s, newIdx) => initialIndexMap.get(s.id_stage) !== newIdx);
    if (changed.length === 0) {
      Utilities.showToast('No changes detected', 'info');
      this.initialOrder = this.stages().map(s => s.id_stage);
      return;
    }
    const currentUser = 'system'; // TODO: replace with real user from auth context
    const calls = changed.map(stage => {
      const params: any[] = [
        'U',                 // p_action
        stage.id_stage,      // p_id_stage
        this.workflowId,     // p_id_workflow
        stage.id_stage_type, // p_id_stage_type
        stage.name,          // p_name
        stage.sort_order,    // p_sort_order
        1,                   // p_is_active (preserve active state; could read from stage if exists)
        null,                // p_created_by ignored on update
        currentUser          // p_updated_by
      ];
      const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_crud, parameters: params };
      return this.core.executeCommand<DriveWhipCommandResponse>(api);
    });

    this.savingOrder.set(true);
    forkJoin(calls.length ? calls : [of({ ok: true }) as any]).pipe(
      finalize(() => this.savingOrder.set(false))
    ).subscribe({
      next: (results: any[]) => {
        const allOk = results.every(r => r && r.ok);
        if (allOk) {
          Utilities.showToast('Order saved', 'success');
          this.initialOrder = this.stages().map(s => s.id_stage);
        } else {
          Utilities.showToast('Some stages failed to update', 'warning');
        }
      },
      error: err => {
        console.error('[WorkflowEditor] persistOrder error', err);
        Utilities.showToast('Failed to save order', 'error');
      }
    });
  }
}
