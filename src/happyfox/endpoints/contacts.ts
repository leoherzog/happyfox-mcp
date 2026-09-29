/**
 * HappyFox contact and contact group endpoints (Docs/1092). Arguments are checked against the
 * documented request shapes before anything is sent, so a bad call fails with an error naming the argument.
 */

import { HappyFoxClient, HappyFoxAPIError, formatErrorBody, QueryParams } from '../client';
import { formatPhones, PhoneInput } from './phones';
import { contactSegment, idSegment } from '../paths';
import { CONTACT_CUSTOM_FIELDS, customFieldEntries } from './custom-fields';
import { pageQuery } from './pagination';

/**
 * One contact for POST /users/ (Docs/1092 §4-5). HappyFox edits the contact that already has this
 * email instead of creating one, and resets every custom field the payload leaves out.
 */
export interface ContactInput {
  /** Required for a new contact. */
  name?: string;
  /** May be null or omitted when phones are given. */
  email?: string | null;
  phones?: PhoneInput[];
  is_login_enabled?: boolean;
  /** Keyed c-cf-<id>. */
  custom_fields?: Record<string, unknown>;
}

/** Changes to one existing contact (Docs/1092 §4, §7, §14). */
export interface ContactChanges {
  name?: string;
  email?: string;
  /** A phone with an `id` edits that phone. */
  phones?: PhoneInput[];
  is_login_enabled?: boolean;
  custom_fields?: Record<string, unknown>;
}

/** A new contact group (Docs/1092 §10). */
export interface ContactGroupInput {
  name: string;
  description?: string;
  tagged_domains?: string[];
}

/** The fields a contact group edit takes (Docs/1092 §11). */
export interface ContactGroupChanges {
  /** An empty string clears the description. */
  description?: string;
  /** Replaces the group's domains; an empty list removes them all. */
  tagged_domains?: string[];
}

export interface ListContactsParams {
  page?: number;
  size?: number;
  query?: string;
}

/** Contacts per POST /users/ list (Docs/1092 §5). */
export const MAX_BULK_CONTACTS = 100;
/** Contacts per update_contacts request (Docs/1092 §12). */
export const MAX_GROUP_CONTACTS = 100;
const MAX_PAGE_SIZE = 50;

// One domain: no separators, since HappyFox stores the list comma-separated.
const DOMAIN = /^[^\s,]+$/;

function invalidArgument(message: string): HappyFoxAPIError {
  return new HappyFoxAPIError(message, 400, 'INVALID_ARGUMENT');
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function optionalText(value: unknown, param: string): string | undefined {
  if (!isPresent(value)) return undefined;
  if (typeof value !== 'string') throw invalidArgument(`Invalid ${param}: expected a string.`);
  return value;
}

/** is_login_enabled in the "TRUE" / "FALSE" form Docs/1092 §7 shows. */
function loginFlag(value: unknown, param: string): 'TRUE' | 'FALSE' | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw invalidArgument(`Invalid ${param} ${JSON.stringify(value)}: expected true or false.`);
  }
  return value ? 'TRUE' : 'FALSE';
}

/** A list of domains in HappyFox's comma-separated form; an empty list gives "". */
function domainList(value: unknown, param: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every(domain => typeof domain === 'string' && DOMAIN.test(domain))) {
    throw invalidArgument(`Invalid ${param}: expected a list of domains such as ["example.com"].`);
  }
  return value.join(',');
}

/**
 * Refuse the group list older tool schemas offered: HappyFox's contact payload has none (Docs/1092 §4),
 * and a call that drops it would report success for a membership that never changed.
 */
function refuseContactGroups(value: unknown, param: string): void {
  if (value === undefined || value === null) return;
  throw invalidArgument(
    `${param} is not accepted: HappyFox's contact payload takes no groups. Add the contact to a group ` +
      'with happyfox_add_contacts_to_group.'
  );
}

/** Positive integer ids for a request body, at least one and at most `max`. */
function idList(value: unknown, param: string, max?: number): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidArgument(`${param} is required: a list of at least one contact id.`);
  }
  if (max !== undefined && value.length > max) {
    throw invalidArgument(`${param} holds ${value.length} ids; HappyFox takes at most ${max} per request, so split the list.`);
  }
  return value.map((id, index) => Number(idSegment(id, `${param}[${index}]`)));
}

/**
 * HappyFox's per-item results for a list request, unless every item failed.
 * @param listParam - the argument holding the list, which names each item as `<listParam>[<index>]`
 * @throws HappyFoxAPIError (400, API_ERROR) naming each item's error when none succeeded
 */
function unlessAllFailed<T>(results: T, nothingDone: string, listParam: string): T {
  const failed = (item: unknown) => typeof item === 'object' && item !== null && (item as any).success === false;
  if (Array.isArray(results) && results.length > 0 && results.every(failed)) {
    const details = formatErrorBody(results, index => `${listParam}[${index}]`) ?? '';
    throw new HappyFoxAPIError(`${nothingDone} ${details}`.trim(), 400, 'API_ERROR');
  }
  return results;
}

