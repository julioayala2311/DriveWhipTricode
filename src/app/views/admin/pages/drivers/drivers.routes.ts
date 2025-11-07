import { Routes } from "@angular/router";

export default [
  {
    path: "",
    loadComponent: () =>
      import("./drivers-page.component").then(
        (c) => c.DriversPageComponent
      ),
  },
] as Routes;
