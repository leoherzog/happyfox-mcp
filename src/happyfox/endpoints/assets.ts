/**
 * HappyFox asset, asset custom field and asset type endpoints (Docs/1201). Arguments are checked
 * against the documented request shapes before anything is sent, so a bad call fails with an error
 * naming the argument.
 */

import { HappyFoxClient, HappyFoxAPIError, QueryParams } from '../client';
import { formatPhones, PhoneInput } from './phones';
import { pageQuery } from './pagination';
import { idSegment } from '../paths';

/**
 * A new contact to create and link to an asset (Docs/1201 §3-4). Docs/1201 names no phone key, so
 * phones follow the Docs/1092 §4 contact shape. Unverified until tested against a live account.
 */
export interface AssetContactInput {
  name: string;
  /** May be null or omitted when phones are given. */
  email?: string | null;
  phones?: PhoneInput[];
}

/** The optional fields asset create and update share (Docs/1201 §3-4). */
interface AssetLinks {
  contact_ids?: Array<number | string>;
  contact_group_ids?: Array<number | string>;
  contacts?: AssetContactInput[];
  /** Keyed by bare custom field id, e.g. {"45": "GCJ1353"}. */
  custom_fields?: Record<string, unknown>;
}

/** A new asset (Docs/1201 §3). `created_by` is the acting agent. */
export interface AssetInput extends AssetLinks {
  name: string;
  display_id: string;
  created_by: number | string;
}

/** Changes to an asset (Docs/1201 §4). `updated_by` is the acting agent. */
export interface AssetChanges extends AssetLinks {
  name?: string;
  display_id?: string;
  updated_by: number | string;
}

export interface ListAssetsParams {
  page?: number;
  size?: number;
  /** Omitted, HappyFox lists the first asset type. */
  asset_type?: number | string;
}

export interface ListAssetCustomFieldsParams {
  page?: number;
  size?: number;
  /** Omitted, HappyFox lists the first asset type's fields. */
  asset_type_id?: number | string;
}

/** Longest asset name, in characters (Docs/1201 §3). */
export const MAX_ASSET_NAME_LENGTH = 200;

/** A custom_fields key: the bare custom field id (Docs/1201 §3 example payload). */
export const ASSET_CUSTOM_FIELD_ID_PATTERN = '^[1-9][0-9]*$';
const ASSET_CUSTOM_FIELD_ID = new RegExp(ASSET_CUSTOM_FIELD_ID_PATTERN);

/** The value format per asset custom field type (Docs/1201 §3). Unlike ticket fields, Number takes integers only. */
export const ASSET_CUSTOM_FIELD_VALUE_FORMATS =
  'Values by field type: text and textarea, a string; number, an integer (no decimals); dropdown, one ' +
  'option id from the field\'s `choices` (not the label); multiple options, a list of option ids; date, ' +
  'a YYYY-MM-DD string.';

const MAX_PAGE_SIZE = 50;

type AssetCustomFieldValue = string | number | number[];

function invalidArgument(message: string): HappyFoxAPIError {
  return new HappyFoxAPIError(message, 400, 'INVALID_ARGUMENT');
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** A positive integer id for a request body or query. */
function numericId(value: unknown, param: string): number {
  return Number(idSegment(value, param));
}

/** The acting agent's id, which every asset write requires (Docs/1201 §3-5). */
function actingAgent(value: unknown, param: string): number {
  if (value === undefined || value === null) {
    throw invalidArgument(`${param} is required: the id of the acting agent.`);
  }
  return numericId(value, param);
}

function requiredText(value: unknown, param: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidArgument(`${param} is required, as a non-empty string.`);
  }
  return value;
}

function optionalText(value: unknown, param: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidArgument(`Invalid ${param}: expected a non-empty string.`);
  }
  return value;
}

/** An asset name within the documented limit, counted in code points as HappyFox counts characters. */
function assetName(value: string): string {
  const length = Array.from(value).length;
  if (length > MAX_ASSET_NAME_LENGTH) {
    throw invalidArgument(`name has ${length} characters; HappyFox allows at most ${MAX_ASSET_NAME_LENGTH}.`);
  }
  return value;
}

