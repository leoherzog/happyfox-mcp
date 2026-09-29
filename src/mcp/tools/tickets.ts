import { MCPTool, HappyFoxAuth } from '../../types';
import { HappyFoxClient } from '../../happyfox/client';
import {
  DUE_DATE_PATTERN,
  MAX_BULK_TICKETS,
  PRIVATE_NOTE_ALERT_GROUPS,
  STAFF_UPDATE_CONTACT_CUSTOM_FIELDS,
  TICKET_SORT_VALUES,
  TICKET_STATUS_KEYWORDS,
  TicketEndpoints
} from '../../happyfox/endpoints/tickets';
import {
  CONTACT_CUSTOM_FIELDS,
  CUSTOM_FIELD_VALUE_FORMATS,
  TICKET_CUSTOM_FIELDS,
  customFieldsSchema
} from '../../happyfox/endpoints/custom-fields';

/** A positive integer id, as a number or a digit string. */
const ID_TYPE = { type: ['integer', 'string'], pattern: '^[0-9]+$', minimum: 1 };

/** The ticket number every /ticket/<number>/ endpoint takes (Docs/1039 §3). */
export const TICKET_ID_PROPERTY = {
  ...ID_TYPE,
  description:
    'Numeric ticket number: the `id` of a ticket from happyfox_list_tickets, e.g. 3. Not the display id ' +
    '(`display_id`, e.g. #DC00000003). To find the number for a display id, call happyfox_list_tickets ' +
    'with query id:DC00000003 (without the #).'
};

const TICKET_PROPERTIES = {
  category: {
    ...ID_TYPE,
    description:
      'Id of a public category: one whose `public` is true in happyfox://categories. Tickets cannot be ' +
      'created in private categories.'
  },
  subject: { type: 'string', description: 'Ticket subject.' },
  text: { type: 'string', description: 'Message in plain text. Give text or html.' },
  html: { type: 'string', description: 'Message in HTML. Give text or html.' },
  client: {
    ...ID_TYPE,
    description:
      'Id of an existing contact to raise the ticket for, from happyfox_list_contacts. Replaces name and ' +
      'email: give either client, or name and email.'
  },
  name: { type: 'string', description: 'Contact name. Required with email unless client is given.' },
  email: { type: 'string', description: 'Contact email address. Required with name unless client is given.' },
  phone: { type: 'string', description: 'Contact phone number.' },
  priority: {
    ...ID_TYPE,
    description: 'Priority id from happyfox://priorities. Defaults to the account\'s default priority.'
  },
  assignee: {
    type: ['integer', 'string', 'null'],
    pattern: '^[0-9]+$',
    minimum: 1,
    description: 'Id of the agent to assign, from happyfox://staff. null leaves the ticket unassigned.'
  },
  tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add.' },
  cc: { type: 'array', items: { type: 'string' }, description: 'Email addresses to CC.' },
  bcc: { type: 'array', items: { type: 'string' }, description: 'Email addresses to BCC.' },
  created_at: {
    type: 'string',
    description:
      'Creation time to record instead of now, as yyyy-mm-ddThh:mm:ss or yyyy-mm-ddThh:mm:ss.ms, e.g. ' +
      'when importing past tickets.'
  },
  due_date: { type: 'string', pattern: DUE_DATE_PATTERN, description: 'Due date as yyyy-mm-dd or dd/mm/yyyy.' },
  visible_only_staff: {
    type: 'boolean',
    description: 'true makes the ticket private: visible to agents only.'
  },
  custom_fields: customFieldsSchema(
    [TICKET_CUSTOM_FIELDS, CONTACT_CUSTOM_FIELDS],
    'Custom field values keyed t-cf-<id> (ticket field, ids from happyfox://ticket-custom-fields) or ' +
      'c-cf-<id> (the contact\'s field, ids from happyfox://contact-custom-fields). Take ids only from ' +
      'those resources, never from agent portal URLs, and re-read them before sending choice ids. ' +
      `${CUSTOM_FIELD_VALUE_FORMATS} Every field marked \`required\` must be given; a ticket field ` +
      'applies only to the categories it lists.'
  )
};

const TICKET_REQUIRED = ['category', 'subject'];

/**
 * The acting agent's id. Omitted, it is filled in from TOOLS_REQUIRING_STAFF_ID.
 * @param role - what the agent does, e.g. "replying"
 */
function actingStaffProperty(role: string): Record<string, unknown> {
  return {
    ...ID_TYPE,
    description:
      `Id of the agent ${role}, from happyfox://staff. Defaults to the agent who authorized this ` +
      'connection. Another agent\'s id makes HappyFox act as that agent, with that agent\'s role permissions.'
  };
}

