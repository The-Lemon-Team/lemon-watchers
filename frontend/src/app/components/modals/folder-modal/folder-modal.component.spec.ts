import { TestBed } from '@angular/core/testing';
import { FolderModalComponent } from './folder-modal.component';

describe('FolderModalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FolderModalComponent],
    }).compileComponents();
  });

  it('should create folder modal', () => {
    const fixture = TestBed.createComponent(FolderModalComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should emit save when form is submitted with valid title', () => {
    const fixture = TestBed.createComponent(FolderModalComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    component.title = 'Crypto News';
    component.icon = '⚡';
    component.color = '#eab308';
    component.description = 'All crypto';

    let savedData: any = null;
    component.save.subscribe((data) => (savedData = data));

    component.onSubmit();

    expect(savedData).toEqual({
      title: 'Crypto News',
      slug: '',
      icon: '⚡',
      color: '#eab308',
      description: 'All crypto',
    });
  });
});
