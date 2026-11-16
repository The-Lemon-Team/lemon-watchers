import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { routes } from '../../app.routes';
import { WatchersService } from '../../services/watchers.service';

describe('DashboardComponent', () => {
  const mockWatchersService = {
    sseConnected$: new Subject<boolean>(),
    pingEvents$: new Subject<any>(),
    articleEvents$: new Subject<any>(),
    metricsEvents$: new Subject<any>(),
    storyEvents$: new Subject<any>(),
    getFolders: () => of({ items: [] }),
    getWatchers: () => of({ items: [] }),
    getArticles: () => of({ items: [], total: 0 }),
    getMetrics: () =>
      of({
        activeWatchers: 0,
        totalWatchers: 0,
        totalPings: 0,
        totalNotesIngested: 0,
        avgLatencyMs: 0,
        successRatePercent: 100,
        timestamp: new Date().toISOString(),
      }),
    getStory: () => of({ items: [] }),
    getRawNews: () => of({ items: [], total: 0 }),
    getBusStatus: () =>
      of({
        busUrl: '',
        deviceId: '',
        activeSseSubscribers: 0,
        total: 0,
        published: 0,
        pending: 0,
      }),
    initSSE: () => {},
    closeSSE: () => {},
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter(routes),
        { provide: WatchersService, useValue: mockWatchersService },
      ],
    }).compileComponents();
  });

  it('should create the dashboard component', () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Lemon Watchers');
  });

  it('should switch active tab when setTab is called', () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    const component = fixture.componentInstance;
    expect(component.activeTab()).toBe('watchers');

    component.setTab('story');
    expect(component.activeTab()).toBe('story');

    component.setTab('articles');
    expect(component.activeTab()).toBe('articles');
  });
});
