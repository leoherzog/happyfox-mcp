import { MCPTool, HappyFoxAuth } from '../../types';
import { HappyFoxClient } from '../../happyfox/client';
import {
  ASSET_CUSTOM_FIELD_ID_PATTERN,
  ASSET_CUSTOM_FIELD_VALUE_FORMATS,
  AssetEndpoints,
  MAX_ASSET_NAME_LENGTH
} from '../../happyfox/endpoints/assets';
import { PHONE_TYPES } from '../../happyfox/endpoints/phones';

/** A positive integer id, as a number or a digit string. */
const ID_TYPE = { type: ['integer', 'string'], pattern: '^[0-9]+$', minimum: 1 };

/** The backend asset id every /asset/<id>/ endpoint takes (Docs/1201 overview). */
const ASSET_ID_PROPERTY = {
  ...ID_TYPE,
  description:
    'Numeric asset id: the `id` of an asset from happyfox_list_assets, e.g. 6748. Not its display_id or name.'
};

const ASSET_TYPE_ID_PROPERTY = { ...ID_TYPE, description: 'Numeric asset type id, from happyfox://asset-types.' };

const PAGE_PROPERTY = { type: 'integer', minimum: 1, description: 'Page number, from 1 (default 1).' };

function pageSizeProperty(items: string): Record<string, unknown> {
  return { type: 'integer', minimum: 1, maximum: 50, description: `${items} per page, at most 50 (default 50).` };
}

/**
 * The acting agent's id. Omitted, it is filled in from TOOLS_REQUIRING_STAFF_ID.
 * @param role - what the agent does, e.g. "creating the asset"
 */
function actingStaffProperty(role: string): Record<string, unknown> {
  return {
    ...ID_TYPE,
    description:
      `Id of the agent ${role}, from happyfox://staff. Defaults to the agent who authorized this ` +
      'connection. Another agent\'s id makes HappyFox act as that agent, with that agent\'s role permissions.'
  };
}

const NAME_PROPERTY = {
  type: 'string',
  minLength: 1,
  maxLength: MAX_ASSET_NAME_LENGTH,
  description: `Asset name, at most ${MAX_ASSET_NAME_LENGTH} characters.`
};

const CONTACT_GROUP_IDS_DESCRIPTION = 'Numeric ids of existing contact groups to link, from happyfox://contact-groups.';

const CONTACT_IDS_DESCRIPTION =
  'Numeric ids of existing contacts to link (`id` from happyfox_list_contacts or happyfox_get_contact).';

/** Asset update does not say whether its link lists replace or extend the asset's links (Docs/1201 §4). */
const LINKS_MAY_REPLACE =
  'HappyFox does not document whether this list replaces the asset\'s current links or adds to them; to ' +
  'keep the current ones, include their ids from happyfox_get_asset.';

/**
 * New contacts to create and link (Docs/1201 §3-4).
 * @param actingParam - the parameter naming the agent whose role must allow creating contacts
 */
function newContactsProperty(actingParam: string): Record<string, unknown> {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact name.' },
        email: {
          type: ['string', 'null'],
          description: 'Email address. May be null or omitted only when phones are given.'
        },
        phones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              number: { type: 'string', description: 'Phone number, as text.' },
              type: {
                type: 'string',
                enum: PHONE_TYPES,
                description: 'Phone type: mobile, work, main, home or other. Omitted, HappyFox uses other.'
              },
              is_primary: {
                type: 'boolean',
                description: 'true makes this the contact\'s primary phone; at most one phone can be true.'
              }
            },
            required: ['number']
          },
          description: 'Phone numbers. Required when email is not given.'
        }
      },
      required: ['name']
    },
    description:
      'New contacts to create and link to the asset. Each needs name, and email or phones. Creating ' +
      `contacts needs the Manage all Contacts permission on the role of the agent in ${actingParam}, or ` +
      'HappyFox refuses the call; to link contacts that already exist, use contact_ids instead.'
  };
}

