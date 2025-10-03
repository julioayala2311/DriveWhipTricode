import Swal, { SweetAlertIcon, SweetAlertOptions } from 'sweetalert2';

export class Utilities {
  private constructor() {}

  static showToast(title: string, icon: SweetAlertIcon, options?: SweetAlertOptions): void {
    const baseOptions: SweetAlertOptions = {
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 5000,
      timerProgressBar: false,
      title,
      icon,
      ...(options ?? {})
    };

    void Swal.fire(baseOptions);
  }

  /**
   * Show a SweetAlert2 confirmation dialog returning a promise<boolean>.
   * Simple wrapper to keep consistent styling across the app.
   */
  static async confirm(options: Partial<SweetAlertOptions & { confirmButtonText: string; cancelButtonText: string }> & { title?: string; text?: string; confirmButtonText?: string; cancelButtonText?: string } = {}): Promise<boolean> {
    const {
      title = 'Are you sure?',
      text = 'This action cannot be undone.',
      confirmButtonText = 'Yes',
      cancelButtonText = 'Cancel',
      ...rest
    } = options;

    const swalOptions: SweetAlertOptions = {
      title,
      text,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText,
      cancelButtonText,
      reverseButtons: true,
      focusCancel: true,
      confirmButtonColor: '#d33',
      ...(rest as SweetAlertOptions)
    };
    const result = await Swal.fire(swalOptions);
    return !!result.isConfirmed;
  }
}