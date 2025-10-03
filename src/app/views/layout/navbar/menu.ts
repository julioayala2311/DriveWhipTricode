import { MenuItem } from './menu.model';

export const MENU: MenuItem[] = [
  {
    label: 'Home',
    icon: 'home',
    link: '/home'
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