/**
 * One contact payload for POST /users/ (Docs/1092 §4).
 * @param label - prefix for argument names in errors, e.g. "contacts[2]."
 * @param requireName - false for the bulk list, where an entry may edit an existing contact
 * @throws HappyFoxAPIError (400) naming the first argument that breaks the documented rules
 */
function formatContact(contact: ContactInput, label: string, requireName: boolean): Record<string, unknown> {
  if (typeof contact !== 'object' || contact === null || Array.isArray(contact)) {
    throw invalidArgument(`Invalid ${label.replace(/\.$/, '') || 'contact'}: expected a contact object.`);
  }

  refuseContactGroups((contact as Record<string, unknown>).contact_groups, `${label}contact_groups`);
  const payload: Record<string, unknown> = {};
  if (requireName && !nonEmptyString(contact.name)) throw invalidArgument(`${label}name is required.`);
  const name = optionalText(contact.name, `${label}name`);
  if (name !== undefined) payload.name = name;

  const phones = isPresent(contact.phones) ? formatPhones(contact.phones, false, `${label}phones`) : [];
  // Docs/1092 §4: email is required even beside phones, but may then be null.
  if (nonEmptyString(contact.email)) {
    payload.email = contact.email;
  } else if (isPresent(contact.email)) {
    throw invalidArgument(`Invalid ${label}email: expected a string.`);
  } else if (phones.length > 0) {
    payload.email = null;
  } else {
    throw invalidArgument(`${label}email or ${label}phones is required.`);
  }
  if (phones.length > 0) payload.phones = phones;

  const login = loginFlag(contact.is_login_enabled, `${label}is_login_enabled`);
  if (login !== undefined) payload.is_login_enabled = login;

  return Object.assign(
    payload,
    customFieldEntries(contact.custom_fields, [CONTACT_CUSTOM_FIELDS], `${label}custom_fields`)
  );
}

export class ContactEndpoints {
  constructor(private client: HappyFoxClient) {}

  /**
   * Create a contact, or edit the one with this email (Docs/1092 §4).
   * @returns the contact, shaped like GET /user/<id>/
   */
  async createContact(data: ContactInput): Promise<any> {
    return await this.client.post('/users/', formatContact(data, '', true));
  }

  /**
   * Create or edit 1 to 100 contacts in one request (Docs/1092 §5). Every contact is checked before sending.
   * @returns HappyFox's per-contact results, when at least one contact was saved
   * @throws HappyFoxAPIError (400) for invalid input, or when HappyFox rejected every contact
   */
  async upsertContactsBulk(contacts: ContactInput[]): Promise<any> {
    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw invalidArgument('At least one contact is required.');
    }
    if (contacts.length > MAX_BULK_CONTACTS) {
      throw invalidArgument(`Bulk contact writes are limited to ${MAX_BULK_CONTACTS} contacts per request.`);
    }

