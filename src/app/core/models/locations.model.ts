export interface LocationsRecord {
  applicants_count: number;          // username (SP alias)
  id_location: number;         // token_google (alias token)
  //id_market: number;
  id_workflow: number;
  location_name: string;
  market_address: number;        // 1 / 0
  market_name: number;        // 1 / 0
  workflow_name: number;        // 1 / 0
  active: number;        // 1 / 0  
  state_code: string;  
  full_address: string;
  country_code: string;  
  state_name: string;
  json_form: string;
}

export type LocationsAction = 'C' | 'R' | 'U' | 'D';
