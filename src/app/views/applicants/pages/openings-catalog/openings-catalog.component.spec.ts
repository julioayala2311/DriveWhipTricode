import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OpeningsCatalogComponent } from './openings-catalog.component';

describe('OpeningsCatalogComponent', () => {
  let component: OpeningsCatalogComponent;
  let fixture: ComponentFixture<OpeningsCatalogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OpeningsCatalogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OpeningsCatalogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
