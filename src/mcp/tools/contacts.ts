import { MCPTool, HappyFoxAuth } from '../../types';
import { HappyFoxClient } from '../../happyfox/client';
import { ContactEndpoints, MAX_BULK_CONTACTS, MAX_GROUP_CONTACTS } from '../../happyfox/endpoints/contacts';
import { PHONE_TYPES } from '../../happyfox/endpoints/phones';
import {
  CONTACT_CUSTOM_FIELDS,
  CUSTOM_FIELD_VALUE_FORMATS,
  customFieldsSchema
} from '../../happyfox/endpoints/custom-fields';
import { referenceCache } from '../../cache/reference-cache';

/** A positive integer id, as a number or a digit string. */
const ID_TYPE = { type: ['integer', 'string'], pattern: '^[0-9]+$', minimum: 1 };

/** A contact path segment: the numeric id or the email address (Docs/1092 §3). */
const CONTACT_ID_PROPERTY = {
  type: ['integer', 'string'],
  description:
    'The contact\'s numeric id (`id` from happyfox_list_contacts, e.g. 33) or its email address ' +
    '(e.g. james@example.com).'
};

const GROUP_ID_PROPERTY = { ...ID_TYPE, description: 'Numeric contact group id, from happyfox://contact-groups.' };

const CONTACT_IDS_DESCRIPTION = 'Numeric contact ids (`id` from happyfox_list_contacts or happyfox_get_contact).';

const GROUP_LIST_LAG =
  'happyfox://contact-groups can take up to 15 minutes to show the change; happyfox_get_contact_group reads ' +
  'one group live.';

/**
 * The phone list schema (Docs/1092 §4).
 * @param editing - true adds the `id` that selects an existing phone
 */
function phonesProperty(editing: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    number: { type: 'string', description: 'Phone number, as text.' },
    type: {
      type: 'string',
      enum: PHONE_TYPES,
      description:
        'Phone type: mobile, work, main, home or other. Omitted, HappyFox uses other. Contact details ' +
        'show these types as the codes mo, w, m, h and o, in that order.'
    },
    is_primary: {
      type: 'boolean',
      description: 'true makes this the contact\'s primary phone. Sent only when given; at most one phone can be true.'
    }
  };
  if (editing) {
    properties.id = {
      ...ID_TYPE,
      description:
        'Id of an existing phone to change, from `phones[].id` in happyfox_get_contact. type is then ' +
        'required: give the phone\'s current type to keep it. Omit id for a new phone.'
    };
  }
  return { type: 'array', items: { type: 'object', properties, required: ['number'] } };
}

/** The fields of one POST /users/ contact (Docs/1092 §4). */
const CONTACT_PROPERTIES = {
  name: { type: 'string', description: 'Contact name. Required for a new contact.' },
  email: {
    type: ['string', 'null'],
    description:
      'Email address. HappyFox edits the contact that already has this email instead of creating one. ' +
      'May be null or omitted only when phones are given.'
  },
  phones: {
    ...phonesProperty(false),
    description: 'Phone numbers to add. Required when email is not given. To change an existing phone, use ' +
      'happyfox_update_contact.'
  },
  is_login_enabled: {
    type: 'boolean',
    description: 'true lets the contact sign in to the support portal, false blocks it. New contacts default to true.'
  },
  custom_fields: customFieldsSchema(
    [CONTACT_CUSTOM_FIELDS],
    'Contact custom field values keyed c-cf-<id>, ids from happyfox://contact-custom-fields. Take ids only ' +
      'from that resource, never from agent portal URLs, and re-read it before sending choice ids. ' +
      `${CUSTOM_FIELD_VALUE_FORMATS} Every field marked \`required\` must be given. Fields left out are reset ` +
      'to empty.'
  )
};

