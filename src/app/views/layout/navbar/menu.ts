import { MenuItem } from './menu.model';

export const MENU: MenuItem[] = [
  {
    label: 'Home',
    icon: 'home',
    link: '/home'
  },
  {
    label: 'Locations',
    icon: 'locations',
    link: '/locations'
  },
  {
    label: 'Workflows',
    icon: 'workflows',
    link: '/workflows'
  },
  {
    label: 'Users',
    icon: 'users',
    subMenus: [
      {
        subMenuItems: [
          { label: 'Accounts', link: '/users/accounts' },
          { label: 'Roles', link: '/users/roles' }
        ]
      }
    ]
  }
];
