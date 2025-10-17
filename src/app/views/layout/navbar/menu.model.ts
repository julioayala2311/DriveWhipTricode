
export interface MenuItem {
  id?: number;
  label?: string;
  icon?: string;
  link?: string;
  path?: string; // optional DB path
  action?: string; // 'popup' | 'new_tab'
  code?: string | null; // iframe HTML or URL
  sort_order?: number | string;
  subMenus?: SubMenus[];
  isMegaMenu?: boolean;
}

export interface SubMenus {
  subMenuItems?: SubMenuItems[]
}

export interface SubMenuItems {
  label?: string;
  link?: string;
  path?: string; // optional DB path
  action?: string; // 'popup' | 'new_tab'
  code?: string | null; // iframe HTML or URL
  sort_order?: number | string;
  isTitle?: boolean;
  badge?: Badge;
}

export interface Badge {
  variant?: string;
  text?: string
}