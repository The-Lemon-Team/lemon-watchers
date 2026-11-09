import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { ModalComponent } from './modal.component';

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [closeOnOutside]="closeOnOutside()"
      [closeOnEsc]="closeOnEsc()"
      (close)="onClose()"
    >
      <div id="modal-content">
        <p>Modal body content</p>
        <button id="inside-btn">Button inside</button>
      </div>
    </app-modal>
  `,
})
class TestHostComponent {
  isOpen = signal<boolean>(false);
  closeOnOutside = signal<boolean>(true);
  closeOnEsc = signal<boolean>(true);
  closedCount = 0;

  onClose(): void {
    this.closedCount++;
  }
}

describe('ModalComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should not render anything when isOpen is false', () => {
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();
  });

  it('should render dialog when isOpen is true', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#modal-content')).not.toBeNull();
  });

  it('should emit close on backdrop click', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(host.closedCount).toBe(1);
  });

  it('should NOT emit close when clicking inside the modal content', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const insideBtn = fixture.nativeElement.querySelector('#inside-btn') as HTMLElement;
    insideBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    insideBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(host.closedCount).toBe(0);
  });

  it('should emit close on Escape key', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    fixture.detectChanges();

    expect(host.closedCount).toBe(1);
  });

  it('should NOT emit close on Escape when isOpen is false', () => {
    host.isOpen.set(false);
    fixture.detectChanges();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    fixture.detectChanges();

    expect(host.closedCount).toBe(0);
  });

  it('should NOT emit close on Escape when closeOnEsc is false', () => {
    host.isOpen.set(true);
    host.closeOnEsc.set(false);
    fixture.detectChanges();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    fixture.detectChanges();

    expect(host.closedCount).toBe(0);
  });

  it('should NOT emit close on backdrop click when closeOnOutside is false', () => {
    host.isOpen.set(true);
    host.closeOnOutside.set(false);
    fixture.detectChanges();

    const backdrop = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(host.closedCount).toBe(0);
  });
});