/** page and size for a paginated list (Docs/1201 §1, §6). */
function pagination(page: unknown, size: unknown): QueryParams {
  return pageQuery(page, size, MAX_PAGE_SIZE);
}

/** Positive integer ids for a request body; undefined when absent. */
function idList(value: unknown, param: string): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalidArgument(`Invalid ${param}: expected a list of numeric ids.`);
  return value.map((id, index) => numericId(id, `${param}[${index}]`));
}

/**
 * The contacts to create and link (Docs/1201 §3-4): each needs name, and email or phones.
 * @throws HappyFoxAPIError (400, INVALID_ARGUMENT) naming the first contact field that does not fit
 */
function newContacts(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidArgument('Invalid contacts: expected a list of contacts.');

  return value.map((contact, index) => {
    const label = `contacts[${index}]`;
    if (typeof contact !== 'object' || contact === null || Array.isArray(contact)) {
      throw invalidArgument(`Invalid ${label}: expected a contact object.`);
    }

    const payload: Record<string, unknown> = { name: requiredText(contact.name, `${label}.name`) };
    const phones = isPresent(contact.phones) ? formatPhones(contact.phones, false, `${label}.phones`) : [];
    // Docs/1092 §4: a contact's email is required even beside phones, but may then be null.
    if (typeof contact.email === 'string' && contact.email.trim() !== '') {
      payload.email = contact.email;
    } else if (isPresent(contact.email)) {
      throw invalidArgument(`Invalid ${label}.email: expected a string.`);
    } else if (phones.length > 0) {
      payload.email = null;
    } else {
      throw invalidArgument(`${label}.email or ${label}.phones is required.`);
    }
    if (phones.length > 0) payload.phones = phones;
    return payload;
  });
}

function optionIds(value: unknown[], key: string): number[] {
  return value.map(item => {
    if (typeof item === 'number' && Number.isSafeInteger(item) && item > 0) return item;
    if (typeof item === 'string' && ASSET_CUSTOM_FIELD_ID.test(item)) return Number(item);
    throw invalidArgument(
      `Invalid custom_fields value for "${key}": a multiple-options value is a list of option ids, not labels.`
    );
  });
}

/**
 * The `custom_fields` object HappyFox takes on asset create and update (Docs/1201 §3).
 * @param fields - keyed by bare custom field id
 * @returns the values, with option ids as numbers; undefined when none are given
 * @throws HappyFoxAPIError (400, INVALID_ARGUMENT) naming the first key or value that does not fit
 */
function assetCustomFields(fields: unknown): Record<string, AssetCustomFieldValue> | undefined {
  if (fields === undefined || fields === null) return undefined;
  if (typeof fields !== 'object' || Array.isArray(fields)) {
    throw invalidArgument('Invalid custom_fields: expected an object keyed by custom field id, e.g. {"45": "GCJ1353"}.');
  }

  const values: Record<string, AssetCustomFieldValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ASSET_CUSTOM_FIELD_ID.test(key)) {
      throw invalidArgument(
        `Invalid custom_fields key ${JSON.stringify(key)}: expected a bare custom field id such as "45", ` +
          'from happyfox_list_asset_custom_fields.'
      );
    }

    if (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) {
      values[key] = value;
    } else if (typeof value === 'number') {
      throw invalidArgument(
        `Invalid custom_fields value for "${key}": asset number fields and option ids take integers only.`
      );
    } else if (Array.isArray(value)) {
      values[key] = optionIds(value, key);
    } else {
      throw invalidArgument(
        `Invalid custom_fields value for "${key}": expected a string, an integer or a list of option ids.`
      );
    }
  }

  return Object.keys(values).length > 0 ? values : undefined;
}

/** The given AssetLinks fields in their documented payload form. */
function linkFields(data: AssetLinks): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  const contactIds = idList(data.contact_ids, 'contact_ids');
  if (contactIds) payload.contact_ids = contactIds;
  const groupIds = idList(data.contact_group_ids, 'contact_group_ids');
  if (groupIds) payload.contact_group_ids = groupIds;
  const contacts = newContacts(data.contacts);
  if (contacts.length > 0) payload.contacts = contacts;
  const customFields = assetCustomFields(data.custom_fields);
  if (customFields) payload.custom_fields = customFields;

  return payload;
}

