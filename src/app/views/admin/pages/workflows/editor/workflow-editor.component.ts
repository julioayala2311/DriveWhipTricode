import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from '@angular/forms';
import { NonNegativeNumberDirective } from '../../../../../shared/non-negative-number.directive';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { DriveWhipCoreService } from "../../../../../core/services/drivewhip-core/drivewhip-core.service";
import {
  IDriveWhipCoreAPI,
  DriveWhipCommandResponse,
} from "../../../../../core/models/entities.model";
import { DriveWhipAdminCommand } from "../../../../../core/db/procedures";
import { Utilities } from "../../../../../Utilities/Utilities";
import { AuthSessionService } from '../../../../../core/services/auth/auth-session.service';
import { finalize, forkJoin, of, switchMap } from 'rxjs';

/**
 * WorkflowEditorComponent
 * Displays a primary header bar with workflow name centered and a two-column layout:
 * - Left narrow column: vertical stages list (adapted from locations carousel but vertical)
 * - Right column: placeholder for future workflow editing forms
 */
@Component({
  selector: "dw-workflow-editor",
  standalone: true,
  // Added FormsModule so (ngSubmit) works (prevents native form submission / page reload)
  imports: [CommonModule, FormsModule, DragDropModule, NonNegativeNumberDirective, RouterModule],
  templateUrl: "./workflow-editor.component.html",
  styleUrl: "./workflow-editor.component.scss",
})
export class WorkflowEditorComponent implements OnInit {
  workflowLocationId: number | null = null;
  workflowStatus: number = 1;
  ngOnInit(): void {
    // ...existing code...
    this.ensureStageTypes();
    this.route.paramMap.subscribe((p) => {
      const raw = p.get("id");
      this.workflowId = raw ? Number(raw) : null;
      if (this.workflowId != null && !Number.isNaN(this.workflowId)) {
        // Load workflow details
        const params: any[] = ['R', this.workflowId, null, null, null, null, null];
        const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_workflows_crud, parameters: params };
        this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
          next: res => {
            if (res.ok && res.data) {
              const wf = res.data[0][0];

              this.workflowLocationId = wf.id_location;
              this.workflowStatus = wf.is_active;
              this.workflowName.set(wf.name ?? ''); 
            }
          },
          error: err => {
            Utilities.showToast('Failed to load workflow details', 'error');
          }
        });
        this.loadWorkflow();
        this.loadStages();
      } else {
        this.error.set("Invalid workflow id");
      }
    });
  }
  // --- Workflow name editing state ---
  editingWorkflowName = false;
  workflowNameEditValue = '';

  startWorkflowNameEdit(): void {
    this.workflowNameEditValue = this.workflowName();
    this.editingWorkflowName = true;
  }

  cancelWorkflowNameEdit(): void {
    this.editingWorkflowName = false;
    this.workflowNameEditValue = '';
  }

  confirmWorkflowNameEdit(): void {
    const newName = this.workflowNameEditValue.trim();
    if (!newName || newName === this.workflowName()) {
      this.cancelWorkflowNameEdit();
      return;
    }
    if (!this.workflowId) {
      Utilities.showToast('Workflow ID missing', 'error');
      return;
    }
    const currentUser = this.authSession.user?.user || 'system';
    const params: any[] = [
      'U',
      this.workflowId,
      this.workflowLocationId,
      newName,
      this.workflowStatus ? 1 : 0,
      null, // created_by
      currentUser // updated_by
    ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_workflows_crud, parameters: params };
    this.loading.set(true);
    this.core.executeCommand<DriveWhipCommandResponse>(api).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: res => {
        if (!res.ok) {
          Utilities.showToast('Failed to update workflow name', 'error');
          return;
        }
        this.workflowName.set(newName);
        Utilities.showToast('Workflow name updated', 'success');
        this.cancelWorkflowNameEdit();
      },
      error: err => {
        console.error('[WorkflowEditor] update workflow name error', err);
        Utilities.showToast('Error updating workflow name', 'error');
      }
    });
  }
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

  // Show some parts of the UI also for Custom stages
  readonly customVisible = computed(() => {
    const stId = this.selectedStageId();
    if (!stId) return false;
    const st = this.stages().find(s => s.id_stage === stId);
    return st?.type === 'Custom';
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
  // Catalogs for rules
  readonly conditionTypes = signal<any[]>([]); // { id_condition_type, condition }
  readonly dataKeys = signal<any[]>([]); // { id_datakey, datakey }
  readonly operators = signal<any[]>([]); // { id_operator, operator }
  readonly actionsCatalog = signal<any[]>([]); // { id_action, action, is_active }
  readonly reasonsCatalog = signal<any[]>([]); // { id_reason, reason, is_active }

  // Unified rule rows (condition + action + meta)
  readonly ruleRows = signal<RuleRow[]>([]);
  readonly rulesDirty = computed(()=> this.ruleRows().some(r=>r.dirty));

  // --- Creation Modals (Stage & Rule) ---
  readonly showAddStageModal = signal(false);
  readonly showAddRuleModal = signal(false);
  readonly stageTypesLoading = signal(false);
  readonly stageTypesError = signal<string | null>(null);
  readonly stageTypeOptions = signal<{ id: number; label: string; is_active: boolean }[]>([]);
  // Data Collection forms catalog (for Add Stage when type = Data Collection)
  readonly dcFormsLoading = signal(false);
  readonly dcFormsError = signal<string | null>(null);
  readonly dcFormOptions = signal<{ code: string; name: string }[]>([]);
  // Dynamic placement model replaced: use 'top' or select a stage id to insert AFTER that stage.
  // Dynamic rule types catalog
  readonly ruleTypesLoading = signal(false);
  readonly ruleTypesError = signal<string | null>(null);
  readonly ruleTypeOptions = signal<{ id: number; code: string; name: string; is_active: boolean }[]>([]);
  // Forms
  newStageName = signal('');
  newStageTypeId = signal<number | null>(null);
  newStageFormCode = signal<string | null>(null); // only for Data Collection
  // Whether current newStageTypeId corresponds to Data Collection
  readonly isAddingDataCollection = computed(() => {
    const typeId = this.newStageTypeId();
    if (!typeId) return false;
    const match = this.stageTypeOptions().find(t => t.id === typeId);
    return (match?.label || '').toLowerCase() === 'data collection';
  });
  // Placement: 'top' or stringified id_stage of the stage AFTER which to insert
  newStagePlacement = signal('top');
  newRuleValue = signal('');
  newRuleTypeId = signal<number | null>(null);
  newRulePlacement = signal('end');
  private tempStageIdCounter = -1; // negative ids for newly added unsaved stages

  openAddStageModal(): void { this.resetStageForm(); this.showAddStageModal.set(true); }
  openAddRuleModal(): void { this.resetRuleForm(); this.showAddRuleModal.set(true); }
  closeAddStageModal(): void { this.showAddStageModal.set(false); }
  closeAddRuleModal(): void { this.showAddRuleModal.set(false); }
  private resetStageForm(): void {
    this.newStageName.set('');
    this.newStageTypeId.set(null);
    this.newStagePlacement.set('top');
    this.newStageFormCode.set(null);
    this.ensureStageTypes();
  }
  private resetRuleForm(): void { this.newRuleValue.set(''); this.newRuleTypeId.set(null); this.newRulePlacement.set('end'); this.ensureRuleTypes(); }

  readonly newStageSaving = signal(false);

  confirmAddStage(): void {
    if (!this.newStageName().trim() || !this.newStageTypeId()) { Utilities.showToast('Stage name & type required','warning'); return; }
    // If Data Collection selected and we show the Form selector, require a selection
    if (this.isAddingDataCollection() && !this.newStageFormCode()) {
      Utilities.showToast('Select a Form for Data Collection','warning');
      return;
    }
    if (this.workflowId == null) { Utilities.showToast('Workflow context missing','error'); return; }
    if (this.newStageSaving()) return;

    const placement = this.newStagePlacement(); // 'top' or stage id string
    const stagesSnapshot = [...this.stages()].sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
    // Determine pivot order (K). If 'top' => K = 0 (insert before first). Else find selected stage order.
    let pivotOrder = 0;
    if (placement !== 'top') {
      const pivotStage = stagesSnapshot.find(s => String(s.id_stage) === placement);
      if (!pivotStage) {
        Utilities.showToast('Selected reference stage not found, inserting at end','warning');
        pivotOrder = stagesSnapshot.length ? (stagesSnapshot[stagesSnapshot.length-1].sort_order || stagesSnapshot.length) : 0;
      } else {
        pivotOrder = pivotStage.sort_order || 0;
      }
    }

    // Build update calls for stages with order > pivotOrder (shift +1). Process in descending order to avoid unique conflicts.
    const toShift = stagesSnapshot.filter(s => (s.sort_order||0) > pivotOrder).sort((a,b)=>(b.sort_order||0)-(a.sort_order||0));
    const currentUser = this.authSession.user?.user || 'system';
    const shiftCalls = toShift.map(stage => {
      const params: any[] = [
        'U',
        stage.id_stage,
        this.workflowId,
        stage.id_stage_type,
        stage.name,
        (stage.sort_order||0) + 1,
        1,
        null,
        currentUser,
        stage.form_code ?? null
      ];
      const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_crud, parameters: params };
      return this.core.executeCommand<DriveWhipCommandResponse>(api);
    });

    // New stage order will be pivotOrder + 1
    const newSortOrder = pivotOrder + 1;
    const createParams: any[] = [
      'C',
      null,
      this.workflowId,
      this.newStageTypeId(),
      this.newStageName().trim(),
      newSortOrder,
      1,
      currentUser,
      null,
      this.isAddingDataCollection() ? (this.newStageFormCode() ?? null) : null
    ];
    const createApi: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_crud, parameters: createParams };

    this.newStageSaving.set(true);
    (shiftCalls.length ? forkJoin(shiftCalls) : of([{ ok: true } as any])).pipe(
      switchMap(shiftResults => {
        const allShiftOk = shiftResults.every(r => r && r.ok);
        if (!allShiftOk) {
          Utilities.showToast('Failed shifting existing stages','error');
          return of(null);
        }
        return this.core.executeCommand<DriveWhipCommandResponse>(createApi);
      }),
      finalize(()=> this.newStageSaving.set(false))
    ).subscribe({
      next: res => {
        if (!res || !res.ok) {
          Utilities.showToast('Failed to create stage','error');
          return;
        }
        Utilities.showToast('Stage created','success');
        this.closeAddStageModal();
        this.loadStages(); // refresh list to reflect new ordering
      },
      error: err => {
        console.error('[WorkflowEditor] create stage error', err);
        Utilities.showToast('Error creating stage','error');
      }
    });
  }

  // Load available Data Collection forms (one-time fetch while modal is open)
  ensureDcForms(): void {
    if (!this.isAddingDataCollection()) return; // only relevant when DC is selected
    if (this.dcFormsLoading() || this.dcFormOptions().length > 0) return;
    this.dcFormsLoading.set(true);
    this.dcFormsError.set(null);
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_datacollections_forms as any, parameters: ['R', null, null, null, null, null] };
    this.core.executeCommand<DriveWhipCommandResponse>(api).pipe(finalize(()=> this.dcFormsLoading.set(false))).subscribe({
      next: res => {
        if (!res || !res.ok) { this.dcFormsError.set('Failed to load forms'); return; }
        let rows: any[] = [];
        if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
        const mapped = (rows || []).map(r => ({
          code: r.form_code ?? r.code ?? r.id ?? '',
          name: r.form_name ?? r.name ?? r.description ?? r.title ?? (r.form_code ?? 'Unnamed')
        })).filter(x => x.code);
        this.dcFormOptions.set(mapped);
        // If only one option, preselect for convenience
        if (mapped.length === 1) this.newStageFormCode.set(mapped[0].code);
      },
      error: () => this.dcFormsError.set('Failed to load forms')
    });
  }

  confirmAddRule(): void {
    if (!this.newRuleValue().trim() || !this.newRuleTypeId()) { Utilities.showToast('Rule value & type required','warning'); return; }
    if (this.workflowId == null) { Utilities.showToast('Workflow context missing','error'); return; }
    if (this.newStageSaving()) return;

    // Find id_stage_type for label 'Rules'
    const rulesType = this.stageTypeOptions().find(st => st.label === 'Rules');
    if (!rulesType) { Utilities.showToast('No stage type "Rules" found','error'); return; }

    const placement = this.newStagePlacement(); // 'top' or stage id string
    const stagesSnapshot = [...this.stages()].sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
    let pivotOrder = 0;
    if (placement !== 'top') {
      const pivotStage = stagesSnapshot.find(s => String(s.id_stage) === placement);
      if (!pivotStage) {
        Utilities.showToast('Selected reference stage not found, inserting at end','warning');
        pivotOrder = stagesSnapshot.length ? (stagesSnapshot[stagesSnapshot.length-1].sort_order || stagesSnapshot.length) : 0;
      } else {
        pivotOrder = pivotStage.sort_order || 0;
      }
    }
    // Shift stages after pivot
    const toShift = stagesSnapshot.filter(s => (s.sort_order||0) > pivotOrder).sort((a,b)=>(b.sort_order||0)-(a.sort_order||0));
    const currentUser = this.authSession.user?.user || 'system';
    const shiftCalls = toShift.map(stage => {
      const params: any[] = [
        'U',
        stage.id_stage,
        this.workflowId,
        stage.id_stage_type,
        stage.name,
        (stage.sort_order||0) + 1,
        1,
        null,
        currentUser
      ];
      const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_crud, parameters: params };
      return this.core.executeCommand<DriveWhipCommandResponse>(api);
    });
    // New stage order will be pivotOrder + 1
    const newSortOrder = pivotOrder + 1;
    const createParams: any[] = [
      'C',
      null,
      this.workflowId,
      rulesType.id,
      this.newRuleValue().trim(),
      newSortOrder,
      1,
      currentUser,
      null,
      null
    ];
    const createApi: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_crud, parameters: createParams };
    this.newStageSaving.set(true);
    (shiftCalls.length ? forkJoin(shiftCalls) : of([{ ok: true } as any])).pipe(
      switchMap(shiftResults => {
        const allShiftOk = shiftResults.every(r => r && r.ok);
        if (!allShiftOk) {
          Utilities.showToast('Failed shifting existing stages','error');
          return of(null);
        }
        return this.core.executeCommand<DriveWhipCommandResponse>(createApi);
      }),
      finalize(()=> this.newStageSaving.set(false))
    ).subscribe({
      next: res => {
        if (!res || !res.ok) {
          Utilities.showToast('Failed to create Rules stage','error');
          return;
        }
        Utilities.showToast('Rules stage created','success');
        this.closeAddRuleModal();
        this.loadStages();
      },
      error: err => {
        console.error('[WorkflowEditor] create Rules stage error', err);
        Utilities.showToast('Error creating Rules stage','error');
      }
    });
  }

  ensureRuleTypes(): void {
    if (this.ruleTypesLoading()) return;
    if (this.ruleTypeOptions().length) return; // already loaded
    this.ruleTypesLoading.set(true); this.ruleTypesError.set(null);
    const params: any[] = ['R', null, null, null, null, null, null];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_rules_types_crud as any, parameters: params };
    this.core.executeCommand<DriveWhipCommandResponse>(api).pipe(finalize(()=> this.ruleTypesLoading.set(false))).subscribe({
      next: res => {
        if (!res.ok) { this.ruleTypesError.set('Failed to load rule types'); return; }
        let rows: any[] = [];
        if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
        const mapped = rows.map(r => ({ id: r.id_rule_type, code: r.code, name: r.name, is_active: r.is_active !== 0 && r.is_active !== false }));
        this.ruleTypeOptions.set(mapped.filter(r=>r.name));
      },
      error: () => this.ruleTypesError.set('Failed to load rule types')
    });
  }

  private createEmptyRuleRow(): RuleRow {
    return {
      id: null,
      condition_type_id: null,
      datakey_id: null,
      operator_id: null,
      value: '',
      action_id: null,
      reason_id: null,
      isActive: true,
      dirty: true,
      origin: undefined
    };
  }

  addRuleRow(origin?: 'C' | 'A'): void {
    const list = [...this.ruleRows()];
    const row = this.createEmptyRuleRow();
    row.origin = origin;
    list.push(row);
    this.ruleRows.set(list);
  }

  // Wrappers para semántica en UI
  addConditionRow(): void { this.addRuleRow('C'); }
  addActionRow(): void { this.addRuleRow('A'); }

  updateRuleRow(index: number, field: keyof RuleRow, value: any): void {
    const list = [...this.ruleRows()];
    if (index < 0 || index >= list.length) return;
    const row = { ...list[index], [field]: value } as RuleRow;
    row.dirty = true;
    list[index] = row;
    this.ruleRows.set(list);
  }

  removeRuleRow(index: number): void {
    const list = [...this.ruleRows()];
    if (index < 0 || index >= list.length) return;
    const row = list[index];
    if (row.id) {
      this.saveRuleRow(index, 'D'); // soft delete
    } else {
      list.splice(index,1);
      this.ruleRows.set(list.length?list:[this.createEmptyRuleRow()]);
    }
  }

  trackRuleRow = (i:number, item: RuleRow) => item.id ?? i;

  loadRuleRows(stageId: number, idSection: number | null): void {
    if (!stageId) return;
    const params: any[] = ['R', null, null, null, null, null, null, null, null, null, null, null, null];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_rule_crud as any, parameters: params };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        if (!res.ok) { this.rulesError.set('Failed to load rules'); return; }
        let rows: any[] = [];
        if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
        const filtered = rows.filter(r => Number(r.id_stage) === stageId && (!idSection || Number(r.id_stage_section) === idSection));
        const mapped: RuleRow[] = filtered.map(r => {
          const rawActive = r.is_active;
            const active = rawActive === 1 || rawActive === '1' || rawActive === true || (typeof rawActive === 'string' && rawActive.toLowerCase()==='true');
          return {
            id: Number(r.id_stage_section_rule),
            condition_type_id: r.id_condition_type != null ? Number(r.id_condition_type) : null,
            datakey_id: r.id_datakey != null ? Number(r.id_datakey) : null,
            operator_id: r.id_operator != null ? Number(r.id_operator) : null,
            value: r.value || '',
            action_id: r.id_action != null ? Number(r.id_action) : null,
            reason_id: r.id_reason != null ? Number(r.id_reason) : null,
            isActive: active,
            dirty: false
          };
        });
        this.ruleRows.set(mapped.length?mapped:[this.createEmptyRuleRow()]);
      },
      error: () => this.rulesError.set('Failed to load rules')
    });
  }

  saveRuleRow(index: number, forcedAction?: 'C'|'U'|'D'): void {
    const list = [...this.ruleRows()];
    if (index < 0 || index >= list.length) return;
    const row = { ...list[index] };
    const stageId = this.selectedStageId();
    if (!stageId) { Utilities.showToast('Select a stage first','warning'); return; }
    const sectionId = this.rulesSectionId();
    if (!sectionId) { Utilities.showToast('Rules section missing','warning'); return; }
    const isCreate = row.id == null;
    const action = forcedAction ? forcedAction : (isCreate ? 'C' : 'U');
    if (action !== 'D') {
      if (!row.condition_type_id || !row.datakey_id || !row.operator_id) {
        Utilities.showToast('Complete condition fields','warning'); return; }
      if (!row.action_id) { Utilities.showToast('Select action type','warning'); return; }
      if (!row.reason_id) { Utilities.showToast('Select reason','warning'); return; }
    }
    row.saving = true; row.error = undefined; list[index]=row; this.ruleRows.set(list);
    const currentUser = this.authSession.user?.user || 'system';
    const params: any[] = [
      action,                 // p_action
      row.id,                 // p_id_stage_section_rule
      sectionId,              // p_id_stage_section
      stageId,                // p_id_stage
      row.condition_type_id,  // p_id_condition_type
      row.reason_id,          // p_id_reason
      row.datakey_id,         // p_id_datakey
      row.operator_id,        // p_id_operator
      row.action_id,          // p_id_action
      row.isActive ? 1 : 0,   // p_is_active
      row.value || null,      // p_value
      isCreate ? currentUser : null, // p_created_by
      isCreate ? null : currentUser  // p_updated_by
    ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_rule_crud as any, parameters: params };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        row.saving = false;
        if (!res.ok) { row.error='Save failed'; list[index]=row; this.ruleRows.set(list); return; }
        Utilities.showToast(action==='D' ? 'Rule disabled' : (isCreate ? 'Rule created' : 'Rule updated'),'success');
        // reload to refresh ids & baseline
        this.loadRuleRows(stageId, sectionId);
      },
      error: ()=> { row.saving=false; row.error='Save failed'; list[index]=row; this.ruleRows.set(list); }
    });
  }

  toggleRuleActive(index: number, active: boolean): void { this.updateRuleRow(index,'isActive', active); }

  // Section id for rules
  readonly rulesSectionId = signal<number | null>(null);
  private loadRulesSection(stageId: number): void {
    // Reuse crm_stages_sections_crud to obtain id_stage_section for Rules (section_type 2)
    const sectionTypeId = this.sectionTypeIdForStage(stageId); // should be 2 for Rules
    if (sectionTypeId !== 2) { this.rulesSectionId.set(null); return; }
    const params: any[] = [ 'R', null, stageId, sectionTypeId, null, null, null, null, null, null, null, null ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_crud, parameters: params };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        if (!res.ok) { return; }
        let rows: any[] = []; if (Array.isArray(res.data)) rows = Array.isArray(res.data[0])? res.data[0] : (res.data as any[]);
        const match = rows.find(r => r.id_stage === stageId);
        if (match) this.rulesSectionId.set(match.id_stage_section); else this.rulesSectionId.set(null);
        // Load existing rule rows now that we know section id (or null for filtering by stage only)
        this.loadRuleRows(stageId, this.rulesSectionId());
      },
      error: ()=> {}
    });
  }

  // Placeholder action for Idle Move Rule button (future: open modal / add rule object)
  // Idle Move Rule state
  readonly idleMoveDays = signal<number>(0);
  readonly idleTargetStageId = signal<number | null>(null);
  // Default was true causing the toggle to appear active when no record exists.
  // Set to false so an empty (non-configured) rule shows all switches off.
  readonly idleSendAutomatedMessages = signal<boolean>(false);
  readonly idleIgnoreApplicantAction = signal<boolean>(false);
  // Idle Move persistence signals
  readonly idleMoveRecordId = signal<number | null>(null); // id_stage_section_idlemove
  readonly idleMoveOriginal = signal<{ days: number; targetStageId: number | null; sendMsgs: boolean; ignoreAction: boolean } | null>(null);
  readonly idleMoveSaving = signal<boolean>(false);
  readonly idleMoveLoading = signal<boolean>(false);
  readonly idleMoveError = signal<string | null>(null);
  readonly idleMoveDirty = computed(() => {
    const orig = this.idleMoveOriginal();
    if (!orig) {
      // Baseline for a non-existing rule: days=0, targetStageId=null, sendMsgs=false, ignoreAction=false
      return this.idleMoveDays() !== 0 || this.idleTargetStageId() !== null || this.idleSendAutomatedMessages() !== false || this.idleIgnoreApplicantAction() !== false;
    }
    return orig.days !== this.idleMoveDays() ||
      orig.targetStageId !== this.idleTargetStageId() ||
      orig.sendMsgs !== this.idleSendAutomatedMessages() ||
      orig.ignoreAction !== this.idleIgnoreApplicantAction();
  });

  resetIdleMoveState(): void {
    this.idleMoveRecordId.set(null);
    this.idleMoveDays.set(0);
    this.idleTargetStageId.set(null);
  this.idleSendAutomatedMessages.set(false);
    this.idleIgnoreApplicantAction.set(false);
    this.idleMoveOriginal.set(null);
  }

  private loadIdleMove(stageId: number, idSection: number | null): void {
    if (!stageId) return;
    // Need data section id to create new record; existing record read does not strictly require it but p_id_stage_section is stored
    this.idleMoveLoading.set(true);
    this.idleMoveError.set(null);
    // READ all and filter client side (SP filters only by primary key when provided)
    const params: any[] = ['R', null, null, null, null, null, null, null, null, null, null];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_idlemove_crud, parameters: params } as any;
    this.core.executeCommand<DriveWhipCommandResponse>(api).pipe(finalize(()=> this.idleMoveLoading.set(false))).subscribe({
      next: res => {
        if (!res.ok) { this.idleMoveError.set('Failed to load idle move rule'); return; }
        let rows: any[] = [];
        if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
        // normalize numeric fields
        rows = rows.map(r => ({
          ...r,
          id_stage: r.id_stage != null ? Number(r.id_stage) : r.id_stage,
          id_stage_section: r.id_stage_section != null ? Number(r.id_stage_section) : r.id_stage_section,
          id_stage_section_idlemove: r.id_stage_section_idlemove != null ? Number(r.id_stage_section_idlemove) : r.id_stage_section_idlemove,
          delay_days: r.delay_days != null ? Number(r.delay_days) : r.delay_days,
          id_stage_target: r.id_stage_target != null ? Number(r.id_stage_target) : r.id_stage_target,
          send_automathic_message: !!r.send_automathic_message,
          ignore_applicant_action: !!r.ignore_applicant_action,
          is_active: (r.is_active === 1 || r.is_active === '1' || r.is_active === true) ? 1 : 0
        }));
        let match = rows.find(r => r.id_stage === stageId && (idSection ? r.id_stage_section === idSection : true));
        if (!match) match = rows.find(r => r.id_stage === stageId);
        if (match) {
          this.idleMoveRecordId.set(match.id_stage_section_idlemove);
          this.idleMoveDays.set(match.delay_days ?? 0);
            this.idleTargetStageId.set(match.id_stage_target ?? null);
          this.idleSendAutomatedMessages.set(!!match.send_automathic_message);
          this.idleIgnoreApplicantAction.set(!!match.ignore_applicant_action);
          this.idleMoveOriginal.set({
            days: this.idleMoveDays(),
            targetStageId: this.idleTargetStageId(),
            sendMsgs: this.idleSendAutomatedMessages(),
            ignoreAction: this.idleIgnoreApplicantAction()
          });
        } else {
          // keep reset state
          this.resetIdleMoveState();
        }
      },
      error: () => this.idleMoveError.set('Failed to load idle move rule')
    });
  }

  saveIdleMove(): void {
    const stageId = this.selectedStageId();
    if (!stageId) { Utilities.showToast('Select a stage first', 'warning'); return; }
    const idSection = this.dataSectionId();
    if (!idSection) { Utilities.showToast('Data collection section required first', 'warning'); return; }
    const isCreate = this.idleMoveRecordId() == null;
    const action = isCreate ? 'C' : 'U';
    const currentUser = this.authSession.user?.user || 'system';
    // SP signature (provided):
    // (p_action, p_id_stage_section_idlemove, p_id_stage_section, p_id_stage, p_delay_days,
    //  p_id_stage_target, p_send_automathic_message, p_ignore_applicant_action, p_is_active,
    //  p_created_by, p_updated_at)
    // Nota: En el cuerpo del SP se usa p_updated_by pero NO existe en la firma -> inconsistencia.
    // Para evitar el error de tipo datetime enviamos NULL (o una fecha válida) en el último parámetro.
    const params: any[] = [
      action,                                 // p_action
      isCreate ? null : this.idleMoveRecordId(), // p_id_stage_section_idlemove
      idSection,                              // p_id_stage_section
      stageId,                                // p_id_stage
      this.idleMoveDays(),                    // p_delay_days
      this.idleTargetStageId(),               // p_id_stage_target
      this.idleSendAutomatedMessages() ? 1 : 0, // p_send_automathic_message
      this.idleIgnoreApplicantAction() ? 1 : 0, // p_ignore_applicant_action
      1,                                      // p_is_active (hardcoded active for now)
      isCreate ? currentUser : null,          // p_created_by (solo en create)
      null                                    // p_updated_at (SP ya usa CURRENT_TIMESTAMP internamente)
    ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_idlemove_crud, parameters: params } as any;
    this.idleMoveSaving.set(true);
    this.core.executeCommand<DriveWhipCommandResponse>(api).pipe(finalize(()=> this.idleMoveSaving.set(false))).subscribe({
      next: res => {
        // Detect SP mismatch error pattern (throwMessageTricode nested with Unknown column 'p_updated_by')
        if (res.data) {
          try {
            const serialized = JSON.stringify(res.data);
            if (serialized.includes("Unknown column 'p_updated_by'")) {
              Utilities.showToast('Idle Move SP needs parameter p_updated_by or remove its reference. See instructions.', 'error');
              console.error('[IdleMoveRule] Stored procedure mismatch: add IN p_updated_by VARCHAR(250) to signature and use it in UPDATE/DELETE, or remove updated_by = p_updated_by line.');
              return;
            }
          } catch { /* ignore */ }
        }
        if (!res.ok) { Utilities.showToast('Failed to save idle move rule', 'error'); return; }
        Utilities.showToast(isCreate ? 'Idle move rule created' : 'Idle move rule updated', 'success');
        // reload to capture id and baseline
        this.loadIdleMove(stageId, idSection);
      },
      error: () => Utilities.showToast('Failed to save idle move rule', 'error')
    });
  }

  onIdleDaysChange(raw: any): void {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      this.idleMoveDays.set(0);
    } else {
      this.idleMoveDays.set(Math.floor(n));
    }
  }

  onIdleTargetStageChange(raw: any): void {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) {
      this.idleTargetStageId.set(null);
    } else {
      this.idleTargetStageId.set(v);
    }
  }

  toggleIdleSendAutomatedMessages(flag: boolean): void {
    this.idleSendAutomatedMessages.set(flag);
  }

  // =============================
  // Follow-Up Messages Section
  // =============================
  interfaceFollowUpDummy?: any; // anchor comment to keep patch minimal
  readonly followUps = signal<{
    id: number | null; // id_stage_section_followup
    templateId: number | null;
    delivery: string | null;
    delayDays: number; // we'll store in days, convert to minutes
    isActive: boolean;
    created_by?: string | null;
    updated_by?: string | null;
    saving?: boolean;
    error?: string | null;
    dirty?: boolean; // local dirty tracking
  }[]>([]);
  readonly followUpsLoading = signal<boolean>(false);
  readonly followUpsError = signal<string | null>(null);
  readonly followUpsDirty = computed(()=> this.followUps().some(f=>f.dirty));
  private followUpsDeferredRebind = false; // marca si cargamos followUps antes de catálogos

  private makeEmptyFollowUp(): any {
    return { id: null, templateId: null, delivery: null, delayDays: 0, isActive: true, dirty: true };
  }

  addFollowUpForm(): void {
    const list = [...this.followUps()];
    list.push(this.makeEmptyFollowUp());
    this.followUps.set(list);
  }

  trackFollowUp = (index: number, item: any) => item?.id ?? index;

  removeFollowUpForm(index: number): void {
    const list = [...this.followUps()];
    if (index < 0 || index >= list.length) return;
    const rec = list[index];
    // If it's persisted (has id) we perform a soft delete via SP (action 'D')
    if (rec.id) {
      this.saveFollowUp(index, 'D');
    } else {
      list.splice(index,1);
      this.followUps.set(list);
    }
  }

  updateFollowUpField(index: number, field: 'templateId'|'delivery'|'delayDays'|'isActive', value: any): void {
    const list = [...this.followUps()];
    if (index < 0 || index >= list.length) return;
    const rec = { ...list[index] };
    (rec as any)[field] = field === 'delayDays' ? Number(value)||0 : value;
    rec.dirty = true;
    list[index] = rec;
    this.followUps.set(list);
  }

  loadFollowUps(stageId: number, idSection: number | null): void {
    if (!stageId) return;
    this.followUpsLoading.set(true);
    this.followUpsError.set(null);
    // A menudo el problema de que no se ve el valor seleccionado NO es el nombre del campo,
    // sino que los catálogos (templates / delivery) todavía no se han cargado cuando el <select>
    // se pinta por primera vez. Se estaban cargando sólo al hacer focus. Aquí forzamos su carga
    // temprana para que, cuando lleguen los rows, ya existan (o estén en curso) las opciones.
    if (this.notificationTemplates().length === 0 || this.deliveryMethods().length === 0) {
      // Marcamos rebind diferido y disparamos la carga de catálogos.
      this.followUpsDeferredRebind = true;
      this.ensureInitialMessageCatalogs();
    }
    const params: any[] = ['R', null, null, null, null, null, null, null, null, null];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_followup_crud as any, parameters: params };
    this.core.executeCommand<DriveWhipCommandResponse>(api).pipe(finalize(()=> this.followUpsLoading.set(false))).subscribe({
      next: res => {
        if (!res.ok) { this.followUpsError.set('Failed to load follow-up messages'); return; }
        let rows: any[] = [];
        if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
        const filtered = rows.filter(r => Number(r.id_stage) === stageId && (!idSection || Number(r.id_stage_section) === idSection));
        const mapped = filtered.map(r => {
          const rawActive = r.is_active;
          const isActive = (
            rawActive === 1 || rawActive === '1' || rawActive === true ||
            (typeof rawActive === 'string' && rawActive.toLowerCase() === 'true')
          );
          return {
            id: Number(r.id_stage_section_followup),
            templateId: r.id_template != null ? Number(r.id_template) : null,
            delivery: r.delivery_method || null,
            // Backend field is delay_days (adjusted); keep backward compatibility with delay_minutes just in case
            delayDays: (r.delay_days ?? r.delay_minutes ?? 0),
            isActive: isActive,
            created_by: r.created_by,
            updated_by: r.updated_by,
            dirty: false
          };
        }).sort((a,b)=> a.delayDays - b.delayDays || (a.id ?? 0) - (b.id ?? 0));
        if (filtered.length && !mapped.length) {
          console.warn('[FollowUps] Rows filtered but mapping empty. Check field names.', filtered[0]);
        }
        if (mapped.length === 0) {
          // Provide an empty slot by default for quicker creation
          this.followUps.set([ this.makeEmptyFollowUp() ]);
        } else {
          this.followUps.set(mapped);
        }
        // Intentar re-vincular selects si los catálogos ya están cargados
        this.tryRebindFollowUps();
        // Sincronizar valor en el DOM (caso raro donde el browser no selecciona tras insertar options)
        setTimeout(()=> this.forceFollowUpsDomSync(), 0);
      },
      error: () => this.followUpsError.set('Failed to load follow-up messages')
    });
  }

  saveFollowUp(index: number, forcedAction?: 'C'|'U'|'D'): void {
    const list = [...this.followUps()];
    if (index < 0 || index >= list.length) return;
    const rec = { ...list[index] };
    const stageId = this.selectedStageId();
    if (!stageId) { Utilities.showToast('Select a stage first', 'warning'); return; }
    const idSection = this.dataSectionId();
    if (!idSection) { Utilities.showToast('Data collection section required first', 'warning'); return; }
    const currentUser = this.authSession.user?.user || 'system';
    const isCreate = rec.id == null;
    const action = forcedAction ? forcedAction : (isCreate ? 'C' : 'U');
    if (action !== 'D') {
      if (!rec.templateId || !rec.delivery) { Utilities.showToast('Template and delivery required', 'warning'); return; }
    }
    rec.saving = true;
    list[index] = rec; this.followUps.set(list);
    const params: any[] = [
      action,                   // p_action
      rec.id,                   // p_id_stage_section_followup
      idSection,                // p_id_stage_section
      stageId,                  // p_id_stage
      rec.templateId,           // p_id_template
      rec.delivery,             // p_delivery_method
      rec.delayDays,            // p_delay_days
      rec.isActive ? 1 : 0,     // p_is_active (normalize to numeric)
      isCreate ? currentUser : null, // p_created_by only on create
      !isCreate ? currentUser : null  // p_updated_by only on update/delete
    ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_followup_crud as any, parameters: params };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        rec.saving = false;
        if (!res.ok) { rec.error = 'Save failed'; } else {
          Utilities.showToast(action==='D' ? 'Follow-up disabled' : (isCreate ? 'Follow-up created' : 'Follow-up updated'),'success');
          rec.dirty = false;
          if (action === 'D') { rec.isActive = false; }
          // Refresh to ensure ids and ordering
          this.loadFollowUps(stageId, idSection);
          return; // skip assigning local copy because reload will replace
        }
        list[index] = rec; this.followUps.set(list);
      },
      error: ()=> {
        rec.saving = false; rec.error='Save failed'; list[index]=rec; this.followUps.set(list);
      }
    });
  }

  toggleFollowUpActive(index: number, active: boolean): void {
    this.updateFollowUpField(index, 'isActive', active);
  }

  toggleIdleIgnoreApplicantAction(flag: boolean): void {
    this.idleIgnoreApplicantAction.set(flag);
  }

  // --- Initial Message (Data Collection) ---
  readonly initialMessageDelayMins = signal<number>(0);
  readonly initialMessageDisabled = signal<boolean>(false);
  readonly initialMessageExpanded = signal<boolean>(false); // controls showing the form
  readonly notificationTemplates = signal<any[]>([]); // { id, description, type, subject, body, ... }
  readonly deliveryMethods = signal<any[]>([]); // { description, value }
  readonly selectedTemplateId = signal<number | null>(null);
  readonly selectedDeliveryMethod = signal<string>('');
  readonly initialMessageLoading = signal<boolean>(false);
  readonly initialMessageError = signal<string | null>(null);
  readonly initialMessageSaving = signal<boolean>(false);
  readonly initialMessageRecordId = signal<number | null>(null); // id_stage_section_initialmessage
  readonly initialMessageOriginal = signal<{ templateId: number | null; delivery: string; delay: number; disabled: boolean } | null>(null);
  readonly currentTemplate = computed(() => this.notificationTemplates().find(t => t.id === this.selectedTemplateId()) || null);
  readonly initialMessageDirty = computed(() => {
    const orig = this.initialMessageOriginal();
    if (!orig) return this.selectedTemplateId() !== null || !!this.selectedDeliveryMethod() || this.initialMessageDelayMins() !== 0 || this.initialMessageDisabled() !== false;
    return orig.templateId !== this.selectedTemplateId() ||
      orig.delivery !== this.selectedDeliveryMethod() ||
      orig.delay !== this.initialMessageDelayMins() ||
      orig.disabled !== this.initialMessageDisabled();
  });

  // Human readable status label (for potential badge usage in template)
  readonly initialMessageStatusLabel = computed(() => {
    if (!this.initialMessageRecordId()) {
      return this.initialMessageDirty() ? 'NEW (Unsaved)' : 'Not configured';
    }
    if (this.initialMessageDisabled()) {
      return this.initialMessageDirty() ? 'Disabled* (Unsaved changes)' : 'Disabled';
    }
    return this.initialMessageDirty() ? 'Active* (Unsaved changes)' : 'Active';
  });

  // Optional explanation text for why save/update is disabled (for tooltip)
  readonly initialMessageSaveDisabledReason = computed(() => {
    if (this.initialMessageSaving()) return 'Saving…';
    if (!this.selectedTemplateId()) return 'Select a message template';
    if (!this.selectedDeliveryMethod()) return 'Select a delivery method';
    if (!this.initialMessageDirty()) return 'No changes to save';
    return '';
  });

  resetInitialMessageState(): void {
    this.initialMessageRecordId.set(null);
    this.selectedTemplateId.set(null);
    this.selectedDeliveryMethod.set('');
    this.initialMessageDelayMins.set(0);
    this.initialMessageDisabled.set(false);
    this.initialMessageOriginal.set(null);
  }

  toggleInitialMessageExpanded(): void {
    const next = !this.initialMessageExpanded();
    this.initialMessageExpanded.set(next);
    if (next) {
      this.ensureInitialMessageCatalogs();
    }
  }

  ensureInitialMessageCatalogs(): void {
    if (this.initialMessageLoading()) return;
    // If already loaded once, skip
    if (this.notificationTemplates().length > 0 && this.deliveryMethods().length > 0) {
      // Re-aplicar selección si ya había registro cargado pero select no reflejó (por timing)
      if (this.initialMessageRecordId()) {
        // Force trigger change detection by setting same values
        const tpl = this.selectedTemplateId();
        this.selectedTemplateId.set(tpl);
        const del = this.selectedDeliveryMethod();
        this.selectedDeliveryMethod.set(del);
      } else if (this.selectedStageId() && this.dataSectionId() && !this.initialMessageRecordId()) {
        // Intentar nuevamente cargar si antes no existía (posible carrera)
        this.reloadInitialMessage(this.selectedStageId()!, this.dataSectionId()!);
      }
      // Fuerza re-render de selects de Follow-Ups si opciones llegaron después del mapeo
      if (this.followUps().length) {
        const fuList = this.followUps();
        // Verificamos si algún followUp tiene templateId/delivery que SI existe en catálogos pero no se ve seleccionado
        const templateIds = new Set(this.notificationTemplates().map(t=> t.id));
        const deliveryVals = new Set(this.deliveryMethods().map(d=> d.value));
        let needsRefresh = false;
        for (const f of fuList) {
          if ((f.templateId && templateIds.has(f.templateId)) || (f.delivery && deliveryVals.has(f.delivery))) { needsRefresh = true; break; }
        }
        if (needsRefresh) {
          // Clonar para que Angular detecte nuevo array y re-aplique [value]
          this.followUps.set(fuList.map(f=> ({ ...f })));
        }
      }
      return;
    }
    this.initialMessageLoading.set(true);
    this.initialMessageError.set(null);
    const apiTemplates: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.notification_templates_crud, parameters: ['R', null, null, null, null, null, null, null] };
    const apiDelivery: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_deliveryMetod_options, parameters: [] };
    // Si los followUps ya se cargaron pero catálogos no, marcamos rebind diferido
    if (this.followUps().length && (this.notificationTemplates().length === 0 || this.deliveryMethods().length === 0)) {
      this.followUpsDeferredRebind = true;
    }
    forkJoin([
      this.core.executeCommand<DriveWhipCommandResponse>(apiTemplates),
      this.core.executeCommand<DriveWhipCommandResponse>(apiDelivery)
    ]).pipe(finalize(()=> this.initialMessageLoading.set(false))).subscribe({
      next: ([tplRes, delRes]) => {
        if (!tplRes.ok || !delRes.ok) {
          this.initialMessageError.set('Failed to load message catalogs');
          return;
        }
        const parseRows = (res: any) => {
          let rows: any[] = [];
          if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
          return rows || [];
        };
        // Normalización de catálogos para asegurar propiedades id / value / description consistentes
        const rawTpl = parseRows(tplRes).map((r:any)=> {
          const id = r.id ?? r.id_template ?? r.template_id ?? r.idNotificationTemplate;
          const description = r.description ?? r.template_description ?? r.subject ?? r.name ?? (`Template #${id}`);
          return { ...r, id, description };
        });
        const rawDel = parseRows(delRes).map((r:any)=> {
          const value = r.value ?? r.delivery_method ?? r.method ?? r.code ?? r.key;
          const description = r.description ?? r.label ?? r.delivery_method ?? r.name ?? value ?? 'Unknown';
          return { ...r, value, description };
        });
        this.notificationTemplates.set(rawTpl);
        this.deliveryMethods.set(rawDel);
        // Diagnóstico: verificar si algún followUp no encuentra su template/delivery
        if (this.followUps().length) {
          const tplIds = new Set(rawTpl.map(t=> String(t.id)));
            const delVals = new Set(rawDel.map(d=> String(d.value).toLowerCase()));
          const missing: any[] = [];
          this.followUps().forEach(f=> {
            if (f.templateId && !tplIds.has(String(f.templateId))) missing.push({ type:'template', templateId: f.templateId });
            if (f.delivery && !delVals.has(String(f.delivery).toLowerCase())) missing.push({ type:'delivery', delivery: f.delivery });
          });
          if (missing.length) {
            console.warn('[FollowUps][CatalogMismatch]', missing);
          }
        }
        // Después de cargar catálogos intentar poblar si había registro previo
        if (this.selectedStageId() && this.dataSectionId() && !this.initialMessageRecordId()) {
          this.reloadInitialMessage(this.selectedStageId()!, this.dataSectionId()!);
        }
        // Reforzar selección para que el select muestre valor cuando options llegan después
        if (this.initialMessageRecordId()) {
          const tpl = this.initialMessageOriginal()?.templateId ?? null;
          if (tpl) this.selectedTemplateId.set(tpl);
          const del = this.initialMessageOriginal()?.delivery ?? '';
          if (del) this.selectedDeliveryMethod.set(del);
        }
        if (this.followUps().length) {
          const fuList = this.followUps();
          // Forzamos SIEMPRE un clon para obligar al select a reevaluar el valor una vez que ya existen las <option>
          // (en algunos navegadores si el value se asignó antes de que hubiera coincidencia de option no se pinta selección).
          this.followUps.set(fuList.map(f=> ({ ...f })));
        }
        // Normalización adicional case-insensitive
        this.tryRebindFollowUps();
        // Si había un rebind diferido, intentar nuevamente (por seguridad en siguiente tick)
        if (this.followUpsDeferredRebind) {
          this.followUpsDeferredRebind = false;
          setTimeout(()=> this.tryRebindFollowUps(), 0);
        }
        // Forzar sincronización manual del value después de que el DOM ya tenga las options
        setTimeout(()=> this.forceFollowUpsDomSync(), 0);
      },
      error: () => this.initialMessageError.set('Failed to load message catalogs')
    });
  }

  // Re-normaliza templateId y delivery de followUps frente a los catálogos para asegurar que los selects muestren la opción correcta
  private tryRebindFollowUps(): void {
    const templates = this.notificationTemplates();
    const deliveries = this.deliveryMethods();
    if (!templates.length || !deliveries.length) return; // catálogos incompletos aún
    const list = this.followUps();
    if (!list.length) return;
    const tplIds = new Set(templates.map(t => Number(t.id)));
    let changed = false;
    const normalized = list.map(f => {
      let templateId = f.templateId;
      if (templateId != null && !tplIds.has(templateId)) {
        const matchTpl = templates.find(t => String(t.id) === String(templateId));
        if (matchTpl) { templateId = Number(matchTpl.id); changed = true; }
      }
      let delivery = f.delivery;
      if (delivery) {
        const matchDel = deliveries.find(d => String(d.value).toLowerCase() === String(delivery).toLowerCase());
        if (matchDel && matchDel.value !== delivery) { delivery = matchDel.value; changed = true; }
      }
      return (templateId !== f.templateId || delivery !== f.delivery) ? { ...f, templateId, delivery } : f;
    });
    if (changed) {
      this.followUps.set(normalized);
      // re-sincronizar DOM tras cambio
      setTimeout(()=> this.forceFollowUpsDomSync(), 0);
    }
  }

  // En ciertos escenarios (value seteado antes de que existan las <option>) algunos navegadores no marcan la selección.
  // Esta función fuerza el value en el elemento <select> ya poblado.
  private forceFollowUpsDomSync(): void {
    try {
      const list = this.followUps();
      if (!list.length) return;
      list.forEach((f, i) => {
        const tplEl = document.getElementById('fu_tpl_'+i) as HTMLSelectElement | null;
        if (tplEl && String(tplEl.value) !== String(f.templateId ?? '')) {
          tplEl.value = f.templateId != null ? String(f.templateId) : '';
        }
        const delEl = document.getElementById('fu_del_'+i) as HTMLSelectElement | null;
        if (delEl && String(delEl.value) !== String(f.delivery ?? '')) {
          delEl.value = f.delivery ?? '';
        }
      });
    } catch (e) {
      console.warn('forceFollowUpsDomSync error', e);
    }
  }

  onTemplateChange(raw: any): void {
    const v = Number(raw);
    this.selectedTemplateId.set(Number.isFinite(v) && v > 0 ? v : null);
  }

  onDeliveryMethodChange(raw: any): void {
    this.selectedDeliveryMethod.set((raw ?? '').toString());
  }

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
    this.saveInitialMessage();
  }

  private saveInitialMessage(): void {
    const stageId = this.selectedStageId();
    if (!stageId) { return; }
    // Basic validation
    if (!this.selectedTemplateId()) { Utilities.showToast('Select a message template', 'warning'); return; }
    if (!this.selectedDeliveryMethod()) { Utilities.showToast('Select a delivery method', 'warning'); return; }
    const idSection = this.dataSectionId();
    if (!idSection) {
      Utilities.showToast('Data collection section must exist before saving initial message', 'error');
      return;
    }
    const isCreate = this.initialMessageRecordId() == null;
    const action = isCreate ? 'C' : 'U';
    const currentUser = this.authSession.user?.user || 'system';
    // Nueva firma SP:
    // (p_action, p_id_stage_section_initialmessage, p_id_stage_section, p_id_stage, p_id_template,
    //  p_delivery_method, p_delay_minutes, p_is_active, p_created_by, p_updated_by)
    const params: any[] = [
      action,
      isCreate ? null : this.initialMessageRecordId(),
      idSection,
      stageId,
      this.selectedTemplateId(),
      this.selectedDeliveryMethod(),
      this.initialMessageDelayMins(),
      this.initialMessageDisabled() ? 0 : 1,
      isCreate ? currentUser : null,
      isCreate ? null : currentUser
    ];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_initialmessage_crud, parameters: params };
    this.initialMessageSaving.set(true);
    this.core.executeCommand<DriveWhipCommandResponse>(api).pipe(finalize(()=> this.initialMessageSaving.set(false))).subscribe({
      next: res => {
        if (!res.ok) { Utilities.showToast('Failed to save initial message', 'error'); return; }
        Utilities.showToast(isCreate ? 'Initial message created' : 'Initial message updated', 'success');
        // After create/update, attempt to reload to capture id (READ single filtered by stage?)
        this.reloadInitialMessage(stageId, idSection);
        // Set baseline to current state optimistically
        this.initialMessageOriginal.set({
          templateId: this.selectedTemplateId(),
            delivery: this.selectedDeliveryMethod(),
            delay: this.initialMessageDelayMins(),
            disabled: this.initialMessageDisabled()
        });
      },
      error: () => Utilities.showToast('Failed to save initial message', 'error')
    });
  }

  reloadInitialMessage(stageId: number, idSection: number, forceResetOnNoMatch: boolean = false): void {
    if (!stageId || !idSection) return;
    const apply = (match: any | null) => {
      if (match) {
        const idTemplate = match.id_template != null ? Number(match.id_template) : null;
        const delay = match.delay_minutes != null ? Number(match.delay_minutes) : 0;
        // Normalizamos is_active aceptando 1, '1', true, 'true' (case-insensitive)
        const isActiveRaw = match.is_active;
        const isActive = (
          isActiveRaw === 1 ||
          isActiveRaw === '1' ||
          isActiveRaw === true ||
          (typeof isActiveRaw === 'string' && isActiveRaw.toLowerCase() === 'true')
        );
        this.initialMessageRecordId.set(match.id_stage_section_initialmessage ? Number(match.id_stage_section_initialmessage) : null);
        this.selectedTemplateId.set(idTemplate);
        this.selectedDeliveryMethod.set(match.delivery_method || '');
        this.initialMessageDelayMins.set(delay);
        this.initialMessageDisabled.set(!isActive);
        this.initialMessageOriginal.set({
          templateId: idTemplate,
          delivery: match.delivery_method || '',
          delay: delay,
          // Disabled = inverse of active
          disabled: !isActive
        });
        if (this.notificationTemplates().length === 0 || this.deliveryMethods().length === 0) {
          this.ensureInitialMessageCatalogs();
        }
      } else {
        if (forceResetOnNoMatch || !this.initialMessageDirty()) this.resetInitialMessageState();
        this.initialMessageRecordId.set(null);
      }
    };
    // READ global (p_id_stage_section_initialmessage = NULL) usando nueva firma (10 params)
    const readParams: any[] = ['R', null, null, null, null, null, null, null, null, null];
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_initialmessage_crud, parameters: readParams };
    this.core.executeCommand<DriveWhipCommandResponse>(api).subscribe({
      next: res => {
        if (!res.ok) { apply(null); return; }
        let rows: any[] = [];
        if (Array.isArray(res.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : (res.data as any[]);
        rows = rows.map(r => ({
          ...r,
          id_stage: r.id_stage != null ? Number(r.id_stage) : r.id_stage,
          id_stage_section: r.id_stage_section != null ? Number(r.id_stage_section) : r.id_stage_section,
          id_stage_section_initialmessage: r.id_stage_section_initialmessage != null ? Number(r.id_stage_section_initialmessage) : r.id_stage_section_initialmessage,
          id_template: r.id_template != null ? Number(r.id_template) : r.id_template,
          delay_minutes: r.delay_minutes != null ? Number(r.delay_minutes) : r.delay_minutes,
          // Preserve active flag for numeric 1, string '1', boolean true, or string 'true' (case-insensitive)
          is_active: (
            r.is_active === 1 ||
            r.is_active === '1' ||
            r.is_active === true ||
            (typeof r.is_active === 'string' && r.is_active.toLowerCase() === 'true')
          ) ? 1 : 0
        }));
        let match = rows.find(r => r.id_stage === stageId && r.id_stage_section === idSection);
        if (!match) match = rows.find(r => r.id_stage === stageId);
        apply(match || null);
      },
      error: () => apply(null)
    });
  }

  private loadRulesCatalogs(): void {
    if (this.rulesLoading()) return;
    this.rulesLoading.set(true);
    this.rulesError.set(null);
    const apiCondition: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_condition_type_crud, parameters: ['R', null, null, null, null, null] };
    const apiDatakey: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_datakey_crud, parameters: ['R', null, null, null, null, null] };
    const apiOperator: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_operator_crud, parameters: ['R', null, null, null, null, null] };
    const apiAction: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_action_crud as any, parameters: ['R', null, null, null, null, null] };
    const apiReason: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_sections_reason_crud as any, parameters: ['R', null, null, null, null, null] };
    forkJoin([
      this.core.executeCommand<DriveWhipCommandResponse>(apiCondition),
      this.core.executeCommand<DriveWhipCommandResponse>(apiDatakey),
      this.core.executeCommand<DriveWhipCommandResponse>(apiOperator),
      this.core.executeCommand<DriveWhipCommandResponse>(apiAction),
      this.core.executeCommand<DriveWhipCommandResponse>(apiReason)
    ]).pipe(finalize(()=> this.rulesLoading.set(false))).subscribe({
      next: ([condRes, dataRes, opRes, actRes, reaRes]) => {
        if (!condRes.ok || !dataRes.ok || !opRes.ok || !actRes.ok || !reaRes.ok) {
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
        this.actionsCatalog.set(extract(actRes));
        this.reasonsCatalog.set(extract(reaRes));
      },
      error: () => this.rulesError.set('Failed to load catalogs')
    });
  }

  ensureStageTypes(): void {
    if (this.stageTypesLoading() || this.stageTypeOptions().length > 0) return;
    this.stageTypesLoading.set(true);
    this.stageTypesError.set(null);
    const api: IDriveWhipCoreAPI = { commandName: DriveWhipAdminCommand.crm_stages_type_crud as any, parameters: ['R', null, null, null, null, null] };
    this.core.executeCommand<any>(api).pipe(finalize(()=> this.stageTypesLoading.set(false))).subscribe({
      next: res => {
        let rows: any[] = [];
        if (Array.isArray(res)) rows = res;
        else if (Array.isArray(res?.data)) rows = Array.isArray(res.data[0]) ? res.data[0] : res.data;
        const mapped = rows.map(r => ({ id: r.id_stage_type, label: r.type, is_active: r.is_active !== 0 }));
        this.stageTypeOptions.set(mapped.filter(m => m.is_active));
      },
      error: () => this.stageTypesError.set('Failed to load stage types')
    });
  }

  // (Removed duplicate ngOnInit)

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
            form_code: r.form_code
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
    // Limpiar inmediatamente el estado del Initial Message para evitar valores residuales de otro stage
    this.resetInitialMessageState();
    if (this.stages().find(s => s.id_stage === id)?.type === 'Data Collection') {
      this.loadDataCollectionSection(id, true); // force reset si no existe registro
      this.ensureInitialMessageCatalogs();
      // Attempt loading idle move rule after section load (section id may not yet be known). We'll also call again after section resolves.
      // First optimistic call with current (possibly null) section id
      this.loadIdleMove(id, this.dataSectionId());
      this.loadFollowUps(id, this.dataSectionId());
    } else if (this.stages().find(s => s.id_stage === id)?.type === 'Custom') {
      // For Custom type, show messaging/idle move UI (first card hidden in template)
      this.ensureInitialMessageCatalogs();
      this.loadIdleMove(id, this.dataSectionId());
      this.loadFollowUps(id, this.dataSectionId());
    }
    if (this.stages().find(s => s.id_stage === id)?.type === 'Rules') {
      this.loadRulesCatalogs();
      this.loadRulesSection(id); // will chain load of rule rows
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
  private loadDataCollectionSection(stageId: number, forceResetInitialMsg: boolean = false): void {
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
          // After loading data section, try loading existing initial message configuration
          if (this.selectedStageId()) {
            this.reloadInitialMessage(this.selectedStageId()!, match.id_stage_section, forceResetInitialMsg);
            // Load idle move rule now that we have section id
            this.loadIdleMove(this.selectedStageId()!, match.id_stage_section);
            this.loadFollowUps(this.selectedStageId()!, match.id_stage_section);
          }
        } else {
          // No existing section: reset toggles
          this.dataSectionId.set(null);
          this.dc_show_stage_in_tracker.set(false);
          this.dc_auto_advance_stage.set(false);
          this.dc_notify_owner_on_submit.set(false);
          this.dc_show_one_question.set(false);
          this.dataSectionJsonForm.set('[]');
          // Also reset initial message state because section is absent
          this.resetInitialMessageState();
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
    // Persist order automatically
    this.saveOrder();
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
        currentUser,         // p_updated_by
        stage.form_code ?? null // p_form_code
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
// Unified rule row interface replacing separate condition and action arrays
interface RuleRow {
  id: number | null;
  condition_type_id: number | null;
  datakey_id: number | null;
  operator_id: number | null;
  value: string;
  action_id: number | null;
  reason_id: number | null;
  isActive: boolean;
  dirty: boolean;
  saving?: boolean;
  error?: string;
  // origin: 'C' si se creó desde "Add Condition"; 'A' si se creó desde "Add Action"; undefined si genérico
  origin?: 'C' | 'A';
}
