/**
 * HappyFox ticket endpoints (Docs/1039). Arguments are checked against the documented request
 * shapes before anything is sent, so a bad call fails with an error naming the argument.
 */

import { HappyFoxClient, HappyFoxAPIError, formatErrorBody, QueryParams } from '../client';
import { idSegment } from '../paths';
import { CONTACT_CUSTOM_FIELDS, CustomFieldKind, TICKET_CUSTOM_FIELDS, customFieldEntries } from './custom-fields';
import { pageQuery } from './pagination';

/** One ticket for POST /tickets/ (Docs/1039 §4). */
export interface TicketInput {
  category: number | string;
  subject: string;
  /** At least one of text and html is required. */
  text?: string;
  html?: string;
  /** An existing contact's id; replaces name and email. */
  client?: number | string;
  name?: string;
  email?: string;
  phone?: string;
  priority?: number | string;
  /** null leaves the ticket unassigned. */
  assignee?: number | string | null;
  tags?: string[];
  cc?: string[];
  bcc?: string[];
  created_at?: string;
  due_date?: string;
  visible_only_staff?: boolean;
  custom_fields?: Record<string, unknown>;
}

export interface ListTicketsParams {
  page?: number;
  size?: number;
  /** One category id, or several sent as repeated `category` keys. */
  category?: number | string | Array<number | string>;
  /** `_all`, `_pending` or a status id. */
  status?: number | string;
  query?: string;
  sort_by?: string;
  minify_response?: boolean;
  fields?: string[];
}

/** Property changes that staff_update and staff_pvtnote both take (Docs/1039 §8-9). */
export interface TicketPropertyChanges {
  status?: number | string;
  priority?: number | string;
  /** null leaves the ticket unassigned. */
  assignee?: number | string | null;
  /** Minutes to add to the ticket's time spent. */
  time_spent?: number | string;
  due_date?: string;
  tags?: string[];
  /** Keyed t-cf-<id> or ccf-<id>. */
  custom_fields?: Record<string, unknown>;
}

/** A property-only staff_update (Docs/1039 §8.1). `staff_id` is sent as `staff`. */
export interface TicketPropertiesInput extends TicketPropertyChanges {
  staff_id: number | string;
}

/** A staff reply (Docs/1039 §8). Exactly one of html and plaintext is required. */
export interface StaffReplyInput extends TicketPropertiesInput {
  html?: string;
  plaintext?: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  update_customer?: boolean;
  send_survey?: boolean;
  last_staff_message?: number | string;
  parent_update?: number | string;
}

/** A private note (Docs/1039 §9). Exactly one of html and plaintext is required. */
export interface PrivateNoteInput extends TicketPropertiesInput {
  html?: string;
  plaintext?: string;
  /** `s` (every subscriber), `c` (every agent in the ticket's category) or one agent's id. */
  alert?: number | string;
}

/** A ticket forward (Docs/1039 §15). */
export interface ForwardTicketInput {
  staff_id: number | string;
  to: string[];
  subject: string;
  message: string;
  cc?: string[];
  bcc?: string[];
  to_include_ticket_contact?: boolean;
  cc_include_ticket_contact?: boolean;
  send_all_messages?: boolean;
  include_pvt_notes?: boolean;
  convert_replies_as_new_ticket?: boolean;
}

/** A category move (Docs/1039 §16). */
export interface MoveTicketInput {
  staff_id: number | string;
  target_category_id: number | string;
  move_note?: string;
  assign_to?: number | string;
}

/** A reply on behalf of the contact `user` (Docs/1039 §10). */
export interface ContactReplyInput {
  user: number | string;
  text: string;
  cc?: string[];
  bcc?: string[];
}

/**
 * Contact custom fields as staff_update and staff_pvtnote key them (Docs/1039 §8-9). Both field
 * tables give `ccf-<id>`; only the §8 example payload shows the `c-cf-` of ticket creation.
 */
export const STAFF_UPDATE_CONTACT_CUSTOM_FIELDS: CustomFieldKind = {
  prefix: 'ccf-',
  source: CONTACT_CUSTOM_FIELDS.source
};

