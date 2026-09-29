import { MCPTool, HappyFoxAuth } from '../../types';
import { HappyFoxClient } from '../../happyfox/client';
import {
  MAX_REPORT_PAGE_SIZE,
  REPORT_DATE_PATTERN,
  REPORT_PERIOD_RANGES,
  REPORT_PERIOD_TYPES,
  REPORT_SORT_DIRECTIONS,
  ReportEndpoints,
  TABULAR_SORT_KEYS
} from '../../happyfox/endpoints/reports';

/** A positive integer id, as a number or a digit string. */
const ID_TYPE = { type: ['integer', 'string'], pattern: '^[0-9]+$', minimum: 1 };

const REPORT_ID_PROPERTY = {
  ...ID_TYPE,
  description: 'Numeric id of a saved report, from happyfox://reports.'
};

function valueList(values: Readonly<Record<string, string>>): string {
  return Object.entries(values).map(([value, meaning]) => `${value} (${meaning})`).join(', ');
}

/** The runtime period filter every view but the summary accepts (Docs/1088 §9). */
const PERIOD_PROPERTIES = {
  period_type: {
    type: 'string',
    enum: Object.keys(REPORT_PERIOD_TYPES),
    description:
      `The ticket event the period applies to: ${valueList(REPORT_PERIOD_TYPES)}. Required with any other ` +
      'period_* parameter. Omit every period_* parameter to run the report as saved.'
  },
  period_date_range_type: {
    type: 'string',
    enum: Object.keys(REPORT_PERIOD_RANGES),
    description:
      `The period: ${valueList(REPORT_PERIOD_RANGES)}. Required with period_type; omitted, period_start ` +
      'and period_end imply sr.'
  },
  period_start: {
    type: 'string',
    pattern: REPORT_DATE_PATTERN,
    description: 'Start date as yyyy-mm-dd. Only with period_date_range_type sr, together with period_end.'
  },
  period_end: {
    type: 'string',
    pattern: REPORT_DATE_PATTERN,
    description: 'End date as yyyy-mm-dd, not before period_start. Only with period_date_range_type sr.'
  }
};

function pagingProperties(items: string): Record<string, unknown> {
  return {
    page: { type: 'integer', minimum: 1, description: 'Page number, from 1 (default 1). page_count gives the number of pages.' },
    size: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_REPORT_PAGE_SIZE,
      description: `${items} per page, at most ${MAX_REPORT_PAGE_SIZE} (default ${MAX_REPORT_PAGE_SIZE}).`
    }
  };
}

const SORT_DIR_PROPERTY = {
  type: 'string',
  enum: [...REPORT_SORT_DIRECTIONS],
  description: 'a ascending (the default), d descending.'
};

/** A paginated view sorted by name, the only sort key Docs/1088 §9 gives it. */
function nameSortedProperties(items: string, sortedBy: string): Record<string, unknown> {
  return {
    report_id: REPORT_ID_PROPERTY,
    ...PERIOD_PROPERTIES,
    ...pagingProperties(items),
    sort_dir: { ...SORT_DIR_PROPERTY, description: `Order by ${sortedBy}: ${SORT_DIR_PROPERTY.description}` }
  };
}

// last_index is the total count in both Docs/1088 §3 examples.
const PAGE_ENVELOPE = 'page_count, start_index, end_index, last_index (the total count), sort_key, sort_order';

