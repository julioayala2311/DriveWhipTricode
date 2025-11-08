export enum DriveWhipAdminCommand {
    auth_users_info = "auth_users_info",
    auth_users_list = "auth_users_list",
    auth_roles_crud = "auth_roles_crud", // Generic CRUD (C,R,U,D) via p_action parameter
    auth_users_crud = "auth_users_crud", // Users CRUD stored procedure
    crm_stages_crud = "crm_stages_crud", // CRUD + logical delete for stages (p_action)
    crm_stages_sections_crud = "crm_stages_sections_crud", // CRUD for stage sections (data collection config)
    crm_stages_sections_condition_type_crud = "crm_stages_sections_condition_type_crud", // Condition type catalog
    crm_stages_sections_datakey_crud = "crm_stages_sections_datakey_crud", // Data key catalog
    crm_stages_sections_operator_crud = "crm_stages_sections_operator_crud", // Operator catalog
    notification_templates_crud = "notification_templates_crud", // Notification templates (R list)
    crm_applicants_list = "crm_applicants_list",
    // Drivers list for Drivers page grid
    crm_drivers_list = "crm_drivers_list",
    crm_stages_deliveryMetod_options = "crm_stages_deliveryMetod_options", // Delivery method options
    crm_stages_sections_initialmessage_crud = "crm_stages_sections_initialmessage_crud", // Initial message CRUD
    crm_stages_sections_idlemove_crud = "crm_stages_sections_idlemove_crud", // Idle move rule CRUD
    crm_stages_sections_followup_crud = "crm_stages_sections_followup_crud", // Follow-up messages CRUD (multiple)
    crm_stages_sections_rule_crud = "crm_stages_sections_rule_crud", // Rules (condition+action) CRUD
    crm_stages_sections_condition_crud = "crm_stages_sections_condition_crud", // Conditions CRUD (separate)
    crm_stages_sections_action_crud = "crm_stages_sections_action_crud", // Actions catalog CRUD
    crm_stages_actions_type_crud = "crm_stages_actions_type_crud", // Action types catalog for dropdown
    crm_stages_sections_reason_crud = "crm_stages_sections_reason_crud", // Reasons catalog CRUD
    crm_stages_type_crud = "crm_stages_type_crud", // Stage type catalog CRUD
    crm_rules_types_crud = "crm_rules_types_crud", // Rule types catalog CRUD
    crm_stages_customs_types_crud = "crm_stages_customs_types_crud", // Custom stage types catalog CRUD
   
    
    
    crm_locations_list = "crm_locations_list",
    crm_markets_list = "crm_markets_list",
    crm_locations_dropdown = "crm_locations_dropdown",
    crm_stages_applicants_list = "crm_stages_applicants_list", // List of stages for workflow (p_id_workflow)
    crm_stages_list = "crm_stages_list", // List of stages for workflow (p_id_workflow)
    crm_applicants_notes_crud = "crm_applicants_notes_crud",
    crm_applicants_crud = "crm_applicants_crud",
    crm_applicants_stages_history_crud = "crm_applicants_stages_history_crud",
    app_applicants_crud = "app_applicants_crud",
    crm_applicants_X_crm_stages = "crm_applicants_X_crm_stages", // Applicants for stage
    crm_workflows_list = "crm_workflows_list",
    auth_roles_routes = "auth_roles_routes",
    crm_locations_crud = "crm_locations_crud",
    auth_roles_routes_crud = "auth_roles_routes_crud",
    crm_workflows_crud = "crm_workflows_crud",
    crm_locations_active = "crm_locations_active",
    commun_country_states = "commun_country_states",
    crm_applicants_answers_registration = "crm_applicants_answers_registration",
    crm_datacollections_forms = "crm_datacollections_forms",
    crm_applicants_documents_crud_new = "crm_applicants_documents_crud_new",
    crm_applicants_moveto_new = "crm_applicants_moveto_new",
    crm_locations_workflows_list = "crm_locations_workflows_list",
    crm_workflow_clonate = "crm_workflow_clonate",
    crm_applicant_chat_history = "crm_applicant_chat_history",
    crm_applicant_event_read = "crm_applicant_event_read",
    crm_applicant_event_options = "crm_applicant_event_options",
    crm_applicant_event_detail = "crm_applicant_event_detail",
    crm_applicants_recollect_options = "crm_applicants_recollect_options",
    crm_applicants_recollect_menssage = "crm_applicants_recollect_menssage",
    crm_applicants_chat_list = "crm_applicants_chat_list",
    // New procedure that accepts a location id to filter conversations
    crm_applicants_chat_list_location = "crm_applicants_chat_list_location"
    ,crm_applicants_chat_count_location = "crm_applicants_chat_count_location",
    // Approve applicant as driver
    crm_applicant_to_driver = "crm_applicant_to_driver",
    // Argyle JSON by applicant
    crm_applicants_argyle_json_user = "crm_applicants_argyle_json_user",
    notifcations_templates_list ="notifcations_templates_list",
    // Template types list for Templates page combo
    notifcations_templates_type_list = "notifcations_templates_type_list",
    // DataKey type list for editor inserts
    notifcations_datakey_type_list = "notifcations_datakey_type_list",
    // DataKey list by type for editor inserts
    notifcations_datakey_list = "notifcations_datakey_list",
    // Templates CRUD (C/U/D via p_action)
    crm_notifications_templates_crud = "crm_notifications_templates_crud",
    // New Templates CRUD v2 (single call supports both Email + SMS bodies)
    crm_notifications_templates_crud_v2 = "crm_notifications_templates_crud_v2",
    // Templates combos by type code for selects
    crm_notifications_templates_combos = "crm_notifications_templates_combos",
    // Chat templates list for applicant panel modal
    crm_notifications_templates_chat_list = "crm_notifications_templates_chat_list",
    // Clone a notification template
    notifcations_template_clone = "notifcations_template_clone",
    crm_notifications_template_body = "crm_notifications_template_body",
}

export enum DriveWhipAplicantsCommand {
    //Aqui pueden ir tus SP Rober :)

}
