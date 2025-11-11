import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-error',
  standalone: true,
  imports: [
    RouterLink
  ],
  templateUrl: './error.component.html'
})
export class ErrorComponent implements OnInit {

  type: string | null;
  title: string;
  desc: string;

  constructor(private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.type = this.route.snapshot.paramMap.get('type');
    
    switch(this.type) {
      case '404':
        this.title = 'Page Not Found';
        this.desc = 'Oopps!! The page you were looking for doesn\'t exist.'
        break;
      case '500':
        this.title = 'Internal Server Error',
        this.desc = 'Oopps!! There wan an error. Please try agin later.'
        break;
      default:
        this.type = 'Ooops..';
        this.title = 'Something went wrong';
        this.desc = 'Looks like something went wrong.<br>' + 'We\'re working on it';
    }
  }

  // Allow the user to recover from routing loops by logging out (clear session data and navigate to login)
  onLogout(e?: Event): void {
    try {
      e?.preventDefault();
      e?.stopPropagation();
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem('dw.auth.session');
      localStorage.removeItem('dw.menu');
      localStorage.removeItem('dw.routes');
      localStorage.removeItem('dw.auth.user');
      localStorage.removeItem('dw.selectedLocationId');
      localStorage.removeItem('google_picture');
    } catch {
      /* ignore */
    }
    this.router.navigate(['/auth/login']);
  }

}
