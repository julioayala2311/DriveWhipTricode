import { MenuItem } from './menu.model';

export const MENU: MenuItem[] = [
  {
    label: 'Openings',
    icon: 'home',
    link: '/rideshare'
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