/** The html and plaintext alternatives of a staff reply or private note (Docs/1039 §8-9). */
function messageBodyProperties(what: string): Record<string, unknown> {
  return {
    html: { type: 'string', description: `${what} as HTML. Give html or plaintext, not both.` },
    plaintext: { type: 'string', description: `${what} as plain text. Give html or plaintext, not both.` }
  };
}

/** Both staff_update tools carry this (Docs/1039 §8). */
const NO_CONCURRENT_STAFF_UPDATES =
  'Never send two updates to the same ticket at once: HappyFox does not support concurrent staff updates on a ticket.';

/** The property changes staff_update and staff_pvtnote share (Docs/1039 §8-9). */
const PROPERTY_CHANGES = {
  status: { ...ID_TYPE, description: 'Status id to set, from happyfox://statuses.' },
  priority: { ...ID_TYPE, description: 'Priority id to set, from happyfox://priorities.' },
  assignee: {
    ...TICKET_PROPERTIES.assignee,
    description: 'Id of the agent to assign the ticket to, from happyfox://staff. null unassigns the ticket.'
  },
  time_spent: {
    type: ['integer', 'string'],
    pattern: '^[0-9]+$',
    minimum: 0,
    description:
      'Minutes to add to the ticket\'s time spent. Required when the ticket\'s category has ' +
      'time_spent_mandatory true in happyfox://categories.'
  },
  due_date: { type: 'string', pattern: DUE_DATE_PATTERN, description: 'Due date as yyyy-mm-dd or dd/mm/yyyy.' },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Tags for the ticket. HappyFox does not document whether these replace the ticket\'s tags or add to ' +
      'them; to add or remove particular tags, use happyfox_update_ticket_tags.'
  },
  custom_fields: customFieldsSchema(
    [TICKET_CUSTOM_FIELDS, STAFF_UPDATE_CONTACT_CUSTOM_FIELDS],
    'Custom field values keyed t-cf-<id> (ticket field, ids from happyfox://ticket-custom-fields) or ' +
      'ccf-<id> (the contact\'s field, ids from happyfox://contact-custom-fields). This call takes ccf-, not ' +
      'the c-cf- of happyfox_create_ticket. Re-read those resources before sending choice ids. ' +
      `${CUSTOM_FIELD_VALUE_FORMATS} Moving the ticket to a closed status requires every ticket field whose ` +
      'compulsory_on_completed is true.'
  )
};

const SORT_DESCRIPTION =
  'Sort order. Default: last contact or agent reply, newest first. Ignored when query is set, since ' +
  'search results are sorted by relevance. Values: ' +
  Object.entries(TICKET_SORT_VALUES).map(([value, meaning]) => `${value} (${meaning})`).join(', ') +
  '.';

const QUERY_DESCRIPTION =
  'HappyFox search string. Separate terms with spaces and write spaces inside quoted values as spaces: ' +
  'the + in HappyFox\'s URL examples is an encoded space, and a literal + is searched for as +. ' +
  'Terms: status:"New","In Progress" and priority:"High" take quoted names, comma-separated; ' +
  'assignee:none (unassigned), assignee:any (any agent) or assignee:<agent email, username, first or ' +
  'last name> (case-sensitive exact match, not a staff id); group:none, group:any or group:"<contact ' +
  'group name>"; contact:"<contact name, email or phone>"; tag:"a","b" (case-sensitive); ' +
  'id:<ticket numbers or display ids without #, comma-separated>, e.g. id:DC00000001,2; ' +
  'has_attachments:true, unresponded:true, breached:true; duedate:today, yesterday, tomorrow, overdue ' +
  'or "next 7 days". These time filters take a quoted yyyy/mm/dd date, e.g. created-after:"2024/01/15": ' +
  'created-on, created-before, created-after, created-on-or-before, created-on-or-after; ' +
  'last-staff-replied- and last-contact-replied- with those same five endings; last-modified-before, ' +
  'last-modified-after, last-modified-on-or-before, last-modified-on-or-after; last-closed-on-or-before, ' +
  'last-closed-on-or-after. Custom fields by name: Field:"value", or "Two Words":"value" with the ' +
  'name quoted, no space after the colon; dropdown and multiple-choice values are option labels, ' +
  'e.g. "Country":"finland","germany". For a date custom field, HappyFox\'s only example uses mm/dd/yyyy, ' +
  'not the yyyy/mm/dd of the time filters: "Date Field":"08/23/2019". Results are sorted by relevance, ' +
  'then last update.';

