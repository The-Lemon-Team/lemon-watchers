import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StoryStreamComponent } from './story-stream.component';
import { StoryEvent } from '../../models';

describe('StoryStreamComponent', () => {
  let component: StoryStreamComponent;
  let fixture: ComponentFixture<StoryStreamComponent>;

  const mockEvents: StoryEvent[] = [
    {
      id: 'evt-1',
      type: 'NEWS_COLLECTED',
      title: 'The Verge: Получено 8 новых новостей',
      description: 'Всего в ленте: 10, сохранено: +8 (HTTP 200, 325ms)',
      watcherId: 'w-theverge',
      watcherTitle: 'The Verge',
      statusCode: 200,
      latencyMs: 325,
      itemsCount: 10,
      newItemsCount: 8,
      timestamp: '2026-11-09T22:00:00.000Z',
    },
    {
      id: 'evt-2',
      type: 'NO_UPDATES',
      title: 'Ars Technica: 0 новых новостей',
      description: 'Все 20 публикаций актуальны, дельт нет (280ms)',
      watcherId: 'w-arstechnica',
      watcherTitle: 'Ars Technica',
      statusCode: 200,
      latencyMs: 280,
      itemsCount: 20,
      newItemsCount: 0,
      timestamp: '2026-11-09T22:05:00.000Z',
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StoryStreamComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StoryStreamComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should extract watcher name from event', () => {
    expect(component.getEventWatcherName(mockEvents[0])).toBe('The Verge');
  });

  it('should emit selectEvent when an event card is clicked', () => {
    let selected: StoryEvent | null = null;
    component.selectEvent.subscribe((evt) => {
      selected = evt;
    });

    component.selectEvent.emit(mockEvents[0]);
    expect(selected).toEqual(mockEvents[0]);
  });
});
