export interface workflowsRecord {
  id_workflow: number;
  name: string;                           // e.g. "Boston"
  created_at: Date;                   // e.g. "Boston State"
  active: number;                       // 1 = activo, 0 = inactivo
}

export type workflowsAction = 'C' | 'R' | 'U' | 'D';
