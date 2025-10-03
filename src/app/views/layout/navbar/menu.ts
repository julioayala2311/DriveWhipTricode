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
    label: 'Markets',
    icon: 'markets',
    link: '/markets'
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