export class ReportTools {
  getTools(): Array<MCPTool & { handler: string }> {
    return [
      {
        name: 'happyfox_get_report_summary',
        description:
          'Get the headline counts of one saved report (GET /report/<id>/): {ticket_count, completed_count, ' +
          'assigned_count, pending_count, unassigned_count} over the tickets the report matches. Takes no ' +
          'period filter; the other happyfox_get_report_* tools do.',
        handler: 'getReportSummary',
        inputSchema: {
          type: 'object',
          properties: { report_id: REPORT_ID_PROPERTY },
          required: ['report_id']
        }
      },
      {
        name: 'happyfox_get_report_tabular_data',
        description:
          'Get one page of a saved report\'s tabular view (GET /report/<id>/tabulardata/): {rows, ' +
          `${PAGE_ENVELOPE}}. Each row is a ticket: \`id\` is the numeric ticket number the ticket tools take, ` +
          '`display_id` (e.g. #NCC00003439) the label agents see, plus subject, status_id, status_name, ' +
          'assignee ("-" when unassigned) and due_date.',
        handler: 'getTabularData',
        inputSchema: {
          type: 'object',
          properties: {
            report_id: REPORT_ID_PROPERTY,
            ...PERIOD_PROPERTIES,
            ...pagingProperties('Rows'),
            sort_key: {
              type: 'string',
              enum: Object.keys(TABULAR_SORT_KEYS),
              description: `Order rows by ${valueList(TABULAR_SORT_KEYS)}.`
            },
            sort_dir: SORT_DIR_PROPERTY
          },
          required: ['report_id']
        }
      },
      {
        name: 'happyfox_get_report_response_stats',
        description:
          'Get a saved report\'s response statistics (GET /report/<id>/responsestats/): a JSON array of ' +
          '{avg, unit} objects, each with one breakdown list (average_first_response_time, ' +
          'average_response_time, average_no_of_replies or average_no_of_response_to_completed_state) of ' +
          'strings such as "19.32% responded within first 2 hours".',
        handler: 'getResponseStats',
        inputSchema: {
          type: 'object',
          properties: { report_id: REPORT_ID_PROPERTY, ...PERIOD_PROPERTIES },
          required: ['report_id']
        }
      },
      {
        name: 'happyfox_get_report_staff_performance',
        description:
          'Get one page of per-agent performance in a saved report (GET /report/<id>/staffperformance/): ' +
          '{staff_performance: [{staff_id, name, average_first_response_time, average_response_time, ' +
          'average_no_of_responses, average_no_of_responses_for_completion, average_time_to_ticket_complete, ' +
          `average_time_spent}], ${PAGE_ENVELOPE}}, sorted by agent name. staff_id matches happyfox://staff.`,
        handler: 'getStaffPerformance',
        inputSchema: {
          type: 'object',
          properties: nameSortedProperties('Agents', 'agent name'),
          required: ['report_id']
        }
      },
      {
        name: 'happyfox_get_report_staff_activity',
        description:
          'Get one page of per-agent ticket activity in a saved report (GET /report/<id>/staffactivity/): ' +
          '{staff_activity: [{staff_id, name, assigned, pending, completed, participated, no_of_replies, ' +
          `private_notes, time_spent}], ${PAGE_ENVELOPE}}, sorted by agent name. staff_id matches happyfox://staff.`,
        handler: 'getStaffActivity',
        inputSchema: {
          type: 'object',
          properties: nameSortedProperties('Agents', 'agent name'),
          required: ['report_id']
        }
      },
      {
        name: 'happyfox_get_report_contact_activity',
        description:
          'Get one page of per-contact ticket activity in a saved report (GET /report/<id>/customeractivity/): ' +
          '{customer_activity: [{contact_id, name, email, no_of_tickets, pending_tickets, completed_tickets, ' +
          `no_of_replies, time_spent}], ${PAGE_ENVELOPE}}, sorted by contact name. contact_id is what ` +
          'happyfox_get_contact takes.',
        handler: 'getContactActivity',
        inputSchema: {
          type: 'object',
          properties: nameSortedProperties('Contacts', 'contact name'),
          required: ['report_id']
        }
      },
      {
        name: 'happyfox_get_report_sla_performance',
        description:
          'Get a saved report\'s SLA performance (GET /report/<id>/slaentries/): a JSON array with one ' +
          '{name, target, achieved, ticketsChecked, ticketsBreached} per SLA. achieved is the percentage of ' +
          'checked tickets that met the SLA; target is the percentage aimed for.',
        handler: 'getSlaPerformance',
        inputSchema: {
          type: 'object',
          properties: { report_id: REPORT_ID_PROPERTY, ...PERIOD_PROPERTIES },
          required: ['report_id']
        }
      }
    ];
  }

  private endpoints(auth: HappyFoxAuth): ReportEndpoints {
    return new ReportEndpoints(new HappyFoxClient(auth));
  }

  async getReportSummary(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).getReportSummary(args.report_id);
  }

  async getTabularData(args: any, auth: HappyFoxAuth): Promise<any> {
    const { report_id, ...params } = args;
    return await this.endpoints(auth).getTabularData(report_id, params);
  }

  async getResponseStats(args: any, auth: HappyFoxAuth): Promise<any> {
    const { report_id, ...period } = args;
    return await this.endpoints(auth).getResponseStats(report_id, period);
  }

  async getStaffPerformance(args: any, auth: HappyFoxAuth): Promise<any> {
    const { report_id, ...params } = args;
    return await this.endpoints(auth).getStaffPerformance(report_id, params);
  }

  async getStaffActivity(args: any, auth: HappyFoxAuth): Promise<any> {
    const { report_id, ...params } = args;
    return await this.endpoints(auth).getStaffActivity(report_id, params);
  }

  async getContactActivity(args: any, auth: HappyFoxAuth): Promise<any> {
    const { report_id, ...params } = args;
    return await this.endpoints(auth).getContactActivity(report_id, params);
  }

  async getSlaPerformance(args: any, auth: HappyFoxAuth): Promise<any> {
    const { report_id, ...period } = args;
    return await this.endpoints(auth).getSlaPerformance(report_id, period);
  }
}