const STAFF_UPDATE_CUSTOM_FIELDS = [TICKET_CUSTOM_FIELDS, STAFF_UPDATE_CONTACT_CUSTOM_FIELDS];

/** Private-note alert groups besides one agent's id (Docs/1039 §9). */
export const PRIVATE_NOTE_ALERT_GROUPS = ['s', 'c'] as const;

/** The due_date formats ticket create, staff_update and staff_pvtnote accept: yyyy-mm-dd or dd/mm/yyyy (Docs/1039 §4, §8-9). */
export const DUE_DATE_PATTERN = '^([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}/[0-9]{2}/[0-9]{4})$';
const DUE_DATE = new RegExp(DUE_DATE_PATTERN);

/** Each documented `sort` value for GET /tickets/ and what it orders by (Docs/1039 "Sorting list of tickets"). */
export const TICKET_SORT_VALUES: Readonly<Record<string, string>> = {
  categorya: 'category ascending',
  categoryd: 'category descending',
  subjecta: 'subject A to Z',
  subjectd: 'subject Z to A',
  due: 'due date',
  statusa: 'status order ascending',
  statusd: 'status order descending',
  prioritya: 'priority order ascending',
  priorityd: 'priority order descending',
  updated: 'last contact or agent reply, newest first',
  updatea: 'last contact or agent reply, oldest first',
  unresponded: 'unresponded tickets first',
  created: 'creation date, newest first',
  createa: 'creation date, oldest first',
  assigneea: 'assignee username ascending',
  assigneed: 'assignee username descending',
  last_modifiedd: 'last modified, newest first',
  last_modifieda: 'last modified, oldest first',
  ticketa: 'ticket number ascending',
  ticketd: 'ticket number descending',
  clienta: 'contact id ascending',
  // The doc also says "ascending" here; the a/d suffix convention says descending.
  clientd: 'contact id descending'
};

/** Documented `status` keywords for GET /tickets/ besides a status id (Docs/1039 §1). */
export const TICKET_STATUS_KEYWORDS = ['_all', '_pending'] as const;

export const MAX_BULK_TICKETS = 100;
const MAX_PAGE_SIZE = 50;

// A display id is the category prefix plus the ticket number, e.g. #HFS00000001 (Docs/1039 §3).
const DISPLAY_ID = /^#?([A-Za-z]+[0-9]+)$/;

function invalidArgument(message: string): HappyFoxAPIError {
  return new HappyFoxAPIError(message, 400, 'INVALID_ARGUMENT');
}

/**
 * The ticket number as a path segment (Docs/1039 §3).
 * @throws HappyFoxAPIError (400, INVALID_ID); for a display id the message says how to find the number
 */
function ticketNumber(value: unknown): string {
  try {
    return idSegment(value, 'ticket_id');
  } catch (error) {
    const displayId = typeof value === 'string' ? DISPLAY_ID.exec(value) : null;
    if (error instanceof HappyFoxAPIError && displayId) {
      throw new HappyFoxAPIError(
        `${error.message} Find its ticket number by listing tickets with query id:${displayId[1]} ` +
          'and using that ticket\'s id.',
        error.statusCode,
        error.code
      );
    }
    throw error;
  }
}

/** A positive integer id for a request body. */
function numericId(value: unknown, param: string): number {
  return Number(idSegment(value, param));
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function commaList(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined;
}

function optionalId(value: unknown, param: string): number | undefined {
  return isPresent(value) ? numericId(value, param) : undefined;
}

function optionalText(value: unknown, param: string): string | undefined {
  if (!isPresent(value)) return undefined;
  if (typeof value !== 'string') throw invalidArgument(`Invalid ${param}: expected a string.`);
  return value;
}

function flag(value: unknown, param: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw invalidArgument(`Invalid ${param} ${JSON.stringify(value)}: expected true or false.`);
  }
  return value;
}

/** A list of strings in HappyFox's comma-separated form; undefined for an absent or empty list. */
function stringList(value: unknown, param: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every(nonEmptyString)) {
    throw invalidArgument(`Invalid ${param}: expected a list of non-empty strings.`);
  }
  return commaList(value);
}

