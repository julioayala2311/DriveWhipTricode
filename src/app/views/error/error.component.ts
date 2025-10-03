import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

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

  constructor(private route: ActivatedRoute) {}

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

}