export class TicketTools {
  getTools(): Array<MCPTool & { handler: string }> {
    return [
      {
        name: 'happyfox_create_ticket',
        description:
          'Create a ticket (POST /tickets/). Needs category, subject, text or html, and either client (an ' +
          'existing contact id) or name and email. Returns the created ticket, shaped like happyfox_get_ticket.',
        handler: 'createTicket',
        inputSchema: {
          type: 'object',
          properties: TICKET_PROPERTIES,
          required: TICKET_REQUIRED
        }
      },
      {
        name: 'happyfox_list_tickets',
        description:
          'List tickets one page at a time (GET /tickets/), as {page_info, data}. Each ticket\'s `id` is the ' +
          'ticket number the other ticket tools take; `display_id` (e.g. #DC00000003) is the label agents see.',
        handler: 'listTickets',
        inputSchema: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, description: 'Page number, from 1 (default 1).' },
            size: { type: 'integer', minimum: 1, maximum: 50, description: 'Tickets per page, at most 50 (default 50).' },
            category: {
              type: 'array',
              items: ID_TYPE,
              description: 'Only tickets in these categories (ids from happyfox://categories).'
            },
            status: {
              type: ['string', 'integer'],
              pattern: `^(${TICKET_STATUS_KEYWORDS.join('|')}|[0-9]+)$`,
              description:
                '_all: every status (the default). _pending: every status whose behavior is pending, i.e. ' +
                'open tickets. Or one status id from happyfox://statuses. To match statuses by name, use ' +
                'query status:"<name>".'
            },
            query: { type: 'string', description: QUERY_DESCRIPTION },
            sort_by: { type: 'string', enum: Object.keys(TICKET_SORT_VALUES), description: SORT_DESCRIPTION },
            minify_response: {
              type: 'boolean',
              description: 'true returns only the list of ticket ids. To choose fields, use fields instead.'
            },
            fields: {
              type: 'array',
              items: { type: 'string' },
              description: 'Top-level ticket fields to return instead of whole tickets, e.g. ["id", "subject", "last_user_reply_at"].'
            }
          }
        }
      },
      {
        name: 'happyfox_get_ticket',
        description: 'Get one ticket with its full update history (GET /ticket/<number>/).',
        handler: 'getTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            show_cf_changes: { type: 'boolean', description: 'true adds each custom field change to the update history.' }
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_update_ticket_tags',
        description:
          'Add or remove ticket tags, leaving the others alone (POST /ticket/<number>/update_tags/). Give ' +
          'add, remove or both. HappyFox shows the acting agent\'s name on the change. Returns the updated ' +
          'ticket, shaped like happyfox_get_ticket.',
        handler: 'updateTicketTags',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: actingStaffProperty('making the change'),
            add: { type: 'array', items: { type: 'string' }, description: 'Tags to add.' },
            remove: { type: 'array', items: { type: 'string' }, description: 'Tags to remove.' }
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_update_ticket_custom_fields',
        description:
          'Set ticket custom field values (POST /ticket/<number>/update_custom_fields/). Takes ticket ' +
          'fields only; to set the contact\'s fields, use happyfox_update_ticket_properties.',
        handler: 'updateTicketCustomFields',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: actingStaffProperty('making the change'),
            custom_fields: {
              ...customFieldsSchema(
                [TICKET_CUSTOM_FIELDS],
                'At least one ticket custom field value, keyed t-cf-<id> with ids from ' +
                  'happyfox://ticket-custom-fields. Take ids only from that resource, never from agent portal ' +
                  `URLs, and re-read it before sending choice ids. ${CUSTOM_FIELD_VALUE_FORMATS}`
              ),
              minProperties: 1
            }
          },
          required: ['ticket_id', 'custom_fields']
        }
      },
      {
        name: 'happyfox_move_ticket_category',
        description:
          'Move a ticket to another category (POST /ticket/<number>/move/). The acting agent\'s role needs ' +
          'the permission to move tickets to another category, or HappyFox refuses. Returns {status_code, message}.',
        handler: 'moveTicketCategory',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: actingStaffProperty('moving the ticket'),
            target_category_id: {
              ...ID_TYPE,
              description: 'Id of the category to move the ticket to, from happyfox://categories.'
            },
            move_note: { type: 'string', description: 'Note to add to the ticket about the move.' },
            assign_to: {
              ...ID_TYPE,
              description: 'Id of the agent to assign the ticket to in its new category, from happyfox://staff.'
            }
          },
          required: ['ticket_id', 'target_category_id']
        }
      },
      {
        name: 'happyfox_add_staff_reply',
        description:
          'Reply to a ticket as an agent (POST /ticket/<number>/staff_update/). Give html or plaintext. ' +
          'HappyFox emails the reply to the ticket\'s contact only when update_customer is true; otherwise ' +
          'the reply is recorded on the ticket and the contact is not notified. The same call can change ' +
          'status, priority, assignee, due date, tags, time spent and custom fields. ' +
          `${NO_CONCURRENT_STAFF_UPDATES} Returns the updated ticket, shaped like happyfox_get_ticket.`,
        handler: 'addStaffReply',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: actingStaffProperty('replying'),
            ...messageBodyProperties('Reply'),
            update_customer: {
              type: 'boolean',
              description:
                'true emails the reply to the ticket\'s contact. Defaults to false: the contact is not notified.'
            },
            subject: { type: 'string', description: 'Subject of the reply email sent to the contact.' },
            cc: { type: 'array', items: { type: 'string' }, description: 'Email addresses to CC.' },
            bcc: { type: 'array', items: { type: 'string' }, description: 'Email addresses to BCC.' },
            send_survey: {
              type: 'boolean',
              description: 'true launches the satisfaction survey for the ticket. Defaults to false.'
            },
            last_staff_message: {
              ...ID_TYPE,
              description:
                'Id of the ticket\'s last staff message as you read it (updates[].message in ' +
                'happyfox_get_ticket). HappyFox checks it against the ticket\'s current last staff message to ' +
                'catch another agent replying first.'
            },
            parent_update: {
              ...ID_TYPE,
              description: 'Id of the parent update, for tickets created from Facebook or Twitter conversations.'
            },
            ...PROPERTY_CHANGES
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_update_ticket_properties',
        description:
          'Change a ticket\'s status, priority, assignee, due date, tags, time spent or custom fields without ' +
          'posting a message (POST /ticket/<number>/staff_update/). Give at least one of them. The contact is ' +
          `not notified. ${NO_CONCURRENT_STAFF_UPDATES} Returns the updated ticket, shaped like happyfox_get_ticket.`,
        handler: 'updateTicketProperties',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: actingStaffProperty('making the change'),
            ...PROPERTY_CHANGES
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_add_private_note',
        description:
          'Add a private note, visible to agents only (POST /ticket/<number>/staff_pvtnote/). Give html or ' +
          'plaintext; alert notifies agents of the note. The same call can change status, priority, ' +
          'assignee, due date, tags, time spent and custom fields.',
        handler: 'addPrivateNote',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: actingStaffProperty('adding the note'),
            ...messageBodyProperties('Note'),
            alert: {
              type: ['string', 'integer'],
              pattern: `^(${PRIVATE_NOTE_ALERT_GROUPS.join('|')}|[0-9]+)$`,
              description:
                'Send a private alert to s (every subscriber of the ticket), c (every agent in the ticket\'s ' +
                'category) or one agent, by id from happyfox://staff.'
            },
            ...PROPERTY_CHANGES
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_forward_ticket',
        description:
          'Email a ticket to addresses outside HappyFox (POST /ticket/<number>/forward/). Returns {message}.',
        handler: 'forwardTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: actingStaffProperty('forwarding the ticket'),
            to: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Email addresses to send to.' },
            cc: { type: 'array', items: { type: 'string' }, description: 'Email addresses to CC.' },
            bcc: { type: 'array', items: { type: 'string' }, description: 'Email addresses to BCC.' },
            subject: { type: 'string', description: 'Email subject.' },
            message: { type: 'string', description: 'Email message.' },
            to_include_ticket_contact: { type: 'boolean', description: 'true adds the ticket\'s contact to the To addresses.' },
            cc_include_ticket_contact: { type: 'boolean', description: 'true adds the ticket\'s contact to CC.' },
            send_all_messages: {
              type: 'boolean',
              description: 'Whether to include every message of the ticket. Defaults to true.'
            },
            include_pvt_notes: {
              type: 'boolean',
              description: 'Whether to include the ticket\'s private notes. Defaults to false.'
            },
            convert_replies_as_new_ticket: {
              type: 'boolean',
              description: 'Whether replies from the recipients become new tickets. Defaults to true.'
            }
          },
          required: ['ticket_id', 'to', 'subject', 'message']
        }
      },
      {
        name: 'happyfox_delete_ticket',
        description:
          'Delete a ticket permanently (POST /ticket/<number>/delete/). Returns {deleted_ticket} with its display id.',
        handler: 'deleteTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: actingStaffProperty('deleting the ticket')
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_add_contact_reply',
        description:
          'Add a reply on behalf of a contact, as if the contact had written it (POST /ticket/<number>/user_reply/).',
        handler: 'addContactReply',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            user: { ...ID_TYPE, description: 'Id of the contact replying, from happyfox_list_contacts.' },
            text: { type: 'string', description: 'Reply message, as plain text or HTML.' },
            cc: { type: 'array', items: { type: 'string' }, description: 'Email addresses to CC.' },
            bcc: { type: 'array', items: { type: 'string' }, description: 'Email addresses to BCC.' }
          },
          required: ['ticket_id', 'user', 'text']
        }
      },
      {
        name: 'happyfox_subscribe_to_ticket',
        description:
          'Subscribe agents to a ticket\'s notifications (POST /ticket/<number>/subscribe/). Returns {message} ' +
          'naming the agents added.',
        handler: 'subscribeToTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: {
              ...ID_TYPE,
              description:
                'Id of the agent to subscribe, from happyfox://staff. Defaults to the agent who authorized this connection.'
            },
            data: {
              type: 'array',
              items: ID_TYPE,
              description: 'Ids of more agents to subscribe in the same call, from happyfox://staff.'
            }
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_unsubscribe_from_ticket',
        description:
          'Unsubscribe an agent from a ticket\'s notifications (POST /ticket/<number>/unsubscribe/). Returns {message}.',
        handler: 'unsubscribeFromTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: TICKET_ID_PROPERTY,
            staff_id: {
              ...ID_TYPE,
              description:
                'Id of the agent to unsubscribe, from happyfox://staff. Defaults to the agent who authorized this connection.'
            }
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_create_tickets_bulk',
        description:
          `Create 1 to ${MAX_BULK_TICKETS} tickets in one request (POST /tickets/ with a list). Each ticket ` +
          'takes the fields of happyfox_create_ticket. HappyFox checks each ticket on its own and returns a ' +
          'list of {id, display_id, success: true} or {success: false, error: [{field, errors}]}, so check ' +
          'every entry. HappyFox documents no result order and a failed entry names no ticket, so before ' +
          'resending a ticket, check with happyfox_list_tickets that it was not created. The call fails ' +
          'only when no ticket was created.',
        handler: 'createTicketsBulk',
        inputSchema: {
          type: 'object',
          properties: {
            tickets: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_BULK_TICKETS,
              items: {
                type: 'object',
                properties: TICKET_PROPERTIES,
                required: TICKET_REQUIRED
              },
              description: `Tickets to create, at most ${MAX_BULK_TICKETS}.`
            }
          },
          required: ['tickets']
        }
      }
    ];
  }

  private endpoints(auth: HappyFoxAuth): TicketEndpoints {
    return new TicketEndpoints(new HappyFoxClient(auth));
  }

  async createTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).createTicket(args);
  }

  async listTickets(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).listTickets(args);
  }

  async getTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, show_cf_changes } = args;
    return await this.endpoints(auth).getTicket(ticket_id, { show_cf_changes });
  }

  async updateTicketTags(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, ...data } = args;
    return await this.endpoints(auth).updateTags(ticket_id, data);
  }

  async updateTicketCustomFields(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id, custom_fields } = args;
    return await this.endpoints(auth).updateCustomFields(ticket_id, custom_fields, staff_id);
  }

  async moveTicketCategory(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, ...data } = args;
    return await this.endpoints(auth).moveCategory(ticket_id, data);
  }

  async addStaffReply(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, ...data } = args;
    return await this.endpoints(auth).addStaffReply(ticket_id, data);
  }

  async updateTicketProperties(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, ...data } = args;
    return await this.endpoints(auth).updateTicketProperties(ticket_id, data);
  }

  async addPrivateNote(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, ...data } = args;
    return await this.endpoints(auth).addPrivateNote(ticket_id, data);
  }

  async forwardTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, ...data } = args;
    return await this.endpoints(auth).forwardTicket(ticket_id, data);
  }

  async deleteTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id } = args;
    return await this.endpoints(auth).deleteTicket(ticket_id, staff_id);
  }

  async addContactReply(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, ...data } = args;
    return await this.endpoints(auth).addContactReply(ticket_id, data);
  }

  async subscribeToTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id, data } = args;
    return await this.endpoints(auth).subscribeToTicket(ticket_id, staff_id, data);
  }

  async unsubscribeFromTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id } = args;
    return await this.endpoints(auth).unsubscribeFromTicket(ticket_id, staff_id);
  }

  async createTicketsBulk(args: any, auth: HappyFoxAuth): Promise<any> {
    const { tickets } = args;
    return await this.endpoints(auth).createTicketsBulk(tickets);
  }
}
