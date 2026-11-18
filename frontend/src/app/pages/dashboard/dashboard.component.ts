import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { WatchersService } from '../../services/watchers.service';
import {
  WatcherFolder,
  WatcherState,
  WatcherArticle,
  WatcherMetricsSnapshot,
  WatcherPingRecord,
  StoryEvent,
  RawNewsItem,
} from '../../models';
import { HeaderComponent } from '../../components/header/header.component';
import { MetricsBarComponent } from '../../components/metrics-bar/metrics-bar.component';
import { FolderTabsComponent } from '../../components/folder-tabs/folder-tabs.component';
import { WatchersTableComponent } from '../../components/watchers-table/watchers-table.component';
import { ArticlesViewComponent } from '../../components/articles-view/articles-view.component';
import { PingsTelemetryComponent } from '../../components/pings-telemetry/pings-telemetry.component';
import { StoryStreamComponent } from '../../components/story-stream/story-stream.component';
import { RawNewsViewComponent } from '../../components/raw-news-view/raw-news-view.component';
import { FolderModalComponent } from '../../components/modals/folder-modal/folder-modal.component';
import {
  WatcherModalComponent,
  WatcherFormData,
} from '../../components/modals/watcher-modal/watcher-modal.component';
import { FeedDetailsModalComponent } from '../../components/modals/feed-details-modal/feed-details-modal.component';
import { ArticleDetailModalComponent } from '../../components/modals/article-detail-modal/article-detail-modal.component';
import { RawNewsDetailModalComponent } from '../../components/modals/raw-news-detail-modal/raw-news-detail-modal.component';
import { StoryDetailModalComponent } from '../../components/modals/story-detail-modal/story-detail-modal.component';

