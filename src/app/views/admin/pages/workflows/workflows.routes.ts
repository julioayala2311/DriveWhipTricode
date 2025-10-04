import { Routes } from '@angular/router';
import { workflowGuard } from '../../../../core/guards/workflow.guard';

export default [
    {
        path: '',
        loadComponent: () => import('./workflows.component').then(c => c.WorkFlowsComponent),
    },
    {
        path: 'edit/:id',
        canActivate: [workflowGuard],
        loadComponent: () => import('./editor/workflow-editor.component').then(c => c.WorkflowEditorComponent)
    }
] as Routes;