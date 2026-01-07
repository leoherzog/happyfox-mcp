import { MCPTool, HappyFoxAuth } from '../../types';
import { HappyFoxClient } from '../../happyfox/client';
import { ContactEndpoints } from '../../happyfox/endpoints/contacts';

export class ContactTools {
  getTools(): Array<MCPTool & { handler: string }> {
    return [
      {
        name: 'happyfox_create_contact',
        description: 'Create a new contact in HappyFox',
        handler: 'createContact',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Contact name' },
            email: { type: 'string', description: 'Contact email address' },
            phones: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  number: { type: 'string', description: 'Phone number' },
                  type: { type: 'string', enum: ['mobile', 'work', 'main', 'home', 'other'], description: 'Phone type' },
                  is_primary: { type: 'boolean', description: 'Set as primary phone' }
                },
                required: ['number', 'type']
              },
              description: 'Phone numbers with types (mo=mobile, w=work, m=main, h=home, o=other)'
            },
            contact_groups: {
              type: 'array',
              items: { type: 'string' },
              description: 'Contact group IDs'
            },
            is_login_enabled: {
              type: 'boolean',
              description: 'Allow contact to login to support center'
            },
            custom_fields: {
              type: 'object',
              description: 'Custom field values (c-cf-{id}: value)'
            }
          },
          required: ['name', 'email']
        }
      },
      {
        name: 'happyfox_list_contacts',
        description: 'List contacts with optional search',
        handler: 'listContacts',
        inputSchema: {
          type: 'object',
          properties: {
            page: { type: 'number', description: 'Page number (default: 1)' },
            size: { type: 'number', description: 'Page size (default: 50, max: 50)' },
            query: { type: 'string', description: 'Search query (searches name, email, phone)' }
          }
        }
      },
      {
        name: 'happyfox_get_contact',
        description: 'Get contact details by ID',
        handler: 'getContact',
        inputSchema: {
          type: 'object',
          properties: {
            contact_id: { type: 'string', description: 'Contact ID' }
          },
          required: ['contact_id']
        }
      },
      {
        name: 'happyfox_update_contact',
        description: 'Update contact information',
        handler: 'updateContact',
        inputSchema: {
          type: 'object',
          properties: {
            contact_id: { type: 'string', description: 'Contact ID' },
            name: { type: 'string', description: 'Contact name' },
            email: { type: 'string', description: 'Contact email address' },
            phones: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  number: { type: 'string', description: 'Phone number' },
                  type: { type: 'string', enum: ['mobile', 'work', 'main', 'home', 'other'], description: 'Phone type' },
                  is_primary: { type: 'boolean', description: 'Set as primary phone' },
                  id: { type: 'number', description: 'Phone ID (required when updating existing phone)' }
                },
                required: ['number', 'type']
              },
              description: 'Phone numbers with types'
            },
            contact_groups: {
              type: 'array',
              items: { type: 'string' },
              description: 'Contact group IDs'
            },
            is_login_enabled: {
              type: 'boolean',
              description: 'Allow contact to login to support center'
            },
            custom_fields: {
              type: 'object',
              description: 'Custom field values (c-cf-{id}: value)'
            }
          },
          required: ['contact_id']
        }
      },
      {
        name: 'happyfox_create_contact_group',
        description: 'Create a new contact group',
        handler: 'createContactGroup',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Group name' },
            description: { type: 'string', description: 'Group description' }
          },
          required: ['name']
        }
      },
      {
        name: 'happyfox_get_contact_group',
        description: 'Get contact group details',
        handler: 'getContactGroup',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Contact group ID' }
          },
          required: ['group_id']
        }
      },
      {
        name: 'happyfox_update_contact_group',
        description: 'Update a contact group',
        handler: 'updateContactGroup',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Contact group ID' },
            name: { type: 'string', description: 'Group name' },
            description: { type: 'string', description: 'Group description' }
          },
          required: ['group_id']
        }
      },
      {
        name: 'happyfox_add_contacts_to_group',
        description: 'Add contacts to a contact group',
        handler: 'addContactsToGroup',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Contact group ID' },
            contact_ids: { type: 'array', items: { type: 'number' }, description: 'Contact IDs to add' }
          },
          required: ['group_id', 'contact_ids']
        }
      },
      {
        name: 'happyfox_remove_contacts_from_group',
        description: 'Remove contacts from a contact group',
        handler: 'removeContactsFromGroup',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Contact group ID' },
            contact_ids: { type: 'array', items: { type: 'number' }, description: 'Contact IDs to remove' }
          },
          required: ['group_id', 'contact_ids']
        }
      }
    ];
  }

  async createContact(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new ContactEndpoints(client);
    return await endpoints.createContact(args);
  }

  async listContacts(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new ContactEndpoints(client);
    return await endpoints.listContacts(args);
  }

  async getContact(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new ContactEndpoints(client);
    return await endpoints.getContact(args.contact_id);
  }

  async updateContact(args: any, auth: HappyFoxAuth): Promise<any> {
    const { contact_id, ...updates } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new ContactEndpoints(client);
    return await endpoints.updateContact(contact_id, updates);
  }

  async createContactGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new ContactEndpoints(client);
    return await endpoints.createContactGroup(args);
  }

  async getContactGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new ContactEndpoints(client);
    return await endpoints.getContactGroup(args.group_id);
  }

  async updateContactGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    const { group_id, ...updates } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new ContactEndpoints(client);
    return await endpoints.updateContactGroup(group_id, updates);
  }

  async addContactsToGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    const { group_id, contact_ids } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new ContactEndpoints(client);
    return await endpoints.addContactsToGroup(group_id, contact_ids);
  }

  async removeContactsFromGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    const { group_id, contact_ids } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new ContactEndpoints(client);
    return await endpoints.removeContactsFromGroup(group_id, contact_ids);
  }
}
