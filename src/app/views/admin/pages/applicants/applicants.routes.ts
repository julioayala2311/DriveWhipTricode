import { Routes } from "@angular/router";

export default [
  {
    path: "",
    loadComponent: () =>
      import("./applicants-page.component").then(
        (c) => c.ApplicantsPageComponent
      ),
  },
] as Routes;
