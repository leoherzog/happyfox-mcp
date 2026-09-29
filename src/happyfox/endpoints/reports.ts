/**
 * HappyFox report endpoints (Docs/1088): read-only views of one saved report. Runtime period
 * filters, sorting and paging are checked against the documented values before anything is sent.
 */

import { HappyFoxClient, HappyFoxAPIError, QueryParams } from '../client';
import { idSegment } from '../paths';
import { positiveInteger } from './pagination';

/** Each documented period_type and the ticket event the period applies to (Docs/1088 §9). */
export const REPORT_PERIOD_TYPES: Readonly<Record<string, string>> = {
  cr: 'ticket creation',
  as: 'ticket assignment',
  str: 'staff reply',
  cur: 'contact reply',
  prs: 'staff private note',
  srp: 'staff reply or private note',
  cl: 'ticket closure'
};

/** Each documented period_date_range_type (Docs/1088 §9). */
export const REPORT_PERIOD_RANGES: Readonly<Record<string, string>> = {
  sr: 'the range from period_start to period_end',
  tod: 'today',
  l7d: 'the last 7 days',
  mtd: 'month to date',
  ytd: 'year to date',
  pm: 'the previous month'
};

/** Each documented sort_key of the tabular view and what it orders by (Docs/1088 §9). */
export const TABULAR_SORT_KEYS: Readonly<Record<string, string>> = {
  ticket: 'ticket id',
  status: 'status order',
  created: 'ticket creation date',
  duedate: 'ticket due date, the default',
  assigned: 'assignee name'
};

/** sort_dir: a ascending (the default), d descending (Docs/1088 §9). */
export const REPORT_SORT_DIRECTIONS = ['a', 'd'] as const;

/** Largest page size of the paginated views (Docs/1088 §3). */
export const MAX_REPORT_PAGE_SIZE = 50;

/** period_start and period_end format (Docs/1088 §9). */
export const REPORT_DATE_PATTERN = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
const REPORT_DATE = new RegExp(REPORT_DATE_PATTERN);

/** A runtime period filter (Docs/1088 §9). With none of these, the report runs as saved. */
export interface ReportPeriod {
  period_type?: string;
  period_date_range_type?: string;
  /** yyyy-mm-dd, only with period_date_range_type "sr". */
  period_start?: string;
  /** yyyy-mm-dd, only with period_date_range_type "sr". */
  period_end?: string;
}

export interface ReportPaging {
  page?: number | string;
  size?: number | string;
}

/** Options for the tabular view (Docs/1088 §3, §9). */
export interface TabularDataParams extends ReportPeriod, ReportPaging {
  sort_key?: string;
  sort_dir?: string;
}

/** Options for the staff and contact views, whose only sort key is the name (Docs/1088 §5-7, §9). */
export interface NameSortedViewParams extends ReportPeriod, ReportPaging {
  sort_dir?: string;
}

function invalidArgument(message: string): HappyFoxAPIError {
  return new HappyFoxAPIError(message, 400, 'INVALID_ARGUMENT');
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function oneOf(value: unknown, allowed: readonly string[], param: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw invalidArgument(`Invalid ${param} ${JSON.stringify(value)}: expected one of ${allowed.join(', ')}.`);
  }
  return value;
}

/** A calendar date as yyyy-mm-dd. */
function reportDate(value: unknown, param: string): string {
  if (typeof value === 'string' && REPORT_DATE.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return value;
    }
  }
  throw invalidArgument(`Invalid ${param} ${JSON.stringify(value)}: expected a calendar date as yyyy-mm-dd.`);
}

/**
 * The query of a runtime period filter (Docs/1088 §9), in the order of the doc's examples.
 * period_start and period_end without a range type imply "sr".
 * @throws HappyFoxAPIError (400, INVALID_ARGUMENT) for an incomplete filter or an undocumented value
 */
