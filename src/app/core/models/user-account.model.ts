export interface UserAccountRecord {
  user: string;          // username (SP alias)
  token: string;         // token_google (alias token)
  firstname: string;
  lastname: string;
  role: string;
  active: number;        // 1 / 0
}

export type UserAccountAction = 'C' | 'R' | 'U' | 'D';
