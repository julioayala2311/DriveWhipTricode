import { Injectable } from '@angular/core';

export type ThemeCssVariablesType = {
  primary: string;
  secondary: string;
  success: string;
  info: string;
  warning: string;
  danger: string;
  light: string;
  dark: string;
  gridBorder: string;
  fontFamily: string;
}

@Injectable({
  providedIn: 'root'
})
export class ThemeCssVariableService {

  constructor() { }

  // Function to get the value of a root CSS variable
  private getCssVariableValue = (variableName: string) => {
    let value = getComputedStyle(document.documentElement).getPropertyValue(variableName);
    if ( value && value.length > 0 ) {
      value = value.trim();
    }
    return value;
  }

  getThemeCssVariables(): ThemeCssVariablesType {
    return {
      primary        : this.getCssVariableValue('--bs-primary'),
      secondary      : this.getCssVariableValue('--bs-secondary'),
      success        : this.getCssVariableValue('--bs-success'),
      info           : this.getCssVariableValue('--bs-info'),
      warning        : this.getCssVariableValue('--bs-warning'),
      danger         : this.getCssVariableValue('--bs-danger'),
      light          : this.getCssVariableValue('--bs-light'),
      dark           : this.getCssVariableValue('--bs-dark'),
      gridBorder     : "rgba(77, 138, 240, .15)",
      fontFamily     : this.getCssVariableValue('--bs-font-sans-serif')
    }
  }
  
}