function periodQuery(period: ReportPeriod): QueryParams {
  const hasDates = isPresent(period.period_start) || isPresent(period.period_end);
  const hasRange = isPresent(period.period_date_range_type);
  if (!isPresent(period.period_type) && !hasRange && !hasDates) return {};

  if (!isPresent(period.period_type)) {
    throw invalidArgument(
      `period_type is required with a period filter: one of ${Object.keys(REPORT_PERIOD_TYPES).join(', ')}.`
    );
  }
  const type = oneOf(period.period_type, Object.keys(REPORT_PERIOD_TYPES), 'period_type');
  const range = hasRange
    ? oneOf(period.period_date_range_type, Object.keys(REPORT_PERIOD_RANGES), 'period_date_range_type')
    : hasDates ? 'sr' : undefined;
  if (range === undefined) {
    throw invalidArgument(
      `period_date_range_type is required with period_type: one of ${Object.keys(REPORT_PERIOD_RANGES).join(', ')}.`
    );
  }

  if (range !== 'sr') {
    if (hasDates) {
      throw invalidArgument(`period_start and period_end apply only with period_date_range_type "sr", not "${range}".`);
    }
    return { period_type: type, period_date_range_type: range };
  }

  if (!isPresent(period.period_start) || !isPresent(period.period_end)) {
    throw invalidArgument('period_date_range_type "sr" needs both period_start and period_end, as yyyy-mm-dd.');
  }
  const start = reportDate(period.period_start, 'period_start');
  const end = reportDate(period.period_end, 'period_end');
  if (start > end) {
    throw invalidArgument(`period_start ${start} is after period_end ${end}.`);
  }
  return { period_start: start, period_end: end, period_type: type, period_date_range_type: 'sr' };
}

/** size and page (Docs/1088 §3). size defaults to the maximum, not HappyFox's 10. */
function paging(params: ReportPaging): QueryParams {
  return {
    size: Math.min(positiveInteger(params.size, 'size') ?? MAX_REPORT_PAGE_SIZE, MAX_REPORT_PAGE_SIZE),
    page: positiveInteger(params.page, 'page') ?? 1
  };
}

export class ReportEndpoints {
  constructor(private client: HappyFoxClient) {}

  /** Ticket, completed, assigned, pending and unassigned counts of one saved report (Docs/1088 §2). */
  async getReportSummary(reportId: number | string): Promise<any> {
    return await this.client.get(`/report/${idSegment(reportId, 'report_id')}/`);
  }

  /** One page of a report's tabular view (Docs/1088 §3), as {rows, page_count, ...}. */
  async getTabularData(reportId: number | string, params: TabularDataParams = {}): Promise<any> {
    const path = `/report/${idSegment(reportId, 'report_id')}/tabulardata/`;
    const query = periodQuery(params);
    if (isPresent(params.sort_key)) query.sort_key = oneOf(params.sort_key, Object.keys(TABULAR_SORT_KEYS), 'sort_key');
    if (isPresent(params.sort_dir)) query.sort_dir = oneOf(params.sort_dir, REPORT_SORT_DIRECTIONS, 'sort_dir');
    return await this.client.get(path, { ...query, ...paging(params) });
  }

  /** A report's response-time statistics (Docs/1088 §4), as a JSON array. */
  async getResponseStats(reportId: number | string, period: ReportPeriod = {}): Promise<any> {
    const path = `/report/${idSegment(reportId, 'report_id')}/responsestats/`;
    return await this.client.get(path, periodQuery(period));
  }

  /** One page of per-agent performance (Docs/1088 §5). */
  async getStaffPerformance(reportId: number | string, params: NameSortedViewParams = {}): Promise<any> {
    return await this.nameSortedView(`/report/${idSegment(reportId, 'report_id')}/staffperformance/`, params);
  }

  /** One page of per-agent ticket activity (Docs/1088 §6). */
  async getStaffActivity(reportId: number | string, params: NameSortedViewParams = {}): Promise<any> {
    return await this.nameSortedView(`/report/${idSegment(reportId, 'report_id')}/staffactivity/`, params);
  }

  /** One page of per-contact ticket activity (Docs/1088 §7). */
  async getContactActivity(reportId: number | string, params: NameSortedViewParams = {}): Promise<any> {
    return await this.nameSortedView(`/report/${idSegment(reportId, 'report_id')}/customeractivity/`, params);
  }

  /** A report's per-SLA results (Docs/1088 §8), as a JSON array. */
  async getSlaPerformance(reportId: number | string, period: ReportPeriod = {}): Promise<any> {
    const path = `/report/${idSegment(reportId, 'report_id')}/slaentries/`;
    return await this.client.get(path, periodQuery(period));
  }

  // Docs/1088 documents size and page under §3 only; these views return the same page_count
  // envelope. Unverified until tested against a live account.
  private async nameSortedView(path: string, params: NameSortedViewParams): Promise<any> {
    const query = periodQuery(params);
    if (isPresent(params.sort_dir)) {
      query.sort_key = 'name';
      query.sort_dir = oneOf(params.sort_dir, REPORT_SORT_DIRECTIONS, 'sort_dir');
    }
    return await this.client.get(path, { ...query, ...paging(params) });
  }
}