/** A whole number of minutes, as a number or a digit string. */
function minutes(value: unknown, param: string): number {
  const count = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw invalidArgument(`Invalid ${param} ${JSON.stringify(value)}: expected a whole number of minutes.`);
  }
  return count;
}

function dueDate(value: unknown, param = 'due_date'): string {
  if (typeof value !== 'string' || !DUE_DATE.test(value)) {
    throw invalidArgument(`Invalid ${param} ${JSON.stringify(value)}: expected yyyy-mm-dd or dd/mm/yyyy.`);
  }
  return value;
}

/** Copies every value that is not undefined into the payload; null is kept, since it unassigns. */
function withDefined(payload: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}

/** The html or plaintext body of a staff reply or private note (Docs/1039 §8-9). */
function messageBody({ html, plaintext }: { html?: unknown; plaintext?: unknown }): Record<string, string> {
  if (nonEmptyString(html) && nonEmptyString(plaintext)) throw invalidArgument('Give html or plaintext, not both.');
  if (nonEmptyString(html)) return { html };
  if (nonEmptyString(plaintext)) return { plaintext };
  throw invalidArgument('html or plaintext is required.');
}

/**
 * The property changes staff_update and staff_pvtnote share (Docs/1039 §8-9); absent ones are undefined.
 * @throws HappyFoxAPIError (400) naming the first argument outside its documented format
 */
function propertyChanges(data: TicketPropertyChanges): Record<string, unknown> {
  return {
    status: optionalId(data.status, 'status'),
    priority: optionalId(data.priority, 'priority'),
    assignee: data.assignee === null ? null : optionalId(data.assignee, 'assignee'),
    time_spent: isPresent(data.time_spent) ? minutes(data.time_spent, 'time_spent') : undefined,
    due_date: isPresent(data.due_date) ? dueDate(data.due_date) : undefined,
    tags: stringList(data.tags, 'tags'),
    ...customFieldEntries(data.custom_fields, STAFF_UPDATE_CUSTOM_FIELDS)
  };
}

function alertTarget(value: unknown): string | number | undefined {
  if (!isPresent(value)) return undefined;
  if ((PRIVATE_NOTE_ALERT_GROUPS as readonly unknown[]).includes(value)) return value as string;
  try {
    return numericId(value, 'alert');
  } catch {
    throw invalidArgument(
      `Invalid alert ${JSON.stringify(value)}: expected s (every subscriber), c (every agent in the ` +
        'ticket\'s category) or an agent id.'
    );
  }
}

function statusFilter(status: number | string): string {
  if (typeof status === 'string' && (TICKET_STATUS_KEYWORDS as readonly string[]).includes(status)) {
    return status;
  }
  try {
    return idSegment(status, 'status');
  } catch {
    throw invalidArgument(
      `Invalid status ${JSON.stringify(status)}: expected _all, _pending or a status id from ` +
        'happyfox://statuses. To match statuses by name, search with query status:"<name>".'
    );
  }
}

export class TicketEndpoints {
  constructor(private client: HappyFoxClient) {}

