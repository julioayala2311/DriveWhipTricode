export interface RoleRecord {
  Id?: number;        // New numeric identifier from auth_roles_crud_v2 (alias "Id")
  role: string;
  description: string;
  createdat: string; // raw from API (keep naming to match SP alias)
  isactive: number;  // 1 / 0
}

export interface RoleListResponse extends Array<RoleRecord> {}

export type RoleAction = 'C' | 'R' | 'U' | 'D';
