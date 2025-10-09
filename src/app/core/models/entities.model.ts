export interface IDriveWhipCoreAPI {
  commandName: string;
  parameters: any[];
}

export interface DriveWhipCommandResponse<T = any> {
  ok: boolean;
  data: T[];
  error: unknown;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

// export interface IAuthResponseModel {
//   username: string;
//   token_google: string;
//   firstname: string;
//   lastname: string;
//   role: string;
//   is_active: number;
// }

export interface IAuthResponseModel {
  user: string;
  token: string;
  firstname: string;
  lastname: string;
  role: string;
  active: boolean;
}