/**
 * The nested custom_fields object keyed by bare field id (Docs/1201 §3).
 * @param idSource - where the model finds the field ids for this call
 */
function customFieldsProperty(idSource: string): Record<string, unknown> {
  return {
    type: 'object',
    description:
      'Custom field values keyed by bare numeric field id, e.g. {"45": "GCJ1353", "57": "2020-12-25"}; ' +
      `no t-cf- or c-cf- prefix. ${idSource} ${ASSET_CUSTOM_FIELD_VALUE_FORMATS}`,
    propertyNames: { pattern: ASSET_CUSTOM_FIELD_ID_PATTERN },
    additionalProperties: {
      anyOf: [
        { type: 'string' },
        { type: 'integer' },
        { type: 'array', items: { type: 'integer', minimum: 1 } }
      ]
    }
  };
}

export class AssetTools {
  getTools(): Array<MCPTool & { handler: string }> {
    return [
      {
        name: 'happyfox_list_assets',
        description:
          'List the assets of one asset type one page at a time (GET /assets/), as {page_info, data}. Each ' +
          'asset\'s `id` is what the other asset tools take; `display_id` is the label shown in HappyFox.',
        handler: 'listAssets',
        inputSchema: {
          type: 'object',
          properties: {
            page: PAGE_PROPERTY,
            size: pageSizeProperty('Assets'),
            asset_type: ASSET_TYPE_ID_PROPERTY
          },
          required: ['asset_type']
        }
      },
      {
        name: 'happyfox_get_asset',
        description:
          'Get one asset (GET /asset/<id>/): name, display_id, asset_type, linked contacts and ' +
          'contact_groups, and custom_fields with their ids and values.',
        handler: 'getAsset',
        inputSchema: {
          type: 'object',
          properties: {
            asset_id: ASSET_ID_PROPERTY
          },
          required: ['asset_id']
        }
      },
      {
        name: 'happyfox_create_asset',
        description:
          'Create an asset of one asset type (POST /assets/?asset_type=<id>). Needs asset_type_id, name and ' +
          'display_id. Returns the new asset with its id.',
        handler: 'createAsset',
        inputSchema: {
          type: 'object',
          properties: {
            asset_type_id: ASSET_TYPE_ID_PROPERTY,
            name: NAME_PROPERTY,
            display_id: { type: 'string', minLength: 1, description: 'Display id of the asset, shown in HappyFox.' },
            created_by: actingStaffProperty('creating the asset'),
            contact_ids: { type: 'array', items: ID_TYPE, description: CONTACT_IDS_DESCRIPTION },
            contact_group_ids: { type: 'array', items: ID_TYPE, description: CONTACT_GROUP_IDS_DESCRIPTION },
            contacts: newContactsProperty('created_by'),
            custom_fields: customFieldsProperty(
              'Field ids and option ids come from happyfox_list_asset_custom_fields for this asset type.'
            )
          },
          required: ['asset_type_id', 'name', 'display_id']
        }
      },
      {
        name: 'happyfox_update_asset',
        description:
          'Change an asset (PUT /asset/<id>/). Only the fields given are sent; give at least one besides ' +
          'updated_by. Returns the updated asset, shaped like happyfox_get_asset.',
        handler: 'updateAsset',
        inputSchema: {
          type: 'object',
          properties: {
            asset_id: ASSET_ID_PROPERTY,
            name: { ...NAME_PROPERTY, description: `New asset name, at most ${MAX_ASSET_NAME_LENGTH} characters.` },
            display_id: { type: 'string', minLength: 1, description: 'New display id of the asset.' },
            updated_by: actingStaffProperty('making the change'),
            contact_ids: {
              type: 'array',
              items: ID_TYPE,
              description: `${CONTACT_IDS_DESCRIPTION} ${LINKS_MAY_REPLACE}`
            },
            contact_group_ids: {
              type: 'array',
              items: ID_TYPE,
              description: `${CONTACT_GROUP_IDS_DESCRIPTION} ${LINKS_MAY_REPLACE}`
            },
            contacts: newContactsProperty('updated_by'),
            custom_fields: customFieldsProperty(
              'Field ids come from happyfox_list_asset_custom_fields for the asset\'s type, or from ' +
                'custom_fields in happyfox_get_asset. Option ids come only from `choices` in ' +
                'happyfox_list_asset_custom_fields or happyfox_get_asset_custom_field; happyfox_get_asset ' +
                'shows only the option currently set.'
            )
          },
          required: ['asset_id']
        }
      },
      {
        name: 'happyfox_delete_asset',
        description:
          'Delete an asset permanently (DELETE /asset/<id>/). Only an active agent whose role has the ' +
          'Manage Assets permission can delete assets; HappyFox checks the agent in deleted_by.',
        handler: 'deleteAsset',
        inputSchema: {
          type: 'object',
          properties: {
            asset_id: ASSET_ID_PROPERTY,
            deleted_by: actingStaffProperty('deleting the asset')
          },
          required: ['asset_id']
        }
      },
      {
        name: 'happyfox_list_asset_custom_fields',
        description:
          'List the custom field definitions of one asset type one page at a time (GET /asset_custom_fields/), ' +
          'as {page_info, data} of {id, name, type, asset_type, choices}. The ids key custom_fields in ' +
          'happyfox_create_asset and happyfox_update_asset.',
        handler: 'listAssetCustomFields',
        inputSchema: {
          type: 'object',
          properties: {
            asset_type_id: ASSET_TYPE_ID_PROPERTY,
            page: PAGE_PROPERTY,
            size: pageSizeProperty('Fields')
          },
          required: ['asset_type_id']
        }
      },
      {
        name: 'happyfox_get_asset_custom_field',
        description:
          'Get one asset custom field definition (GET /asset_custom_field/<id>/): id, name, type, asset_type ' +
          'and choices.',
        handler: 'getAssetCustomField',
        inputSchema: {
          type: 'object',
          properties: {
            custom_field_id: {
              ...ID_TYPE,
              description: 'Numeric asset custom field id, from happyfox_list_asset_custom_fields.'
            }
          },
          required: ['custom_field_id']
        }
      },
      {
        name: 'happyfox_get_asset_type',
        description:
          'Get one asset type (GET /asset_type/<id>/): id, name, description and settings. ' +
          'happyfox://asset-types lists every asset type.',
        handler: 'getAssetType',
        inputSchema: {
          type: 'object',
          properties: {
            asset_type_id: ASSET_TYPE_ID_PROPERTY
          },
          required: ['asset_type_id']
        }
      }
    ];
  }

  private endpoints(auth: HappyFoxAuth): AssetEndpoints {
    return new AssetEndpoints(new HappyFoxClient(auth));
  }

  async listAssets(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).listAssets(args);
  }

  async getAsset(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).getAsset(args.asset_id);
  }

  async createAsset(args: any, auth: HappyFoxAuth): Promise<any> {
    const { asset_type_id, ...data } = args;
    return await this.endpoints(auth).createAsset(asset_type_id, data);
  }

  async updateAsset(args: any, auth: HappyFoxAuth): Promise<any> {
    const { asset_id, ...changes } = args;
    return await this.endpoints(auth).updateAsset(asset_id, changes);
  }

  async deleteAsset(args: any, auth: HappyFoxAuth): Promise<any> {
    const { asset_id, deleted_by } = args;
    return await this.endpoints(auth).deleteAsset(asset_id, deleted_by);
  }

  async listAssetCustomFields(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).listAssetCustomFields(args);
  }

  async getAssetCustomField(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).getAssetCustomField(args.custom_field_id);
  }

  async getAssetType(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).getAssetType(args.asset_type_id);
  }
}
