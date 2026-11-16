import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StoryDetailModalComponent } from './story-detail-modal.component';
import { StoryEvent, WatcherArticle } from '../../../models';

describe('StoryDetailModalComponent', () => {
  let component: StoryDetailModalComponent;
  let fixture: ComponentFixture<StoryDetailModalComponent>;

  const mockEvent: StoryEvent = {
    id: 'test-event-1',
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
  };

  const mockArticle: WatcherArticle = {
    id: 'art-1',
    watcherId: 'w-theverge',
    watcherSlug: 'pub-theverge',
    watcherTitle: 'The Verge',
    guid: 'guid-1',
    url: 'https://theverge.com/article-1',
    title: 'New Verge Gadget Review',
    summary: 'A preview of new hardware gadgets',
    content: '<p>Content</p>',
    author: 'Verge Reporter',
    tags: ['tech', 'gadgets'],
    resonanceScore: 88,
    contentHash: 'hash1',
    publishedAt: '2026-11-09T21:50:00.000Z',
    createdAt: '2026-11-09T22:00:00.000Z',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StoryDetailModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StoryDetailModalComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should switch tabs between articles and history', () => {
    expect(component.activeTab()).toBe('articles');
    component.setTab('history');
    expect(component.activeTab()).toBe('history');
  });

  it('should emit openArticle output when triggered', () => {
    let emittedArticle: WatcherArticle | null = null;
    component.openArticle.subscribe((art) => {
      emittedArticle = art;
    });

    component.openArticle.emit(mockArticle);
    expect(emittedArticle).toEqual(mockArticle);
  });
});
