import { MCPTool, HappyFoxAuth } from '../../types';
import { HappyFoxClient } from '../../happyfox/client';
import { TicketEndpoints } from '../../happyfox/endpoints/tickets';

export class TicketTools {
  getTools(): Array<MCPTool & { handler: string }> {
    return [
      {
        name: 'happyfox_create_ticket',
        description: 'Create a new ticket in HappyFox',
        handler: 'createTicket',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Category ID' },
            subject: { type: 'string', description: 'Ticket subject' },
            text: { type: 'string', description: 'Ticket message text' },
            email: { type: 'string', description: 'Contact email address' },
            name: { type: 'string', description: 'Contact name' },
            phone: { type: 'string', description: 'Contact phone number' },
            priority: { type: 'string', description: 'Priority ID' },
            assignee: { type: 'string', description: 'Staff ID to assign to' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
            cc: { type: 'array', items: { type: 'string' }, description: 'CC email addresses' },
            bcc: { type: 'array', items: { type: 'string' }, description: 'BCC email addresses' },
            custom_fields: { type: 'object', description: 'Custom field values (t-cf-{id}: value)' }
          },
          required: ['category', 'subject', 'text', 'email', 'name']
        }
      },
      {
        name: 'happyfox_list_tickets',
        description: 'List tickets with filters',
        handler: 'listTickets',
        inputSchema: {
          type: 'object',
          properties: {
            page: { type: 'number', description: 'Page number (default: 1)' },
            size: { type: 'number', description: 'Page size (default: 50, max: 50)' },
            category: { type: 'string', description: 'Filter by category ID' },
            status: { type: 'string', description: 'Filter by status ID' },
            query: { type: 'string', description: 'Search query (use key:value syntax for advanced filters like assignee:email@example.com, assignee:--none, priority:"High", tag:"urgent")' },
            sort_by: { type: 'string', description: 'Sort field' },
            minify_response: { type: 'boolean', description: 'Return minimal ticket data for faster response' },
            fields: { type: 'array', items: { type: 'string' }, description: 'Specific fields to return (e.g., ["id", "subject", "status"])' }
          }
        }
      },
      {
        name: 'happyfox_get_ticket',
        description: 'Get ticket details by ID',
        handler: 'getTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            show_cf_changes: { type: 'boolean', description: 'Include custom field change history in response' }
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_update_ticket_tags',
        description: 'Add or remove tags from a ticket',
        handler: 'updateTicketTags',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            staff_id: { type: 'number', description: 'Staff ID performing the update' },
            add: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
            remove: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' }
          },
          required: ['ticket_id']
        }
      },
      {
        name: 'happyfox_update_ticket_custom_fields',
        description: 'Update custom field values on a ticket',
        handler: 'updateTicketCustomFields',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            staff: { type: 'number', description: 'Staff ID performing the update' },
            custom_fields: { type: 'object', description: 'Custom field values (t-cf-{id}: value)' }
          },
          required: ['ticket_id', 'custom_fields']
        }
      },
      {
        name: 'happyfox_move_ticket_category',
        description: 'Move a ticket to a different category',
        handler: 'moveTicketCategory',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            staff_id: { type: 'number', description: 'Staff ID performing the move' },
            target_category_id: { type: 'string', description: 'Target category ID' }
          },
          required: ['ticket_id', 'staff_id', 'target_category_id']
        }
      },
      {
        name: 'happyfox_add_staff_reply',
        description: 'Add a staff reply to a ticket (visible to contact)',
        handler: 'addStaffReply',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            staff_id: { type: 'number', description: 'Staff/Agent ID making the reply (required)' },
            text: { type: 'string', description: 'Reply text (HTML supported)' },
            cc: { type: 'array', items: { type: 'string' }, description: 'CC email addresses' },
            bcc: { type: 'array', items: { type: 'string' }, description: 'BCC email addresses' },
            status: { type: 'string', description: 'Update ticket status ID' },
            priority: { type: 'string', description: 'Update ticket priority ID' },
            assignee: { type: 'number', description: 'Reassign ticket to this Staff/Agent ID' }
          },
          required: ['ticket_id', 'staff_id', 'text']
        }
      },
      {
        name: 'happyfox_add_private_note',
        description: 'Add a private note to a ticket (visible only to staff)',
        handler: 'addPrivateNote',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            staff_id: { type: 'number', description: 'Staff/Agent ID making the note (required)' },
            text: { type: 'string', description: 'Note text (HTML supported)' },
            status: { type: 'string', description: 'Update ticket status ID' },
            priority: { type: 'string', description: 'Update ticket priority ID' }
          },
          required: ['ticket_id', 'staff_id', 'text']
        }
      },
      {
        name: 'happyfox_forward_ticket',
        description: 'Forward ticket to external email',
        handler: 'forwardTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            staff_id: { type: 'number', description: 'Staff/Agent ID forwarding the ticket (required)' },
            to: { type: 'array', items: { type: 'string' }, description: 'Forward to email addresses' },
            subject: { type: 'string', description: 'Email subject (required)' },
            message: { type: 'string', description: 'Email body (HTML supported)' }
          },
          required: ['ticket_id', 'staff_id', 'to', 'subject']
        }
      },
      {
        name: 'happyfox_delete_ticket',
        description: 'Delete a ticket (permanent)',
        handler: 'deleteTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            staff_id: { type: 'number', description: 'Staff/Agent ID performing the deletion (required)' }
          },
          required: ['ticket_id', 'staff_id']
        }
      },
      {
        name: 'happyfox_add_contact_reply',
        description: 'Add a contact/user reply to a ticket (simulates customer response)',
        handler: 'addContactReply',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            user: { type: 'number', description: 'Contact/user ID making the reply' },
            text: { type: 'string', description: 'Reply text (HTML supported)' },
            cc: { type: 'array', items: { type: 'string' }, description: 'CC email addresses' },
            bcc: { type: 'array', items: { type: 'string' }, description: 'BCC email addresses' }
          },
          required: ['ticket_id', 'user', 'text']
        }
      },
      {
        name: 'happyfox_subscribe_to_ticket',
        description: 'Subscribe an agent to receive notifications for a ticket',
        handler: 'subscribeToTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            staff_id: { type: 'number', description: 'Staff/Agent ID to subscribe' }
          },
          required: ['ticket_id', 'staff_id']
        }
      },
      {
        name: 'happyfox_unsubscribe_from_ticket',
        description: 'Unsubscribe an agent from ticket notifications',
        handler: 'unsubscribeFromTicket',
        inputSchema: {
          type: 'object',
          properties: {
            ticket_id: { type: 'string', description: 'Ticket ID' },
            staff_id: { type: 'number', description: 'Staff/Agent ID to unsubscribe' }
          },
          required: ['ticket_id', 'staff_id']
        }
      },
      {
        name: 'happyfox_create_tickets_bulk',
        description: 'Create multiple tickets in a single request (max 100 tickets)',
        handler: 'createTicketsBulk',
        inputSchema: {
          type: 'object',
          properties: {
            tickets: {
              type: 'array',
              maxItems: 100,
              items: {
                type: 'object',
                properties: {
                  category: { type: 'string', description: 'Category ID' },
                  subject: { type: 'string', description: 'Ticket subject' },
                  text: { type: 'string', description: 'Ticket message text' },
                  email: { type: 'string', description: 'Contact email address' },
                  name: { type: 'string', description: 'Contact name' },
                  phone: { type: 'string', description: 'Contact phone number' },
                  priority: { type: 'string', description: 'Priority ID' },
                  assignee: { type: 'string', description: 'Staff ID to assign to' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
                  cc: { type: 'array', items: { type: 'string' }, description: 'CC email addresses' },
                  bcc: { type: 'array', items: { type: 'string' }, description: 'BCC email addresses' },
                  custom_fields: { type: 'object', description: 'Custom field values (t-cf-{id}: value)' }
                },
                required: ['category', 'subject', 'text', 'email', 'name']
              },
              description: 'Array of ticket objects to create (max 100)'
            }
          },
          required: ['tickets']
        }
      }
    ];
  }

  async createTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.createTicket(args);
  }

  async listTickets(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.listTickets(args);
  }

  async getTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, show_cf_changes } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.getTicket(ticket_id, { show_cf_changes });
  }

  async updateTicketTags(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id, add, remove } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.updateTags(ticket_id, { add, remove, staff_id });
  }

  async updateTicketCustomFields(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff, custom_fields } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.updateCustomFields(ticket_id, custom_fields, staff);
  }

  async moveTicketCategory(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id, target_category_id } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.moveCategory(ticket_id, staff_id, target_category_id);
  }

  async addStaffReply(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id, text, cc, bcc, status, priority, assignee } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.addStaffReply(ticket_id, {
      text,
      staff_id,
      cc,
      bcc,
      status,
      priority,
      assignee
    });
  }

  async addPrivateNote(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id, text, status, priority } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.addPrivateNote(ticket_id, {
      text,
      staff_id,
      status,
      priority
    });
  }

  async forwardTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id, to, subject, message } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.forwardTicket(ticket_id, {
      to,
      subject,
      staff_id,
      message
    });
  }

  async deleteTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.deleteTicket(ticket_id, staff_id);
  }

  async addContactReply(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, user, text, cc, bcc } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.addContactReply(ticket_id, { text, user, cc, bcc });
  }

  async subscribeToTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.subscribeToTicket(ticket_id, staff_id);
  }

  async unsubscribeFromTicket(args: any, auth: HappyFoxAuth): Promise<any> {
    const { ticket_id, staff_id } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.unsubscribeFromTicket(ticket_id, staff_id);
  }

  async createTicketsBulk(args: any, auth: HappyFoxAuth): Promise<any> {
    const { tickets } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new TicketEndpoints(client);
    return await endpoints.createTicketsBulk(tickets);
  }
}
