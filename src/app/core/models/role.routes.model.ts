export interface RoleRouteRecord {
  role: string;
  id_route: number;
  parent_id: number; // raw from API (keep naming to match SP alias)
  path: string;  
  label: string;  
  icon: string;  
  sort_order: number;  
  is_menu: number;  
  is_active: number;  
  is_assigned: number;
}

export interface RoleRouteListResponse extends Array<RoleRouteRecord> {}

export type RoleRouteAction = 'C' | 'R' | 'U' | 'D';
