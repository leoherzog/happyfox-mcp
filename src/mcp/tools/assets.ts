import { MCPTool, HappyFoxAuth } from '../../types';
import { HappyFoxClient } from '../../happyfox/client';
import { AssetEndpoints } from '../../happyfox/endpoints/assets';

export class AssetTools {
  getTools(): Array<MCPTool & { handler: string }> {
    return [
      {
        name: 'happyfox_list_assets',
        description: 'List assets with pagination for a specific asset type',
        handler: 'listAssets',
        inputSchema: {
          type: 'object',
          properties: {
            page: { type: 'number', description: 'Page number (default: 1)' },
            size: { type: 'number', description: 'Page size (default: 50, max: 50)' },
            asset_type: { type: 'number', description: 'Asset type ID (required - use happyfox://asset-types resource to find valid IDs)' }
          },
          required: ['asset_type']
        }
      },
      {
        name: 'happyfox_get_asset',
        description: 'Get asset details by ID',
        handler: 'getAsset',
        inputSchema: {
          type: 'object',
          properties: {
            asset_id: { type: 'number', description: 'Asset ID' }
          },
          required: ['asset_id']
        }
      },
      {
        name: 'happyfox_create_asset',
        description: 'Create a new asset of a specific type',
        handler: 'createAsset',
        inputSchema: {
          type: 'object',
          properties: {
            asset_type_id: { type: 'number', description: 'Asset type ID (required)' },
            name: { type: 'string', description: 'Asset name (required)' },
            display_id: { type: 'string', description: 'Custom display ID for the asset' },
            created_by: { type: 'number', description: 'Staff ID who created the asset. Optional - defaults to authenticated user.' },
            contact_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'IDs of existing contacts to associate with this asset'
            },
            contacts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Contact name' },
                  email: { type: 'string', description: 'Contact email' },
                  phones: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        number: { type: 'string' },
                        type: { type: 'string', enum: ['mobile', 'work', 'main', 'home', 'other'] },
                        is_primary: { type: 'boolean' }
                      },
                      required: ['number', 'type']
                    }
                  }
                },
                required: ['name', 'email']
              },
              description: 'New contacts to create and associate with this asset'
            },
            custom_fields: {
              type: 'object',
              description: 'Custom field values (a-cf-{id}: value)'
            }
          },
          required: ['asset_type_id', 'name']
        }
      },
      {
        name: 'happyfox_update_asset',
        description: 'Update an existing asset',
        handler: 'updateAsset',
        inputSchema: {
          type: 'object',
          properties: {
            asset_id: { type: 'number', description: 'Asset ID to update (required)' },
            name: { type: 'string', description: 'Asset name' },
            display_id: { type: 'string', description: 'Custom display ID' },
            updated_by: { type: 'number', description: 'Staff ID who updated the asset. Optional - defaults to authenticated user.' },
            contact_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Contact IDs to associate'
            },
            contacts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  phones: { type: 'array', items: { type: 'object' } }
                },
                required: ['name', 'email']
              },
              description: 'New contacts to create and associate'
            },
            custom_fields: { type: 'object', description: 'Custom field values (a-cf-{id}: value)' }
          },
          required: ['asset_id']
        }
      },
      {
        name: 'happyfox_delete_asset',
        description: 'Delete an asset',
        handler: 'deleteAsset',
        inputSchema: {
          type: 'object',
          properties: {
            asset_id: { type: 'number', description: 'Asset ID to delete' },
            deleted_by: { type: 'number', description: 'Staff ID performing the deletion. Optional - defaults to authenticated user.' }
          },
          required: ['asset_id']
        }
      },
      {
        name: 'happyfox_list_asset_custom_fields',
        description: 'List asset custom field definitions for a specific asset type',
        handler: 'listAssetCustomFields',
        inputSchema: {
          type: 'object',
          properties: {
            asset_type_id: { type: 'number', description: 'Asset type ID (required - use happyfox://asset-types resource to find valid IDs)' }
          },
          required: ['asset_type_id']
        }
      },
      {
        name: 'happyfox_get_asset_custom_field',
        description: 'Get asset custom field details by ID',
        handler: 'getAssetCustomField',
        inputSchema: {
          type: 'object',
          properties: {
            custom_field_id: { type: 'number', description: 'Custom field ID' }
          },
          required: ['custom_field_id']
        }
      }
    ];
  }

  async listAssets(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new AssetEndpoints(client);
    return await endpoints.listAssets(args);
  }

  async getAsset(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new AssetEndpoints(client);
    return await endpoints.getAsset(args.asset_id);
  }

  async createAsset(args: any, auth: HappyFoxAuth): Promise<any> {
    const { asset_type_id, ...data } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new AssetEndpoints(client);
    return await endpoints.createAsset(asset_type_id, data);
  }

  async updateAsset(args: any, auth: HappyFoxAuth): Promise<any> {
    const { asset_id, ...updates } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new AssetEndpoints(client);
    return await endpoints.updateAsset(asset_id, updates);
  }

  async deleteAsset(args: any, auth: HappyFoxAuth): Promise<any> {
    const { asset_id, deleted_by } = args;
    const client = new HappyFoxClient(auth);
    const endpoints = new AssetEndpoints(client);
    return await endpoints.deleteAsset(asset_id, deleted_by);
  }

  async listAssetCustomFields(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new AssetEndpoints(client);
    return await endpoints.listAssetCustomFields(args.asset_type_id);
  }

  async getAssetCustomField(args: any, auth: HappyFoxAuth): Promise<any> {
    const client = new HappyFoxClient(auth);
    const endpoints = new AssetEndpoints(client);
    return await endpoints.getAssetCustomField(args.custom_field_id);
  }
}