  /**
   * One ticket payload for POST /tickets/ (Docs/1039 §4).
   * @param label - prefix for argument names in errors, e.g. "tickets[2]."
   * @throws HappyFoxAPIError (400) naming the first argument that breaks the documented rules
   */
  private formatTicket(ticket: TicketInput, label = ''): Record<string, unknown> {
    if (typeof ticket !== 'object' || ticket === null || Array.isArray(ticket)) {
      throw invalidArgument(`Invalid ${label.replace(/\.$/, '') || 'ticket'}: expected a ticket object.`);
    }
    if (!nonEmptyString(ticket.subject)) {
      throw invalidArgument(`${label}subject is required.`);
    }
    const text = optionalText(ticket.text, `${label}text`);
    const html = optionalText(ticket.html, `${label}html`);
    if (!nonEmptyString(text) && !nonEmptyString(html)) {
      throw invalidArgument(`${label}text or ${label}html is required.`);
    }

    const payload: Record<string, unknown> = {
      category: numericId(ticket.category, `${label}category`),
      subject: ticket.subject
    };
    if (nonEmptyString(text)) payload.text = text;
    if (nonEmptyString(html)) payload.html = html;

    if (isPresent(ticket.client)) {
      if (isPresent(ticket.name) || isPresent(ticket.email)) {
        throw invalidArgument(`${label}client replaces name and email: give either client or name and email.`);
      }
      payload.client = numericId(ticket.client, `${label}client`);
    } else if (nonEmptyString(ticket.name) && nonEmptyString(ticket.email)) {
      payload.name = ticket.name;
      payload.email = ticket.email;
    } else {
      throw invalidArgument(
        `${label}name and ${label}email are required unless ${label}client gives an existing contact id.`
      );
    }

    withDefined(payload, {
      phone: optionalText(ticket.phone, `${label}phone`),
      priority: optionalId(ticket.priority, `${label}priority`),
      assignee: ticket.assignee === null ? null : optionalId(ticket.assignee, `${label}assignee`),
      tags: stringList(ticket.tags, `${label}tags`),
      cc: stringList(ticket.cc, `${label}cc`),
      bcc: stringList(ticket.bcc, `${label}bcc`),
      created_at: optionalText(ticket.created_at, `${label}created_at`),
      due_date: isPresent(ticket.due_date) ? dueDate(ticket.due_date, `${label}due_date`) : undefined,
      visible_only_staff: flag(ticket.visible_only_staff, `${label}visible_only_staff`)
    });

    return Object.assign(
      payload,
      customFieldEntries(ticket.custom_fields, [TICKET_CUSTOM_FIELDS, CONTACT_CUSTOM_FIELDS], `${label}custom_fields`)
    );
  }

  /**
   * Create one ticket (Docs/1039 §4).
   * @returns the created ticket, shaped like GET /ticket/<number>/
   */
  async createTicket(data: TicketInput): Promise<any> {
    return await this.client.post('/tickets/', this.formatTicket(data));
  }

  /**
   * One page of tickets (Docs/1039 §1-2).
   * @throws HappyFoxAPIError (400) for a page, size, category, status or sort value outside the documented set
   */
  async listTickets(params: ListTicketsParams = {}): Promise<any> {
    const query: QueryParams = pageQuery(params.page, params.size, MAX_PAGE_SIZE);

    if (isPresent(params.category)) {
      const categories = Array.isArray(params.category) ? params.category : [params.category];
      if (categories.length > 0) query.category = categories.map(id => idSegment(id, 'category'));
    }

    if (isPresent(params.status)) {
      query.status = statusFilter(params.status as number | string);
    } else if (nonEmptyString(params.query)) {
      // Docs/1039 §1 gives a search as status=_all&q=... or status=_pending&q=...
      query.status = '_all';
    }

    if (nonEmptyString(params.query)) query.q = params.query;

    if (isPresent(params.sort_by)) {
      if (typeof params.sort_by !== 'string' || !Object.hasOwn(TICKET_SORT_VALUES, params.sort_by)) {
        throw invalidArgument(
          `Invalid sort_by ${JSON.stringify(params.sort_by)}: expected one of ` +
            `${Object.keys(TICKET_SORT_VALUES).join(', ')}.`
        );
      }
      query.sort = params.sort_by;
    }

    if (params.minify_response === true) query.minify_response = true;
    const fields = stringList(params.fields, 'fields');
    if (fields) query.fields = fields;

    return await this.client.get('/tickets/', query);
  }

  /** One ticket with its updates (Docs/1039 §3), by ticket number. */
  async getTicket(ticketId: number | string, params: {
    show_cf_changes?: boolean;
  } = {}): Promise<any> {
    return await this.client.get(
      `/ticket/${ticketNumber(ticketId)}/`,
      params.show_cf_changes === true ? { show_cf_changes: true } : undefined
    );
  }

