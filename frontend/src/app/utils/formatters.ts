import { RawNewsStatus } from '../models';

export function formatDate(isoStr?: string | null): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getResonanceClass(score: number): string {
  if (score >= 80) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  if (score >= 60) return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';
  return 'bg-slate-700/30 text-slate-400 border-dark-700';
}

export function getRawStatusBadgeClass(status: RawNewsStatus): string {
  switch (status) {
    case 'PENDING':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'CONVERTING':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse';
    case 'CONVERTED':
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'FAILED':
      return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
    default:
      return 'bg-slate-700 text-slate-300';
  }
}

export function getStoryBadgeClass(type: string): string {
  switch (type) {
    case 'NEWS_COLLECTED':
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'NO_UPDATES':
      return 'bg-slate-700/50 text-slate-400 border-slate-600/30';
    case 'FLOW_ERROR':
      return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
    case 'PROXY_LOG':
      return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    default:
      return 'bg-slate-700 text-slate-300';
  }
}
