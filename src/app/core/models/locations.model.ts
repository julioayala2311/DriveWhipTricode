export interface LocationsRecord {
  applicants_count: number;          // username (SP alias)
  id_location: number;         // token_google (alias token)
  id_market: number;
  id_workflow: number;
  location_name: string;
  market_address: number;        // 1 / 0
  market_name: number;        // 1 / 0
  workflow_name: number;        // 1 / 0
  active: number;        // 1 / 0
}

export type LocationsAction = 'C' | 'R' | 'U' | 'D';