export class ContactTools {
  getTools(): Array<MCPTool & { handler: string }> {
    return [
      {
        name: 'happyfox_create_contact',
        description:
          'Create a contact (POST /users/). If a contact with this email already exists, HappyFox edits it ' +
          'instead: the name is overwritten and every custom field not in custom_fields is reset. To change ' +
          'an existing contact, use happyfox_update_contact. Needs name, and email or phones. To add the ' +
          'contact to groups, pass its id to happyfox_add_contacts_to_group. Returns the contact, shaped like ' +
          'happyfox_get_contact.',
        handler: 'createContact',
        inputSchema: {
          type: 'object',
          properties: CONTACT_PROPERTIES,
          required: ['name']
        }
      },
      {
        name: 'happyfox_upsert_contacts_bulk',
        description:
          `Create or edit 1 to ${MAX_BULK_CONTACTS} contacts in one request (POST /users/ with a list). ` +
          'HappyFox edits the contact that already has an entry\'s email, overwriting the fields given and ' +
          'resetting every custom field not in that entry\'s custom_fields; otherwise it creates one. Each ' +
          'entry takes the fields of happyfox_create_contact and needs email or phones; name is required ' +
          'for a new contact. Returns a list of {email, id, success}; entries with success false carry ' +
          'validation errors, so check every entry. HappyFox does not document the order of the list, so ' +
          'match entries to contacts by email or id, not by position. The call fails only when no contact ' +
          'was saved.',
        handler: 'upsertContactsBulk',
        inputSchema: {
          type: 'object',
          properties: {
            contacts: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_BULK_CONTACTS,
              items: { type: 'object', properties: CONTACT_PROPERTIES },
              description: `Contacts to create or edit, at most ${MAX_BULK_CONTACTS}.`
            }
          },
          required: ['contacts']
        }
      },
      {
        name: 'happyfox_list_contacts',
        description:
          'List contacts one page at a time (GET /users/), as {page_info, data}. Each contact\'s `id` is ' +
          'what the other contact tools take.',
        handler: 'listContacts',
        inputSchema: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, description: 'Page number, from 1 (default 1).' },
            size: { type: 'integer', minimum: 1, maximum: 50, description: 'Contacts per page, at most 50 (default 50).' },
            query: {
              type: 'string',
              description:
                'Search terms written field:value and separated by spaces; a contact must match every term, ' +
                'e.g. name:adam email:adam@example.com. Fields: name, email, phone (digits without the ' +
                'leading +, e.g. phone:11231231234), created_since and updated_since (contacts created or ' +
                'updated since a date; HappyFox does not document the date format).'
            }
          }
        }
      },
      {
        name: 'happyfox_get_contact',
        description:
          'Get one contact by id or email address (GET /user/<id or email>/): name, email, phones with ' +
          'their ids, contact_groups, custom_fields and ticket counts.',
        handler: 'getContact',
        inputSchema: {
          type: 'object',
          properties: {
            contact_id: CONTACT_ID_PROPERTY
          },
          required: ['contact_id']
        }
      },
      {
        name: 'happyfox_update_contact',
        description:
          'Change an existing contact, addressed by id or email (POST /user/<id or email>/). Only the ' +
          'fields given are sent; give at least one. HappyFox documents that a contact write resets every ' +
          'custom field it leaves out, and does not say whether this call does: to keep custom field ' +
          'values, send their current values from happyfox_get_contact too. Group membership changes with ' +
          'happyfox_add_contacts_to_group and happyfox_remove_contacts_from_group. Returns the contact, ' +
          'shaped like happyfox_get_contact.',
        handler: 'updateContact',
        inputSchema: {
          type: 'object',
          properties: {
            contact_id: CONTACT_ID_PROPERTY,
            name: { type: 'string', description: 'New contact name.' },
            email: { type: 'string', description: 'New email address.' },
            phones: {
              ...phonesProperty(true),
              description:
                'Phones to add, or to change when an entry has an id. A change by id is sent with the ' +
                'contact\'s email, as HappyFox\'s documented phone edits are: the email given here, or else ' +
                'the contact\'s current one.'
            },
            is_login_enabled: CONTACT_PROPERTIES.is_login_enabled,
            custom_fields: customFieldsSchema(
              [CONTACT_CUSTOM_FIELDS],
              'Contact custom field values keyed c-cf-<id>, ids from happyfox://contact-custom-fields. Take ' +
                'ids only from that resource, never from agent portal URLs, and re-read it before sending ' +
                `choice ids. ${CUSTOM_FIELD_VALUE_FORMATS}`
            )
          },
          required: ['contact_id']
        }
      },
      {
        name: 'happyfox_create_contact_group',
        description:
          'Create a contact group (POST /contact_groups/). Group names are unique. Returns the new group ' +
          `with its id. ${GROUP_LIST_LAG}`,
        handler: 'createContactGroup',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Group name, unique in the account.' },
            description: { type: 'string', description: 'What the group is for and which contacts belong in it.' },
            tagged_domains: {
              type: 'array',
              items: { type: 'string', pattern: '^[^\\s,]+$' },
              description:
                'Email domains, e.g. ["example.com"]. Contacts added to the account later with an email at ' +
                'one of these domains join the group automatically.'
            }
          },
          required: ['name']
        }
      },
      {
        name: 'happyfox_get_contact_group',
        description:
          'Get one contact group, read live (GET /contact_group/<id>/): id, name, description, ' +
          'tagged_domains and contacts.',
        handler: 'getContactGroup',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: GROUP_ID_PROPERTY
          },
          required: ['group_id']
        }
      },
      {
        name: 'happyfox_update_contact_group',
        description:
          'Change a contact group\'s description, tagged domains or both (POST /contact_group/<id>/). ' +
          `These are the only fields HappyFox's edit takes, so a group cannot be renamed. ${GROUP_LIST_LAG}`,
        handler: 'updateContactGroup',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: GROUP_ID_PROPERTY,
            description: { type: 'string', description: 'New description; an empty string clears it.' },
            tagged_domains: {
              type: 'array',
              items: { type: 'string', pattern: '^[^\\s,]+$' },
              description:
                'Replaces the group\'s email domains, e.g. ["example.com"]; [] removes them all. Contacts ' +
                'added to the account later with an email at one of these domains join the group automatically.'
            }
          },
          required: ['group_id']
        }
      },
      {
        name: 'happyfox_add_contacts_to_group',
        description:
          `Add 1 to ${MAX_GROUP_CONTACTS} contacts to a contact group, or change their ticket access ` +
          '(POST /contact_group/<id>/update_contacts/). Returns a list of {data: {contact, access_tickets}, ' +
          'success: true} or {errors: [{field, errors}], success: false}. A failed entry does not name its ' +
          'contact and HappyFox does not document the order of the list, so when any entry has success false, ' +
          'read the group with happyfox_get_contact_group to see which contacts are in it. The call fails ' +
          'only when no contact was added.',
        handler: 'addContactsToGroup',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: GROUP_ID_PROPERTY,
            contact_ids: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_GROUP_CONTACTS,
              items: ID_TYPE,
              description: `${CONTACT_IDS_DESCRIPTION} At most ${MAX_GROUP_CONTACTS}; split longer lists.`
            },
            access_tickets: {
              type: 'boolean',
              description:
                'true lets these contacts see the tickets of the group\'s other contacts. Omitted, HappyFox ' +
                'uses false; listing a contact already in the group updates its access, so omitting this can ' +
                'revoke it.'
            }
          },
          required: ['group_id', 'contact_ids']
        }
      },
      {
        name: 'happyfox_remove_contacts_from_group',
        description:
          'Remove contacts from a contact group (POST /contact_group/<id>/delete_contacts/). Returns a list ' +
          'of {data: {contact, message}, success}; success is false for a contact that is not in the group ' +
          'or does not exist. The call fails only when no contact was removed.',
        handler: 'removeContactsFromGroup',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: GROUP_ID_PROPERTY,
            contact_ids: { type: 'array', minItems: 1, items: ID_TYPE, description: CONTACT_IDS_DESCRIPTION }
          },
          required: ['group_id', 'contact_ids']
        }
      }
    ];
  }

  private endpoints(auth: HappyFoxAuth): ContactEndpoints {
    return new ContactEndpoints(new HappyFoxClient(auth));
  }

  async createContact(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).createContact(args);
  }

  async upsertContactsBulk(args: any, auth: HappyFoxAuth): Promise<any> {
    const { contacts } = args;
    return await this.endpoints(auth).upsertContactsBulk(contacts);
  }

  async listContacts(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).listContacts(args);
  }

  async getContact(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).getContact(args.contact_id);
  }

  async updateContact(args: any, auth: HappyFoxAuth): Promise<any> {
    const { contact_id, ...changes } = args;
    return await this.endpoints(auth).updateContact(contact_id, changes);
  }

  // The group writes drop the cached list even on failure, since a lost response can follow an applied change.
  async createContactGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    try {
      return await this.endpoints(auth).createContactGroup(args);
    } finally {
      await referenceCache.invalidate(auth, 'contact-groups');
    }
  }

  async getContactGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).getContactGroup(args.group_id);
  }

  async updateContactGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    const { group_id, ...changes } = args;
    try {
      return await this.endpoints(auth).updateContactGroup(group_id, changes);
    } finally {
      await referenceCache.invalidate(auth, 'contact-groups');
    }
  }

  async addContactsToGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    const { group_id, contact_ids, access_tickets } = args;
    return await this.endpoints(auth).addContactsToGroup(group_id, contact_ids, access_tickets);
  }

  async removeContactsFromGroup(args: any, auth: HappyFoxAuth): Promise<any> {
    const { group_id, contact_ids } = args;
    return await this.endpoints(auth).removeContactsFromGroup(group_id, contact_ids);
  }
}
