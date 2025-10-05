export enum DriveWhipAdminCommand {
    auth_users_info = "auth_users_info",
    auth_users_list = "auth_users_list",
    auth_roles_crud = "auth_roles_crud", // Generic CRUD (C,R,U,D) via p_action parameter
    auth_users_crud = "auth_users_crud", // Users CRUD stored procedure
    crm_stages_crud = "crm_stages_crud", // CRUD + logical delete for stages (p_action)

    //Roberto
    crm_locations_list = "crm_locations_list",
    crm_markets_list = "crm_markets_list",
    crm_locations_dropdown = "crm_locations_dropdown",
    crm_stages_list = "crm_stages_list", // Lista de stages por workflow (p_id_workflow)
    crm_applicants_X_crm_stages = "crm_applicants_X_crm_stages", // Applicants por stage
    crm_workflows_list = "crm_workflows_list",
    auth_roles_routes = "auth_roles_routes"
}

export enum DriveWhipAplicantsCommand {
    //Aqui pueden ir tus SP Rober :)

}