    const payload = contacts.map((contact, index) => formatContact(contact, `contacts[${index}].`, false));
    return unlessAllFailed(await this.client.post('/users/', payload), 'No contacts were saved.', 'contacts');
  }

  /**
   * One page of contacts, optionally searched (Docs/1092 §1-2).
   * @param params.query - `field:value` terms; a `+` after `phone:` is dropped, as the doc requires
   * @throws HappyFoxAPIError (400, INVALID_ARGUMENT) for a page or size that is not a positive integer
   */
  async listContacts(params: ListContactsParams = {}): Promise<any> {
    const query: QueryParams = pageQuery(params.page, params.size, MAX_PAGE_SIZE);

    if (nonEmptyString(params.query)) query.q = params.query.replace(/(^|\s)phone:\+/g, '$1phone:');

    return await this.client.get('/users/', query);
  }

  /** One contact by id or email address (Docs/1092 §3). */
  async getContact(contactId: number | string): Promise<any> {
    return await this.client.get(`/user/${contactSegment(contactId, 'contact_id')}/`);
  }

  /**
   * Change one contact, addressed by id or email address (Docs/1092 §4, §7, §14). A phone edit by
   * id without `email` also sends the contact's current email, reading the contact first if needed.
   * @throws HappyFoxAPIError (400) when no field is given, or a phone edited by id has no type
   */
  async updateContact(contactId: number | string, changes: ContactChanges): Promise<any> {
    const path = `/user/${contactSegment(contactId, 'contact_id')}/`;
    refuseContactGroups((changes as Record<string, unknown>).contact_groups, 'contact_groups');
    const payload: Record<string, unknown> = {};

    const name = optionalText(changes.name, 'name');
    if (name !== undefined) payload.name = name;
    const email = optionalText(changes.email, 'email');
    if (email !== undefined) payload.email = email;

    if (isPresent(changes.phones)) {
      const phones = formatPhones(changes.phones, true);
      if (phones.length > 0) payload.phones = phones;
    }

    const login = loginFlag(changes.is_login_enabled, 'is_login_enabled');
    if (login !== undefined) payload.is_login_enabled = login;

    Object.assign(payload, customFieldEntries(changes.custom_fields, [CONTACT_CUSTOM_FIELDS]));

    if (Object.keys(payload).length === 0) {
      throw invalidArgument('Give at least one field to change: name, email, phones, is_login_enabled or custom_fields.');
    }
    // Both documented phone edits send the contact's email beside the phones (Docs/1092 §4, §14).
    const editsPhone = Array.isArray(payload.phones) && payload.phones.some(phone => phone.id !== undefined);
    if (editsPhone && payload.email === undefined) {
      payload.email = await this.currentEmail(contactId, path);
    }
    return await this.client.post(path, payload);
  }

  /**
   * The email a phone edit sends: contact_id when it is an email, else the contact's current email.
   * @returns the email, or null for a phone-only contact
   * @throws HappyFoxAPIError (INVALID_RESPONSE) when the contact read has no email field
   */
  private async currentEmail(contactId: unknown, path: string): Promise<string | null> {
    if (typeof contactId === 'string' && contactId.includes('@')) return contactId;
    const contact: unknown = await this.client.get(path);
    const email = typeof contact === 'object' && contact !== null ? (contact as { email?: unknown }).email : undefined;
    if (typeof email === 'string' || email === null) return email;
    throw new HappyFoxAPIError(
      `HappyFox answered GET ${path} without the contact's email, so the phone edit was not sent.`,
      200,
      'INVALID_RESPONSE'
    );
  }

  /** One contact group with its contacts (Docs/1092 §9). */
  async getContactGroup(groupId: number | string): Promise<any> {
    return await this.client.get(`/contact_group/${idSegment(groupId, 'group_id')}/`);
  }

  /** Create a contact group (Docs/1092 §10). Group names are unique. */
  async createContactGroup(data: ContactGroupInput): Promise<any> {
    if (typeof data !== 'object' || data === null || !nonEmptyString(data.name)) {
      throw invalidArgument('name is required.');
    }

    const payload: Record<string, unknown> = { name: data.name };
    const description = optionalText(data.description, 'description');
    if (description !== undefined) payload.description = description;
    const domains = domainList(data.tagged_domains, 'tagged_domains');
    if (domains) payload.tagged_domains = domains;

    return await this.client.post('/contact_groups/', payload);
  }

  /**
   * Change a contact group's description or tagged domains, the only fields its edit takes (Docs/1092 §11).
   * @throws HappyFoxAPIError (400) when neither is given, or when a new name is
   */
  async updateContactGroup(groupId: number | string, changes: ContactGroupChanges): Promise<any> {
    const path = `/contact_group/${idSegment(groupId, 'group_id')}/`;
    const { name } = changes as Record<string, unknown>;
    if (name !== undefined && name !== null) {
      throw invalidArgument('name is not accepted: a contact group cannot be renamed. Give description, tagged_domains or both.');
    }
    const payload: Record<string, unknown> = {};

    if (changes.description !== undefined && changes.description !== null) {
      if (typeof changes.description !== 'string') throw invalidArgument('Invalid description: expected a string.');
      payload.description = changes.description;
    }
    const domains = domainList(changes.tagged_domains, 'tagged_domains');
    if (domains !== undefined) payload.tagged_domains = domains;

    if (Object.keys(payload).length === 0) {
      throw invalidArgument('Give description, tagged_domains or both. A contact group cannot be renamed.');
    }
    return await this.client.post(path, payload);
  }

  /**
   * Add up to 100 contacts to a group, or edit their ticket access (Docs/1092 §12).
   * @param accessTickets - sent on every entry when given; HappyFox defaults it to false
   * @returns HappyFox's per-contact results, when at least one contact was added
   * @throws HappyFoxAPIError (400) for invalid input, or when HappyFox rejected every contact
   */
  async addContactsToGroup(
    groupId: number | string,
    contactIds: Array<number | string>,
    accessTickets?: boolean
  ): Promise<any> {
    const path = `/contact_group/${idSegment(groupId, 'group_id')}/update_contacts/`;
    const ids = idList(contactIds, 'contact_ids', MAX_GROUP_CONTACTS);
    if (accessTickets !== undefined && accessTickets !== null && typeof accessTickets !== 'boolean') {
      throw invalidArgument(`Invalid access_tickets ${JSON.stringify(accessTickets)}: expected true or false.`);
    }

    const payload = ids.map(contact =>
      typeof accessTickets === 'boolean' ? { contact, access_tickets: accessTickets } : { contact }
    );
    return unlessAllFailed(await this.client.post(path, payload), 'No contacts were added to the group.', 'contact_ids');
  }

  /**
   * Remove contacts from a group (Docs/1092 §6).
   * @returns HappyFox's per-contact results, when at least one contact was removed
   * @throws HappyFoxAPIError (400) for invalid input, or when no contact was removed
   */
  async removeContactsFromGroup(groupId: number | string, contactIds: Array<number | string>): Promise<any> {
    const path = `/contact_group/${idSegment(groupId, 'group_id')}/delete_contacts/`;
    const contacts = idList(contactIds, 'contact_ids');
    return unlessAllFailed(await this.client.post(path, { contacts }), 'No contacts were removed from the group.', 'contact_ids');
  }
}