  /**
   * Add or remove tags, leaving the ticket's other tags alone (Docs/1039 §12).
   * @throws HappyFoxAPIError (400) when neither add nor remove holds a tag
   */
  async updateTags(ticketId: number | string, data: {
    add?: string[];
    remove?: string[];
    staff_id?: number | string;
  }): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/update_tags/`;
    const payload = withDefined({}, {
      add: stringList(data.add, 'add'),
      remove: stringList(data.remove, 'remove'),
      staff_id: optionalId(data.staff_id, 'staff_id')
    });
    if (payload.add === undefined && payload.remove === undefined) {
      throw invalidArgument('Give at least one tag to add or remove.');
    }
    return await this.client.post(path, payload);
  }

  /**
   * Set ticket custom field values (Docs/1039 §11).
   * @param fields - keyed t-cf-<id>, the only custom fields this endpoint documents
   * @param staffId - the acting agent, sent as the required `staff`
   * @throws HappyFoxAPIError (400) for any other key, or when no field is given
   */
  async updateCustomFields(
    ticketId: number | string,
    fields: Record<string, unknown>,
    staffId: number | string
  ): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/update_custom_fields/`;
    const entries = customFieldEntries(fields, [TICKET_CUSTOM_FIELDS]);
    if (Object.keys(entries).length === 0) {
      throw invalidArgument('custom_fields needs at least one t-cf-<id> value.');
    }
    return await this.client.post(path, { staff: numericId(staffId, 'staff_id'), ...entries });
  }

  /** Move a ticket to another category (Docs/1039 §16). */
  async moveCategory(ticketId: number | string, data: MoveTicketInput): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/move/`;
    const payload = withDefined({
      staff_id: numericId(data.staff_id, 'staff_id'),
      target_category_id: numericId(data.target_category_id, 'target_category_id')
    }, {
      move_note: optionalText(data.move_note, 'move_note'),
      assign_to: optionalId(data.assign_to, 'assign_to')
    });
    return await this.client.post(path, payload);
  }

  /**
   * Reply as an agent (Docs/1039 §8). The contact is emailed only when update_customer is true.
   * @returns the updated ticket, shaped like GET /ticket/<number>/
   */
  async addStaffReply(ticketId: number | string, data: StaffReplyInput): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/staff_update/`;
    const payload = withDefined({ staff: numericId(data.staff_id, 'staff_id'), ...messageBody(data) }, {
      cc: stringList(data.cc, 'cc'),
      bcc: stringList(data.bcc, 'bcc'),
      subject: optionalText(data.subject, 'subject'),
      update_customer: flag(data.update_customer, 'update_customer'),
      send_survey: flag(data.send_survey, 'send_survey'),
      last_staff_message: optionalId(data.last_staff_message, 'last_staff_message'),
      parent_update: optionalId(data.parent_update, 'parent_update'),
      ...propertyChanges(data)
    });
    return await this.client.post(path, payload);
  }

  /**
   * Change ticket properties without posting a message (Docs/1039 §8.1).
   * @returns the updated ticket, shaped like GET /ticket/<number>/
   * @throws HappyFoxAPIError (400) when no property is given
   */
  async updateTicketProperties(ticketId: number | string, data: TicketPropertiesInput): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/staff_update/`;
    const staff = numericId(data.staff_id, 'staff_id');
    const changes = withDefined({}, propertyChanges(data));
    if (Object.keys(changes).length === 0) {
      throw invalidArgument(
        'Give at least one property to change: status, priority, assignee, time_spent, due_date, tags or custom_fields.'
      );
    }
    return await this.client.post(path, { staff, ...changes });
  }

  /** Add a note visible to agents only (Docs/1039 §9). */
  async addPrivateNote(ticketId: number | string, data: PrivateNoteInput): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/staff_pvtnote/`;
    const payload = withDefined({ staff: numericId(data.staff_id, 'staff_id'), ...messageBody(data) }, {
      alert: alertTarget(data.alert),
      ...propertyChanges(data)
    });
    return await this.client.post(path, payload);
  }

  /** Email a ticket to outside addresses (Docs/1039 §15). */
  async forwardTicket(ticketId: number | string, data: ForwardTicketInput): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/forward/`;
    const to = stringList(data.to, 'to');
    if (to === undefined) throw invalidArgument('to is required: a list of at least one email address.');
    if (!nonEmptyString(data.subject)) throw invalidArgument('subject is required.');
    if (!nonEmptyString(data.message)) throw invalidArgument('message is required.');

    const payload = withDefined({
      staff_id: numericId(data.staff_id, 'staff_id'),
      to,
      subject: data.subject,
      message: data.message
    }, {
      cc: stringList(data.cc, 'cc'),
      bcc: stringList(data.bcc, 'bcc'),
      to_include_ticket_contact: flag(data.to_include_ticket_contact, 'to_include_ticket_contact'),
      cc_include_ticket_contact: flag(data.cc_include_ticket_contact, 'cc_include_ticket_contact'),
      send_all_messages: flag(data.send_all_messages, 'send_all_messages'),
      include_pvt_notes: flag(data.include_pvt_notes, 'include_pvt_notes'),
      convert_replies_as_new_ticket: flag(data.convert_replies_as_new_ticket, 'convert_replies_as_new_ticket')
    });
    return await this.client.post(path, payload);
  }

  /** Delete a ticket permanently (Docs/1039 §17). */
  async deleteTicket(ticketId: number | string, staffId: number | string): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/delete/`;
    return await this.client.post(path, { staff_id: numericId(staffId, 'staff_id') });
  }

  /** Add a reply on behalf of a contact (Docs/1039 §10). */
  async addContactReply(ticketId: number | string, data: ContactReplyInput): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/user_reply/`;
    if (!nonEmptyString(data.text)) throw invalidArgument('text is required.');
    const payload = withDefined({ user: numericId(data.user, 'user'), text: data.text }, {
      cc: stringList(data.cc, 'cc'),
      bcc: stringList(data.bcc, 'bcc')
    });
    return await this.client.post(path, payload);
  }

  /**
   * Subscribe agents to a ticket (Docs/1039 §13).
   * @param staffId - the agent to subscribe
   * @param moreStaffIds - further agents, sent as the documented `data` list
   */
  async subscribeToTicket(
    ticketId: number | string,
    staffId: number | string,
    moreStaffIds?: Array<number | string>
  ): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/subscribe/`;
    const payload: Record<string, unknown> = { staff_id: numericId(staffId, 'staff_id') };
    if (moreStaffIds !== undefined && moreStaffIds !== null) {
      if (!Array.isArray(moreStaffIds)) throw invalidArgument('Invalid data: expected a list of agent ids.');
      if (moreStaffIds.length > 0) payload.data = moreStaffIds.map((id, index) => numericId(id, `data[${index}]`));
    }
    return await this.client.post(path, payload);
  }

  /** Unsubscribe an agent from a ticket (Docs/1039 §14). */
  async unsubscribeFromTicket(ticketId: number | string, staffId: number | string): Promise<any> {
    const path = `/ticket/${ticketNumber(ticketId)}/unsubscribe/`;
    return await this.client.post(path, { staff_id: numericId(staffId, 'staff_id') });
  }

  /**
   * Create 1 to 100 tickets in one request (Docs/1039 §5). Every ticket is checked before sending.
   * @returns HappyFox's per-ticket results, when at least one ticket was created. Docs/1039 §5 states
   *   no order, and a failed entry names no ticket
   * @throws HappyFoxAPIError (400) for invalid input, or when HappyFox rejected every ticket; both name
   *   a ticket as `tickets[<index>]`
   */
  async createTicketsBulk(tickets: TicketInput[]): Promise<any> {
    if (!Array.isArray(tickets) || tickets.length === 0) {
      throw invalidArgument('At least one ticket is required.');
    }
    if (tickets.length > MAX_BULK_TICKETS) {
      throw invalidArgument(`Bulk ticket creation limited to ${MAX_BULK_TICKETS} tickets per request.`);
    }

    const payload = tickets.map((ticket, index) => this.formatTicket(ticket, `tickets[${index}].`));
    const results = await this.client.post('/tickets/', payload);

    const failed = (item: unknown) => typeof item === 'object' && item !== null && (item as any).success === false;
    if (Array.isArray(results) && results.length > 0 && results.every(failed)) {
      throw new HappyFoxAPIError(
        `No tickets were created. ${formatErrorBody(results, index => `tickets[${index}]`) ?? ''}`.trim(),
        400,
        'API_ERROR'
      );
    }
    return results;
  }
}