export type DashboardTab = 'watchers' | 'articles' | 'pings' | 'story' | 'raw-news';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    MetricsBarComponent,
    FolderTabsComponent,
    WatchersTableComponent,
    ArticlesViewComponent,
    PingsTelemetryComponent,
    StoryStreamComponent,
    RawNewsViewComponent,
    FolderModalComponent,
    WatcherModalComponent,
    FeedDetailsModalComponent,
    ArticleDetailModalComponent,
    RawNewsDetailModalComponent,
    StoryDetailModalComponent,
  ],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, OnDestroy {
  private watchersService = inject(WatchersService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private subs = new Subscription();

  // Navigation & View state
  activeTab = signal<DashboardTab>('watchers');
  selectedFolderSlug = signal<string>('');
  articlesViewMode = signal<'table' | 'cards'>('table');
  searchQuery = signal<string>('');

  // Domain data
  folders = signal<WatcherFolder[]>([]);
  watchers = signal<WatcherState[]>([]);
  articles = signal<WatcherArticle[]>([]);
  metrics = signal<WatcherMetricsSnapshot | null>(null);
  livePings = signal<WatcherPingRecord[]>([]);
  sseConnected = signal<boolean>(false);

  // Whole Story stream
  storyEvents = signal<StoryEvent[]>([]);
  includeProxyLogs = signal<boolean>(false);
  isStoryLoading = signal<boolean>(false);

  // Story Detail Modal state
  selectedStoryEvent = signal<StoryEvent | null>(null);
  isStoryModalOpen = signal<boolean>(false);
  storyModalArticles = signal<WatcherArticle[]>([]);
  storyModalArticlesTotal = signal<number>(0);
  isStoryModalArticlesLoading = signal<boolean>(false);
  storyModalPingHistory = signal<WatcherPingRecord[]>([]);
  isStoryModalHistoryLoading = signal<boolean>(false);
  storyModalWatcher = signal<WatcherState | null>(null);

  // LemonBus bridge & publishing state
  busStatus = signal<{
    busUrl: string;
    deviceId: string;
    activeSseSubscribers: number;
    total: number;
    published: number;
    pending: number;
  } | null>(null);
  publishingBusIds = signal<Set<string>>(new Set());
  generatingCoverIds = signal<Set<string>>(new Set());
  fetchingOriginalCoverIds = signal<Set<string>>(new Set());
  assistingArticleIds = signal<Set<string>>(new Set());
  isPublishingAllBus = signal<boolean>(false);

  // Raw News (Stage 1 autonomous collection)
  rawNewsItems = signal<RawNewsItem[]>([]);
  rawNewsTotal = signal<number>(0);
  rawNewsLimit = signal<number>(25);
  rawNewsOffset = signal<number>(0);
  rawNewsStatusFilter = signal<string>('');
  isRawNewsLoading = signal<boolean>(false);
  convertingRawIds = signal<Set<string>>(new Set());
  isProcessingAllPending = signal<boolean>(false);
  selectedRawItem = signal<RawNewsItem | null>(null);
  isRawDetailOpen = signal<boolean>(false);

  // Human Curation & Selection
  selectedRawNewsIds = signal<Set<string>>(new Set());
  selectedArticleIds = signal<Set<string>>(new Set());
  isBatchActionRunning = signal<boolean>(false);

  // Pagination for articles
  articlesTotal = signal<number>(0);
  articlesLimit = signal<number>(25);
  articlesOffset = signal<number>(0);

  // Loading & Action indicators
  isLoading = signal<boolean>(false);
  isTriggeringAll = signal<boolean>(false);
  isPausingAll = signal<boolean>(false);
  pollingWatcherIds = signal<Set<string>>(new Set());

  // Modals state
  isCreateFolderOpen = signal<boolean>(false);
  isCreateWatcherOpen = signal<boolean>(false);
  isEditWatcherOpen = signal<boolean>(false);
  watcherToEdit = signal<WatcherState | null>(null);
  isFeedArticlesOpen = signal<boolean>(false);
  activeFeedWatcher = signal<WatcherState | null>(null);
  feedModalTab = signal<'history' | 'articles'>('history');
  feedArticles = signal<WatcherArticle[]>([]);
  feedArticlesTotal = signal<number>(0);
  isFeedArticlesLoading = signal<boolean>(false);
  feedPingHistory = signal<WatcherPingRecord[]>([]);
  isFeedHistoryLoading = signal<boolean>(false);
  selectedArticle = signal<WatcherArticle | null>(null);

  // URL Validation state
  validationResult = signal<{ valid: boolean; itemsCount?: number; error?: string } | null>(null);
  isValidatingUrl = signal<boolean>(false);

  // Computed state
  anyActiveWatchers = computed(() => this.watchers().some((w) => w.enabled !== false));
  activeWatchersCount = computed(() => this.watchers().filter((w) => w.enabled !== false).length);
  totalWatchersCount = computed(() => this.watchers().length);

  filteredWatchers = computed(() => {
    const folder = this.selectedFolderSlug();
    const query = this.searchQuery().toLowerCase().trim();
    return this.watchers().filter((w) => {
      const matchesFolder = !folder || w.category === folder;
      const matchesQuery =
        !query ||
        w.title.toLowerCase().includes(query) ||
        w.slug.toLowerCase().includes(query) ||
        (w.url && w.url.toLowerCase().includes(query));
      return matchesFolder && matchesQuery;
    });
  });

  folderColorMap = computed(() => {
    const map = new Map<string, { icon: string; color: string; title: string }>();
    for (const f of this.folders()) {
      map.set(f.slug, { icon: f.icon, color: f.color, title: f.title });
    }
    return map;
  });

  ngOnInit(): void {
    this.initRouteSync();
    this.loadFolders();
    this.loadWatchers();
    this.loadArticles();
    this.loadMetrics();
    this.loadStory();
    this.loadRawNews();
    this.loadBusStatus();
    this.initSSE();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.watchersService.closeSSE();
  }

  private initRouteSync(): void {
    this.subs.add(
      this.route.paramMap.subscribe((params) => {
        const tab = params.get('tab') as DashboardTab;
        if (tab && ['watchers', 'articles', 'pings', 'story', 'raw-news'].includes(tab)) {
          if (this.activeTab() !== tab) {
            this.activeTab.set(tab);
            this.handleTabActivation(tab);
          }
        } else if (!tab && this.activeTab() !== 'watchers') {
          this.activeTab.set('watchers');
        }
      }),
    );

    this.subs.add(
      this.route.queryParamMap.subscribe((queryParams) => {
        const folder = queryParams.get('folder');
        if (folder !== null && folder !== this.selectedFolderSlug()) {
          this.selectedFolderSlug.set(folder);
          this.articlesOffset.set(0);
          this.loadArticles();
        }
      }),
    );
  }

  // Data Loaders
  loadFolders(): void {
    this.watchersService.getFolders().subscribe({
      next: (res) => {
        this.folders.set(res.items);
      },
      error: (err) => console.error('Failed to load folders:', err),
    });
  }

  loadWatchers(): void {
    this.watchersService.getWatchers().subscribe({
      next: (res) => this.watchers.set(res.items),
      error: (err) => console.error('Failed to load watchers:', err),
    });
  }

  loadArticles(): void {
    this.isLoading.set(true);
    this.watchersService
      .getArticles({
        limit: this.articlesLimit(),
        offset: this.articlesOffset(),
        category: this.selectedFolderSlug() || undefined,
        search: this.searchQuery() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.articles.set(res.items);
          this.articlesTotal.set(res.total);
          this.isLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to load articles:', err);
          this.isLoading.set(false);
        },
      });
  }

  loadMetrics(): void {
    this.watchersService.getMetrics().subscribe({
      next: (m) => this.metrics.set(m),
      error: (err) => console.error('Failed to load metrics:', err),
    });
  }

  private initSSE(): void {
    this.watchersService.initSSE();

    this.subs.add(
      this.watchersService.sseConnected$.subscribe((connected) => {
        this.sseConnected.set(connected);
      }),
    );

    this.subs.add(
      this.watchersService.pingEvents$.subscribe((ping) => {
        this.livePings.update((list) => [ping, ...list.slice(0, 49)]);
        this.watchers.update((list) =>
          list.map((w) =>
            w.id === ping.watcherId
              ? {
                  ...w,
                  lastPingAt: ping.createdAt,
                  lastLatencyMs: ping.latencyMs,
                  status: (ping.statusCode >= 200 && ping.statusCode < 400
                    ? 'SUCCESS'
                    : 'ERROR') as any,
                }
              : w,
          ),
        );

        if (this.activeFeedWatcher()?.id === ping.watcherId) {
          this.feedPingHistory.update((list) => [ping, ...list]);
          this.activeFeedWatcher.update((w) =>
            w
              ? {
                  ...w,
                  lastPingAt: ping.createdAt,
                  lastLatencyMs: ping.latencyMs,
                  totalPings: (w.totalPings || 0) + 1,
                  status: (ping.statusCode >= 200 && ping.statusCode < 400
                    ? 'SUCCESS'
                    : 'ERROR') as any,
                }
              : null,
          );
        }

        this.loadMetrics();
      }),
    );

    this.subs.add(
      this.watchersService.articleEvents$.subscribe((article) => {
        if (this.articlesOffset() === 0) {
          this.articles.update((list) => [article, ...list.slice(0, this.articlesLimit() - 1)]);
          this.articlesTotal.update((t) => t + 1);
        }

        if (this.activeFeedWatcher()?.id === article.watcherId) {
          this.feedArticles.update((list) => [article, ...list]);
          this.feedArticlesTotal.update((t) => t + 1);
        }

        this.loadMetrics();
      }),
    );

    this.subs.add(
      this.watchersService.metricsEvents$.subscribe((m) => {
        this.metrics.set(m);
      }),
    );

    this.subs.add(
      this.watchersService.storyEvents$.subscribe((event) => {
        if (!event.isProxyOnly || this.includeProxyLogs()) {
          this.storyEvents.update((list) => [event, ...list.slice(0, 199)]);
        }
      }),
    );
  }

  // Folder actions
  selectFolder(slug: string): void {
    this.selectedFolderSlug.set(slug);
    this.articlesOffset.set(0);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: slug ? { folder: slug } : { folder: null },
      queryParamsHandling: 'merge',
    });
    this.loadArticles();
  }

  openCreateFolder(): void {
    this.isCreateFolderOpen.set(true);
  }

  closeCreateFolder(): void {
    this.isCreateFolderOpen.set(false);
  }

  saveFolder(data: {
    title: string;
    slug: string;
    icon: string;
    color: string;
    description: string;
  }): void {
    this.watchersService.createFolder(data).subscribe({
      next: (created) => {
        this.loadFolders();
        this.closeCreateFolder();
        this.selectFolder(created.slug);
      },
      error: (err) => alert(`Ошибка создания папки: ${err.error?.error || err.message}`),
    });
  }

  deleteFolder(folder: WatcherFolder, event: Event): void {
    event.stopPropagation();
    if (folder.isSystem) return;
    if (!confirm(`Вы действительно хотите удалить папку "${folder.title}"?`)) return;

    this.watchersService.deleteFolder(folder.id).subscribe({
      next: () => {
        if (this.selectedFolderSlug() === folder.slug) {
          this.selectFolder('');
        }
        this.loadFolders();
      },
      error: (err) => alert(`Не удалось удалить: ${err.error?.error || err.message}`),
    });
  }

  // Watcher actions
  openCreateWatcher(): void {
    this.watcherToEdit.set(null);
    this.validationResult.set(null);
    this.isCreateWatcherOpen.set(true);
  }

  openEditWatcher(w: WatcherState, event?: Event): void {
    if (event) event.stopPropagation();
    this.watcherToEdit.set(w);
    this.isEditWatcherOpen.set(true);
  }

  closeWatcherModal(): void {
    this.isCreateWatcherOpen.set(false);
    this.isEditWatcherOpen.set(false);
    this.watcherToEdit.set(null);
  }

  validateUrl(data: { url: string; protocol: string }): void {
    this.isValidatingUrl.set(true);
    this.validationResult.set(null);

    this.watchersService.validateFeedUrl(data.url, data.protocol).subscribe({
      next: (res) => {
        this.isValidatingUrl.set(false);
        this.validationResult.set({
          valid: res.valid,
          itemsCount: res.itemsCount,
        });
      },
      error: (err) => {
        this.isValidatingUrl.set(false);
        this.validationResult.set({
          valid: false,
          error: err.error?.error || 'Не удалось получить поток',
        });
      },
    });
  }

  saveWatcherModal(data: WatcherFormData): void {
    const tags = data.defaultTags
      ? data.defaultTags
          .split(',')
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean)
      : undefined;

    if (data.id) {
      // Edit
      this.watchersService
        .updateWatcher(data.id, {
          title: data.title,
          url: data.url,
          category: data.category,
          protocol: data.protocol,
          pollIntervalSeconds: data.pollIntervalMinutes * 60,
          defaultTags: tags,
          description: data.description || undefined,
        })
        .subscribe({
          next: () => {
            this.loadWatchers();
            this.closeWatcherModal();
          },
          error: (err) => alert(`Ошибка обновления: ${err.error?.error || err.message}`),
        });
    } else {
      // Create
      this.watchersService
        .addWatcher({
          title: data.title,
          slug: data.slug || undefined,
          url: data.url,
          category: data.category,
          protocol: data.protocol,
          pollIntervalSeconds: data.pollIntervalMinutes * 60,
          defaultTags: tags || [],
          description: data.description,
        })
        .subscribe({
          next: () => {
            this.loadWatchers();
            this.loadFolders();
            this.loadMetrics();
            this.closeWatcherModal();
          },
          error: (err) => alert(`Ошибка создания вотчера: ${err.error?.error || err.message}`),
        });
    }
  }

  openFeedArticles(w: WatcherState, event?: Event): void {
    if (event) event.stopPropagation();
    this.activeFeedWatcher.set(w);
    this.isFeedArticlesOpen.set(true);
    this.feedModalTab.set('history');

    this.isFeedHistoryLoading.set(true);
    this.feedPingHistory.set([]);
    this.watchersService.getWatcherPingHistory(w.id, 50).subscribe({
      next: (res) => {
        this.feedPingHistory.set(res.items);
        this.isFeedHistoryLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load ping history:', err);
        this.isFeedHistoryLoading.set(false);
      },
    });

    this.isFeedArticlesLoading.set(true);
    this.feedArticles.set([]);
    this.feedArticlesTotal.set(0);
    this.watchersService.getWatcherArticles(w.id, 50, 0).subscribe({
      next: (res) => {
        this.feedArticles.set(res.items);
        this.feedArticlesTotal.set(res.total);
        this.isFeedArticlesLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load feed articles:', err);
        this.isFeedArticlesLoading.set(false);
      },
    });
  }

  setFeedModalTab(tab: 'history' | 'articles'): void {
    this.feedModalTab.set(tab);
  }

  closeFeedArticles(): void {
    this.isFeedArticlesOpen.set(false);
    this.activeFeedWatcher.set(null);
    this.feedArticles.set([]);
    this.feedPingHistory.set([]);
  }

  triggerWatcher(w: WatcherState, event?: Event): void {
    if (event) event.stopPropagation();
    if (w.enabled === false) {
      console.warn(`[LemonWatchers] Watcher "${w.title}" is paused.`);
      return;
    }
    this.pollingWatcherIds.update((s) => new Set(s).add(w.id));

    this.watchersService.triggerWatcher(w.id).subscribe({
      next: () => {
        this.pollingWatcherIds.update((s) => {
          const next = new Set(s);
          next.delete(w.id);
          return next;
        });
        this.loadWatchers();
        this.loadArticles();
        this.loadMetrics();
      },
      error: () => {
        this.pollingWatcherIds.update((s) => {
          const next = new Set(s);
          next.delete(w.id);
          return next;
        });
      },
    });
  }

  triggerAllWatchers(): void {
    this.isTriggeringAll.set(true);
    this.watchersService.triggerAll().subscribe({
      next: () => {
        setTimeout(() => {
          this.isTriggeringAll.set(false);
          this.loadWatchers();
          this.loadArticles();
          this.loadMetrics();
        }, 1500);
      },
      error: () => this.isTriggeringAll.set(false),
    });
  }

  toggleAllCollection(): void {
    const shouldPause = this.anyActiveWatchers();
    this.isPausingAll.set(true);

    const action$ = shouldPause
      ? this.watchersService.pauseAll()
      : this.watchersService.resumeAll();

    action$.subscribe({
      next: () => {
        this.loadWatchers();
        this.loadMetrics();
        this.isPausingAll.set(false);
      },
      error: () => this.isPausingAll.set(false),
    });
  }

  toggleWatcher(w: WatcherState, event: Event): void {
    event.stopPropagation();
    const newEnabled = !w.enabled;
    this.watchersService.toggleWatcher(w.id, newEnabled).subscribe({
      next: () => {
        this.watchers.update((list) =>
          list.map((item) =>
            item.id === w.id
              ? { ...item, enabled: newEnabled, status: newEnabled ? 'IDLE' : 'PAUSED' }
              : item,
          ),
        );
        if (this.activeFeedWatcher()?.id === w.id) {
          this.activeFeedWatcher.update((feed) =>
            feed ? { ...feed, enabled: newEnabled, status: newEnabled ? 'IDLE' : 'PAUSED' } : null,
          );
        }
      },
    });
  }

  deleteWatcher(w: WatcherState, event: Event): void {
    event.stopPropagation();
    if (!confirm(`Удалить вотчер "${w.title}"?`)) return;

    this.watchersService.deleteWatcher(w.id).subscribe({
      next: () => {
        this.loadWatchers();
        this.loadFolders();
        this.loadMetrics();
      },
    });
  }

  // Articles & Pagination
  onWatchersSearchChange(query: string): void {
    this.searchQuery.set(query);
  }

  onArticlesSearchChange(query: string): void {
    this.searchQuery.set(query);
    this.articlesOffset.set(0);
    this.loadArticles();
  }

  onSearchChange(): void {
    this.articlesOffset.set(0);
    this.loadArticles();
  }

  prevPage(): void {
    if (this.articlesOffset() > 0) {
      this.articlesOffset.update((o) => Math.max(0, o - this.articlesLimit()));
      this.loadArticles();
    }
  }

  nextPage(): void {
    if (this.articlesOffset() + this.articlesLimit() < this.articlesTotal()) {
      this.articlesOffset.update((o) => o + this.articlesLimit());
      this.loadArticles();
    }
  }

  openArticleModal(a: WatcherArticle): void {
    this.selectedArticle.set(a);
  }

  closeArticleModal(): void {
    this.selectedArticle.set(null);
  }

  // Navigation Tab Switching
  setTab(tab: DashboardTab): void {
    if (this.activeTab() !== tab) {
      this.activeTab.set(tab);
      this.handleTabActivation(tab);
    }
    this.router.navigate(['/dashboard', tab], {
      queryParamsHandling: 'preserve',
    });
  }

  private handleTabActivation(tab: DashboardTab): void {
    if (tab === 'story') {
      this.loadStory();
    } else if (tab === 'raw-news') {
      this.loadRawNews();
    } else if (tab === 'articles') {
      this.loadArticles();
      this.loadBusStatus();
    }
  }

  // LemonBus Bridge & Publishing Methods
  loadBusStatus(): void {
    this.watchersService.getBusStatus().subscribe({
      next: (status) => this.busStatus.set(status),
      error: (err) => console.warn('Failed to load LemonBus status:', err),
    });
  }

  generateArticleCover(article: WatcherArticle): void {
    this.generatingCoverIds.update((s) => new Set(s).add(article.id));
    this.watchersService.generateArticleCover(article.id).subscribe({
      next: (res) => {
        this.generatingCoverIds.update((s) => {
          const next = new Set(s);
          next.delete(article.id);
          return next;
        });
        this.articles.update((list) =>
          list.map((a) => (a.id === article.id ? res.article : a)),
        );
        if (this.selectedArticle()?.id === article.id) {
          this.selectedArticle.set(res.article);
        }
      },
      error: (err) => {
        this.generatingCoverIds.update((s) => {
          const next = new Set(s);
          next.delete(article.id);
          return next;
        });
        console.error('Failed to generate article cover:', err);
      },
    });
  }

  fetchOriginalArticleCover(article: WatcherArticle): void {
    this.fetchingOriginalCoverIds.update((s) => new Set(s).add(article.id));
    this.watchersService.fetchOriginalCover(article.id).subscribe({
      next: (res) => {
        this.fetchingOriginalCoverIds.update((s) => {
          const next = new Set(s);
          next.delete(article.id);
          return next;
        });
        this.articles.update((list) =>
          list.map((a) => (a.id === article.id ? res.article : a)),
        );
        if (this.selectedArticle()?.id === article.id) {
          this.selectedArticle.set(res.article);
        }
      },
      error: (err) => {
        this.fetchingOriginalCoverIds.update((s) => {
          const next = new Set(s);
          next.delete(article.id);
          return next;
        });
        console.error('Failed to fetch original article cover:', err);
      },
    });
  }

  assistArticleContent(event: {
    article: WatcherArticle;
    action: 'rewrite' | 'expand' | 'summarize';
  }): void {
    const { article, action } = event;
    this.assistingArticleIds.update((s) => new Set(s).add(article.id));
    this.watchersService.assistArticleContent(article.id, { action }).subscribe({
      next: (res) => {
        this.assistingArticleIds.update((s) => {
          const next = new Set(s);
          next.delete(article.id);
          return next;
        });
        this.articles.update((list) =>
          list.map((a) => (a.id === article.id ? res.article : a)),
        );
        if (this.selectedArticle()?.id === article.id) {
          this.selectedArticle.set(res.article);
        }
      },
      error: (err) => {
        this.assistingArticleIds.update((s) => {
          const next = new Set(s);
          next.delete(article.id);
          return next;
        });
        console.error('Failed to assist article content:', err);
      },
    });
  }

  publishSingleToBus(article: WatcherArticle): void {
    this.publishingBusIds.update((s) => new Set(s).add(article.id));
    this.watchersService.publishArticleToBus(article.id).subscribe({
      next: (res) => {
        this.publishingBusIds.update((s) => {
          const next = new Set(s);
          next.delete(article.id);
          return next;
        });
        this.articles.update((list) =>
          list.map((a) =>
            a.id === article.id ? { ...a, busPublishedAt: res.article.busPublishedAt } : a,
          ),
        );
        if (this.selectedArticle()?.id === article.id) {
          this.selectedArticle.update((a) =>
            a ? { ...a, busPublishedAt: res.article.busPublishedAt } : null,
          );
        }
        this.loadBusStatus();
      },
      error: (err) => {
        this.publishingBusIds.update((s) => {
          const next = new Set(s);
          next.delete(article.id);
          return next;
        });
        console.error('Failed to publish article to LemonBus:', err);
      },
    });
  }

  publishAllPendingToBus(): void {
    this.isPublishingAllBus.set(true);
    this.watchersService.publishAllPendingBus().subscribe({
      next: () => {
        this.isPublishingAllBus.set(false);
        this.loadArticles();
        this.loadBusStatus();
      },
      error: (err) => {
        this.isPublishingAllBus.set(false);
        console.error('Failed to bulk publish to LemonBus:', err);
      },
    });
  }

  // Whole Story Methods
  loadStory(): void {
    this.isStoryLoading.set(true);
    this.watchersService.getStory(100, this.includeProxyLogs()).subscribe({
      next: (res) => {
        this.storyEvents.set(res.items);
        this.isStoryLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load story:', err);
        this.isStoryLoading.set(false);
      },
    });
  }

  toggleProxyLogs(): void {
    this.includeProxyLogs.update((v) => !v);
    this.loadStory();
  }

  openStoryEventModal(event: StoryEvent): void {
    this.selectedStoryEvent.set(event);
    this.isStoryModalOpen.set(true);

    const watcher = event.watcherId
      ? this.watchers().find((w) => w.id === event.watcherId || w.slug === event.watcherId) || null
      : null;
    this.storyModalWatcher.set(watcher);

    if (event.watcherId) {
      this.isStoryModalArticlesLoading.set(true);
      this.storyModalArticles.set([]);
      this.watchersService.getWatcherArticles(event.watcherId, 50, 0).subscribe({
        next: (res) => {
          this.storyModalArticles.set(res.items);
          this.storyModalArticlesTotal.set(res.total);
          this.isStoryModalArticlesLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to load story modal articles:', err);
          this.isStoryModalArticlesLoading.set(false);
        },
      });

      this.isStoryModalHistoryLoading.set(true);
      this.storyModalPingHistory.set([]);
      this.watchersService.getWatcherPingHistory(event.watcherId, 50).subscribe({
        next: (res) => {
          this.storyModalPingHistory.set(res.items);
          this.isStoryModalHistoryLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to load story modal ping history:', err);
          this.isStoryModalHistoryLoading.set(false);
        },
      });
    } else {
      this.storyModalArticles.set([]);
      this.storyModalPingHistory.set([]);
    }
  }

  closeStoryEventModal(): void {
    this.isStoryModalOpen.set(false);
    this.selectedStoryEvent.set(null);
    this.storyModalWatcher.set(null);
    this.storyModalArticles.set([]);
    this.storyModalPingHistory.set([]);
  }

  // Raw News (Stage 1 Collection & Conversion)
  loadRawNews(): void {
    this.isRawNewsLoading.set(true);
    this.watchersService
      .getRawNews({
        limit: this.rawNewsLimit(),
        offset: this.rawNewsOffset(),
        category: this.selectedFolderSlug() || undefined,
        status: this.rawNewsStatusFilter() || undefined,
        search: this.searchQuery() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.rawNewsItems.set(res.items);
          this.rawNewsTotal.set(res.total);
          this.isRawNewsLoading.set(false);
        },
        error: (err) => {
          console.error('Failed to load raw news:', err);
          this.isRawNewsLoading.set(false);
        },
      });
  }

  setRawNewsStatusFilter(status: string): void {
    this.rawNewsStatusFilter.set(status);
    this.rawNewsOffset.set(0);
    this.loadRawNews();
  }

  prevRawPage(): void {
    if (this.rawNewsOffset() > 0) {
      this.rawNewsOffset.update((o) => Math.max(0, o - this.rawNewsLimit()));
      this.loadRawNews();
    }
  }

  nextRawPage(): void {
    if (this.rawNewsOffset() + this.rawNewsLimit() < this.rawNewsTotal()) {
      this.rawNewsOffset.update((o) => o + this.rawNewsLimit());
      this.loadRawNews();
    }
  }

  convertSingleRawItem(item: RawNewsItem): void {
    this.convertingRawIds.update((s) => new Set(s).add(item.id));
    this.watchersService.convertRawNews(item.id).subscribe({
      next: (res) => {
        this.convertingRawIds.update((s) => {
          const next = new Set(s);
          next.delete(item.id);
          return next;
        });
        this.rawNewsItems.update((list) =>
          list.map((r) =>
            r.id === item.id ? { ...r, status: 'CONVERTED' as const, noteId: res.article.id } : r,
          ),
        );
        this.loadMetrics();
      },
      error: (err) => {
        this.convertingRawIds.update((s) => {
          const next = new Set(s);
          next.delete(item.id);
          return next;
        });
        console.error('Failed to convert raw item:', err);
      },
    });
  }

  // Raw News Selection & Batch Actions
  toggleRawNewsSelect(id: string): void {
    this.selectedRawNewsIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleAllRawNewsSelect(): void {
    const list = this.rawNewsItems();
    const allSelected =
      list.length > 0 && list.every((item) => this.selectedRawNewsIds().has(item.id));
    if (allSelected) {
      this.selectedRawNewsIds.set(new Set());
    } else {
      const ids = new Set(list.map((i) => i.id));
      this.selectedRawNewsIds.set(ids);
    }
  }

  clearSelectedRawNews(): void {
    this.selectedRawNewsIds.set(new Set());
  }

  convertSelectedRawNews(): void {
    const ids = Array.from(this.selectedRawNewsIds());
    if (ids.length === 0) return;

    this.isBatchActionRunning.set(true);
    this.watchersService.convertRawNewsBatch(ids).subscribe({
      next: () => {
        this.isBatchActionRunning.set(false);
        this.clearSelectedRawNews();
        this.loadRawNews();
        this.loadArticles();
        this.loadMetrics();
      },
      error: (err) => {
        this.isBatchActionRunning.set(false);
        console.error('Failed to batch convert raw news:', err);
      },
    });
  }

  convertAndPublishSelectedRawNews(): void {
    const ids = Array.from(this.selectedRawNewsIds());
    if (ids.length === 0) return;

    this.isBatchActionRunning.set(true);
    this.watchersService.convertAndPublishRawNewsBatch(ids).subscribe({
      next: () => {
        this.isBatchActionRunning.set(false);
        this.clearSelectedRawNews();
        this.loadRawNews();
        this.loadArticles();
        this.loadMetrics();
        this.loadBusStatus();
      },
      error: (err) => {
        this.isBatchActionRunning.set(false);
        console.error('Failed to batch convert and publish:', err);
      },
    });
  }

  convertAndPublishSingleRawNews(item: RawNewsItem): void {
    this.convertingRawIds.update((s) => new Set(s).add(item.id));
    this.watchersService.convertAndPublishSingleRawNews(item.id).subscribe({
      next: (res) => {
        this.convertingRawIds.update((s) => {
          const next = new Set(s);
          next.delete(item.id);
          return next;
        });
        this.rawNewsItems.update((list) =>
          list.map((r) =>
            r.id === item.id ? { ...r, status: 'CONVERTED' as const, noteId: res.article.id } : r,
          ),
        );
        this.loadArticles();
        this.loadMetrics();
        this.loadBusStatus();
      },
      error: (err) => {
        this.convertingRawIds.update((s) => {
          const next = new Set(s);
          next.delete(item.id);
          return next;
        });
        console.error('Failed to convert and publish:', err);
      },
    });
  }

  // Articles Selection & Batch Actions
  toggleArticleSelect(id: string): void {
    this.selectedArticleIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleAllArticlesSelect(): void {
    const list = this.articles();
    const allSelected = list.length > 0 && list.every((a) => this.selectedArticleIds().has(a.id));
    if (allSelected) {
      this.selectedArticleIds.set(new Set());
    } else {
      const ids = new Set(list.map((a) => a.id));
      this.selectedArticleIds.set(ids);
    }
  }

  clearSelectedArticles(): void {
    this.selectedArticleIds.set(new Set());
  }

  publishSelectedArticlesToBus(): void {
    const ids = Array.from(this.selectedArticleIds());
    if (ids.length === 0) return;

    this.isBatchActionRunning.set(true);
    this.watchersService.publishArticlesBatchToBus(ids).subscribe({
      next: () => {
        this.isBatchActionRunning.set(false);
        this.clearSelectedArticles();
        this.loadArticles();
        this.loadBusStatus();
      },
      error: (err) => {
        this.isBatchActionRunning.set(false);
        console.error('Failed to batch publish articles to LemonBus:', err);
      },
    });
  }

  processAllPendingRaw(): void {
    this.isProcessingAllPending.set(true);
    this.watchersService.processPendingRawNews().subscribe({
      next: () => {
        this.isProcessingAllPending.set(false);
        this.loadRawNews();
      },
      error: (err) => {
        console.error('Failed to process pending items:', err);
        this.isProcessingAllPending.set(false);
      },
    });
  }

  openRawDetail(item: RawNewsItem): void {
    this.selectedRawItem.set(item);
    this.isRawDetailOpen.set(true);
  }

  closeRawDetail(): void {
    this.isRawDetailOpen.set(false);
    this.selectedRawItem.set(null);
  }
}
