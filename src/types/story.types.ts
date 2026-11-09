export interface StoryEvent {
  id: string;
  type: 'NEWS_COLLECTED' | 'NO_UPDATES' | 'FLOW_ERROR' | 'PROXY_LOG' | 'FLOW_START';
  title: string;
  description: string;
  watcherId?: string;
  watcherTitle?: string;
  statusCode?: number;
  latencyMs?: number;
  itemsCount?: number;
  newItemsCount?: number;
  isProxyOnly?: boolean;
  timestamp: string;
}
