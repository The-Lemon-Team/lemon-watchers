import { TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { MetricsBarComponent } from './metrics-bar.component';

describe('MetricsBarComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MetricsBarComponent],
    }).compileComponents();
  });

  it('should create metrics bar', () => {
    const fixture = TestBed.createComponent(MetricsBarComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should display correct active watchers metric', () => {
    const fixture = TestBed.createComponent(MetricsBarComponent);
    fixture.componentRef.setInput('metrics', {
      activeWatchers: 5,
      totalWatchers: 12,
      totalPings: 150,
      totalNotesIngested: 45,
      avgLatencyMs: 320,
      successRatePercent: 99,
      timestamp: new Date().toISOString(),
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('5 / 12');
    expect(el.textContent).toContain('320 мс');
    expect(el.textContent).toContain('99%');
  });
});