export class AssetEndpoints {
  constructor(private client: HappyFoxClient) {}

  /** One page of assets of one type (Docs/1201 §1), as {page_info, data}. */
  async listAssets(params: ListAssetsParams = {}): Promise<any> {
    const query = pagination(params.page, params.size);
    if (isPresent(params.asset_type)) query.asset_type = numericId(params.asset_type, 'asset_type');
    return await this.client.get('/assets/', query);
  }

  /** One asset by its numeric id, not its display id (Docs/1201 §2). */
  async getAsset(assetId: number | string): Promise<any> {
    return await this.client.get(`/asset/${idSegment(assetId, 'asset_id')}/`);
  }

  /**
   * Create an asset (Docs/1201 §3).
   * @param assetTypeId - required here, so an omitted type never lands the asset in HappyFox's first type
   * @throws HappyFoxAPIError (400) naming the first argument that breaks the documented rules
   */
  async createAsset(assetTypeId: number | string, data: AssetInput): Promise<any> {
    if (!isPresent(assetTypeId)) {
      throw invalidArgument('asset_type_id is required: a numeric asset type id from happyfox://asset-types.');
    }
    const assetType = numericId(assetTypeId, 'asset_type_id');

    const payload: Record<string, unknown> = {
      name: assetName(requiredText(data.name, 'name')),
      display_id: requiredText(data.display_id, 'display_id'),
      created_by: actingAgent(data.created_by, 'created_by'),
      ...linkFields(data)
    };
    return await this.client.post('/assets/', payload, { asset_type: assetType });
  }

  /**
   * Change an asset (Docs/1201 §4). Only the fields given are sent.
   * @throws HappyFoxAPIError (400) when no field besides updated_by is given
   */
  async updateAsset(assetId: number | string, changes: AssetChanges): Promise<any> {
    const path = `/asset/${idSegment(assetId, 'asset_id')}/`;
    const fields: Record<string, unknown> = {};

    const name = optionalText(changes.name, 'name');
    if (name !== undefined) fields.name = assetName(name);
    const displayId = optionalText(changes.display_id, 'display_id');
    if (displayId !== undefined) fields.display_id = displayId;
    Object.assign(fields, linkFields(changes));

    if (Object.keys(fields).length === 0) {
      throw invalidArgument(
        'Give at least one field to change: name, display_id, contact_ids, contact_group_ids, contacts or custom_fields.'
      );
    }
    return await this.client.put(path, { ...fields, updated_by: actingAgent(changes.updated_by, 'updated_by') });
  }

  /**
   * Delete an asset (Docs/1201 §5). Only an active agent with the Manage Assets permission can.
   * @param deletedBy - the acting agent, sent as the deleted_by query parameter
   */
  async deleteAsset(assetId: number | string, deletedBy: number | string): Promise<any> {
    const path = `/asset/${idSegment(assetId, 'asset_id')}/`;
    return await this.client.delete(path, { deleted_by: actingAgent(deletedBy, 'deleted_by') });
  }

  /** One page of an asset type's custom field definitions (Docs/1201 §6), as {page_info, data}. */
  async listAssetCustomFields(params: ListAssetCustomFieldsParams = {}): Promise<any> {
    const query = pagination(params.page, params.size);
    if (isPresent(params.asset_type_id)) query.asset_type = numericId(params.asset_type_id, 'asset_type_id');
    return await this.client.get('/asset_custom_fields/', query);
  }

  /** One asset custom field definition (Docs/1201 §7). */
  async getAssetCustomField(customFieldId: number | string): Promise<any> {
    return await this.client.get(`/asset_custom_field/${idSegment(customFieldId, 'custom_field_id')}/`);
  }

  /** One asset type with its settings (Docs/1201 §9). */
  async getAssetType(assetTypeId: number | string): Promise<any> {
    return await this.client.get(`/asset_type/${idSegment(assetTypeId, 'asset_type_id')}/`);
  }
}
