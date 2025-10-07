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
import { AuthSessionService } from '../../../../../core/services/auth/auth-session.service';
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
  private authSession = inject(AuthSessionService);

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

  // Data Collection section signals
  readonly dataSectionLoading = signal(false);
  readonly dataSectionError = signal<string | null>(null);
  readonly dataSectionId = signal<number | null>(null); // id_stage_section
  readonly dataSectionSaving = signal(false); // saving flag for debounce coordination
  readonly dc_show_stage_in_tracker = signal<boolean>(false);
  readonly dc_auto_advance_stage = signal<boolean>(false);
  readonly dc_notify_owner_on_submit = signal<boolean>(false);
  readonly dc_show_one_question = signal<boolean>(false);
  // Hold json_form so that UPDATE never sends NULL (backend constraint)
  readonly dataSectionJsonForm = signal<string>('[]');
  readonly dataCollectionVisible = computed(() => {
    const stId = this.selectedStageId();
    if (!stId) return false;
    const st = this.stages().find(s => s.id_stage === stId);
    return st?.type === 'Data Collection';
  });

  // Rules section visibility (stage type === 'Rules')
  readonly rulesVisible = computed(() => {
    const stId = this.selectedStageId();
    if (!stId) return false;
    const st = this.stages().find(s => s.id_stage === stId);
    return st?.type === 'Rules';
  });

  // --- Rules Form State (initial single rule card) ---
  readonly rulesLoading = signal(false);
  readonly rulesError = signal<string | null>(null);
  // Catalogs
  readonly conditionTypes = signal<any[]>([]); // { id_condition_type, condition }
  readonly dataKeys = signal<any[]>([]); // { id_datakey, datakey }
  readonly operators = signal<any[]>([]); // { id_operator, operator }
  // Dynamic list of rule conditions
  private createEmptyRule(): RuleCondition {
    return { condition_type_id: null, datakey_id: null, operator_id: null, value: '' };
  }
  readonly rulesConditions = signal<RuleCondition[]>([ this.createEmptyRule() ]);
  // Dynamic list of rule actions
  private createEmptyAction(): RuleAction {
    return { action_type: 'Move applicant to stage', stage_id: null, reason: 'Not old enough' };
  }
  readonly rulesActions = signal<RuleAction[]>([ this.createEmptyAction() ]);

  addRuleCondition(): void {
    const next = [...this.rulesConditions(), this.createEmptyRule()];
    this.rulesConditions.set(next);
  }

  updateRuleCondition(index: number, field: keyof RuleCondition, value: any): void {
    const list = [...this.rulesConditions()];
    const target = { ...list[index], [field]: value };
    list[index] = target;
    this.rulesConditions.set(list);
  }

  addRuleAction(): void {
    const next = [...this.rulesActions(), this.createEmptyAction()];
    this.rulesActions.set(next);
  }

  updateRuleAction(index: number, field: keyof RuleAction, value: any): void {
    const list = [...this.rulesActions()];
    const target = { ...list[index], [field]: value };
    list[index] = target;
    this.rulesActions.set(list);
  }

  removeRuleAction(index: number): void {
    const list = [...this.rulesActions()];
    if (index < 0 || index >= list.length) return;
    if (list.length === 1) {
      list[0] = this.createEmptyAction();
    } else {
      list.splice(index, 1);
    }
    this.rulesActions.set(list);
  }

  trackRuleAction = (index: number, _item: RuleAction) => index;

  removeRuleCondition(index: number): void {
    const list = [...this.rulesConditions()];
    if (index < 0 || index >= list.length) return;
    if (list.length === 1) {
      // Si sólo hay una, limpiamos sus campos en lugar de eliminarla
      list[0] = this.createEmptyRule();
    } else {
      list.splice(index, 1);
    }
    this.rulesConditions.set(list);
  }

  trackRuleCondition = (index: number, _item: RuleCondition) => index;

  // Placeholder action for Idle Move Rule button (future: open modal / add rule object)
  onAddIdleMoveRule(): void {
    Utilities.showToast('Idle Move Rule action coming soon', 'info');
  }

  // --- Initial Message (Data Collection) ---
  readonly initialMessageDelayMins = signal<number>(0);
  readonly initialMessageDisabled = signal<boolean>(false);

  onInitialMessageDelayChange(raw: any): void {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) {
      this.initialMessageDelayMins.set(0);
    } else {
      this.initialMessageDelayMins.set(Math.floor(v));
    }
  }

  toggleInitialMessageDisabled(flag: boolean): void {
    this.initialMessageDisabled.set(flag);
  }

  onAddInitialMessage(): void {
    // Placeholder – future: persist inside json_form for the section
    const payload = {
      title: 'Complete your DriveWhip Applications Now!',
      delivery: 'Text + Mail',
      delayMinutes: this.initialMessageDelayMins(),
      disabled: this.initialMessageDisabled()
    };
    console.log('[WorkflowEditor] Initial Message add clicked', payload);
    Utilities.showToast('Initial Message action coming soon', 'info');
  }

  private loadRulesCatalogs(): void {
    if (this.rulesLoading()) return;
    this.rulesLoading.set(true);
    this.rulesError.set(null);
    const apiCondition: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_condition_type_crud, parameters: ['R', null, null, null, null, null] };
    const apiDatakey: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_datakey_crud, parameters: ['R', null, null, null, null, null] };
    const apiOperator: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_operator_crud, parameters: ['R', null, null, null, null, null] };
    forkJoin([
      this.core.executeCommand<DriveWhipCommandResponse>(apiCondition),
      this.core.executeCommand<DriveWhipCommandResponse>(apiDatakey),
      this.core.executeCommand<DriveWhipCommandResponse>(apiOperator)
    ]).pipe(finalize(()=> this.rulesLoading.set(false))).subscribe({
      next: ([condRes, dataRes, opRes]) => {
        if (!condRes.ok || !dataRes.ok || !opRes.ok) {
          this.rulesError.set('Failed to load catalogs');
          return;
        }
        const extract = (res: any) => {
          let rows: any[] = [];
          if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
          return rows || [];
        };
        this.conditionTypes.set(extract(condRes));
        this.dataKeys.set(extract(dataRes));
        this.operators.set(extract(opRes));
      },
      error: () => this.rulesError.set('Failed to load catalogs')
    });
  }

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
          this.workflowName.set(match.workflow_name || `Workflow #${this.workflowId}`);
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
    // Attempt load of data-collection section if applicable
    if (this.stages().find(s => s.id_stage === id)?.type === 'Data Collection') {
      this.loadDataCollectionSection(id);
    }
    if (this.stages().find(s => s.id_stage === id)?.type === 'Rules') {
      this.loadRulesCatalogs();
    }
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

  // Section type mapping provided by user (table): 1 = Data Collection, 2 = Rules
  private readonly sectionTypeMap: Record<string, number> = {
    'Data Collection': 1,
    'Rules': 2
  };

  private sectionTypeIdForStage(stageId: number): number | null {
    const st = this.stages().find(s => s.id_stage === stageId);
    if (!st) return null;
    const id = this.sectionTypeMap[st.type];
    return (typeof id === 'number') ? id : null;
  }

  stageIcon(type?: number | string | null): string {
    if (type === null || type === undefined) return 'icon-layers';
    const t = (typeof type === 'string') ? Number(type) : type;
    if (!Number.isFinite(t)) return 'icon-layers';
    return this.stageIconMap[t as number] ?? 'icon-layers';
  }

  // --- Data Collection Section Logic ---
  private loadDataCollectionSection(stageId: number): void {
    if (this.dataSectionLoading()) return;
    this.dataSectionLoading.set(true);
    this.dataSectionError.set(null);
    // READ operation: call SP with p_action_type outside C/U/D (use 'R')
    // Provide id_section_type if we can resolve it (helps backend filter if supported)
    const sectionTypeId = this.sectionTypeIdForStage(stageId); // expected 1 for Data Collection
    const params: any[] = [ 'R', null, stageId, sectionTypeId, null, null, null, null, null, null, null, null ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_crud, parameters: params };
    this.core.executeCommand<DriveWhipCommandResponse>(api).pipe(finalize(()=> this.dataSectionLoading.set(false))).subscribe({
      next: res => {
        if (!res.ok) { this.dataSectionError.set('Failed to load data collection settings'); return; }
        let rows: any[] = [];
        if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
        // Filter by stage id
        const match = rows.find(r => r.id_stage === stageId);
        if (match) {
          this.dataSectionId.set(match.id_stage_section);
          this.dc_show_stage_in_tracker.set(!!match.show_stage_in_tracker);
          this.dc_auto_advance_stage.set(!!match.auto_advance_stage);
          this.dc_notify_owner_on_submit.set(!!match.notify_owner_on_submit);
          this.dc_show_one_question.set(!!match.show_one_question);
          // Preserve existing json_form or fallback to default array string
          this.dataSectionJsonForm.set(match.json_form ?? '[]');
        } else {
          // No existing section: reset toggles
          this.dataSectionId.set(null);
          this.dc_show_stage_in_tracker.set(false);
          this.dc_auto_advance_stage.set(false);
          this.dc_notify_owner_on_submit.set(false);
          this.dc_show_one_question.set(false);
          this.dataSectionJsonForm.set('[]');
        }
      },
      error: () => this.dataSectionError.set('Failed to load data collection settings')
    });
  }

  toggleDataOption(key: 'show_stage_in_tracker' | 'auto_advance_stage' | 'notify_owner_on_submit' | 'show_one_question', value: boolean): void {
    const stageId = this.selectedStageId();
    if (!stageId) return;
    // Optimistic update
    const prevValues = {
      show_stage_in_tracker: this.dc_show_stage_in_tracker(),
      auto_advance_stage: this.dc_auto_advance_stage(),
      notify_owner_on_submit: this.dc_notify_owner_on_submit(),
      show_one_question: this.dc_show_one_question()
    };
    switch (key) {
      case 'show_stage_in_tracker': this.dc_show_stage_in_tracker.set(value); break;
      case 'auto_advance_stage': this.dc_auto_advance_stage.set(value); break;
      case 'notify_owner_on_submit': this.dc_notify_owner_on_submit.set(value); break;
      case 'show_one_question': this.dc_show_one_question.set(value); break;
    }
    this.queueTogglePersistence(stageId, key, prevValues[key], value);
  }

  // --- Debounce & rollback implementation ---
  private toggleTimers: Record<string, any> = {};
  private readonly toggleDebounceMs = 250;

  private queueTogglePersistence(stageId: number, key: string, prevValue: boolean, newValue: boolean) {
    // If a timer exists for this key, clear it (user toggled rapidly)
    const existing = this.toggleTimers[key];
    if (existing) clearTimeout(existing);

    // If section is being created (id null AND saving), delay re-queue until creation ends
    if (this.dataSectionSaving() && this.dataSectionId() == null) {
      this.toggleTimers[key] = setTimeout(() => this.queueTogglePersistence(stageId, key, prevValue, newValue), this.toggleDebounceMs);
      return;
    }

    this.toggleTimers[key] = setTimeout(() => {
      delete this.toggleTimers[key];
      this.persistDataSection(stageId, key as any, prevValue, newValue);
    }, this.toggleDebounceMs);
  }

  private persistDataSection(stageId: number, key: 'show_stage_in_tracker' | 'auto_advance_stage' | 'notify_owner_on_submit' | 'show_one_question', prevValue: boolean, intendedValue: boolean) {
    const isCreate = this.dataSectionId() == null;
    const action = isCreate ? 'C' : 'U';
  const currentUser = this.authSession.user?.user || 'system';
    const sectionTypeId = this.sectionTypeIdForStage(stageId);
    if (sectionTypeId == null) {
      this.rollbackToggle(key, prevValue, 'Unknown section type for stage');
      return;
    }
    // Helper inline to convert boolean flags to the INT (1/0) values expected by the SP
    const b = (v: boolean) => v ? 1 : 0;
    const params: any[] = [
      action,
      isCreate ? null : this.dataSectionId(),
      stageId,
      sectionTypeId, // id_section_type resolved from mapping (Data Collection=1, Rules=2)
      // json_form must not be NULL on UPDATE. Use existing or default placeholder '[]'.
      isCreate ? this.dataSectionJsonForm() : (this.dataSectionJsonForm() || '[]'),
      b(this.dc_show_stage_in_tracker()),
      b(this.dc_auto_advance_stage()),
      b(this.dc_notify_owner_on_submit()),
      b(this.dc_show_one_question()),
      1, // is_active
      isCreate ? currentUser : null,
      isCreate ? null : currentUser
    ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_crud, parameters: params };
    this.dataSectionSaving.set(true);
    this.core.executeCommand<DriveWhipCommandResponse>(api).pipe(finalize(()=> this.dataSectionSaving.set(false))).subscribe({
      next: res => {
        if (!res.ok) {
          this.rollbackToggle(key, prevValue, 'Failed to save setting');
          return;
        }
        if (isCreate) {
          // Reload to capture new id
            this.loadDataCollectionSection(stageId);
            Utilities.showToast('Section created', 'success');
        } else {
          Utilities.showToast('Setting updated', 'success');
        }
      },
      error: () => this.rollbackToggle(key, prevValue, 'Failed to save setting')
    });
  }

  private rollbackToggle(key: string, prevValue: boolean, message: string) {
    switch (key) {
      case 'show_stage_in_tracker': this.dc_show_stage_in_tracker.set(prevValue); break;
      case 'auto_advance_stage': this.dc_auto_advance_stage.set(prevValue); break;
      case 'notify_owner_on_submit': this.dc_notify_owner_on_submit.set(prevValue); break;
      case 'show_one_question': this.dc_show_one_question.set(prevValue); break;
    }
    Utilities.showToast(message, 'error');
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
  const currentUser = this.authSession.user?.user || 'system';
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

// Local interface for rule condition editing state
interface RuleCondition {
  id?: number; // future persistence id
  condition_type_id: number | null;
  datakey_id: number | null;
  operator_id: number | null;
  value: string;
}

interface RuleAction {
  id?: number; // future persistence id
  action_type: string; // e.g. 'Move applicant to stage'
  stage_id: number | null; // target stage
  reason: string; // e.g. 'Not old enough'
}
