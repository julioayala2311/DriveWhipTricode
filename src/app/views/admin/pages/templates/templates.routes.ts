import { Routes } from "@angular/router";

export default [
  {
    path: "",
    loadComponent: () =>
      import("./templates-page.component").then(
        (c) => c.TemplatesPageComponent
      ),
  },
] as Routes;
