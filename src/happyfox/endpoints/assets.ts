import { HappyFoxClient } from '../client';
import { formatPhones } from './phones';

export class AssetEndpoints {
  constructor(private client: HappyFoxClient) {}

  /**
   * List all assets with pagination and optional filtering
   * API: GET /assets/
   */
  async listAssets(params: {
    page?: number;
    size?: number;
    asset_type?: number;
  } = {}): Promise<any> {
    const queryParams: any = {
      page: params.page || 1,
      size: Math.min(params.size || 50, 50)
    };

    if (params.asset_type !== undefined) {
      queryParams.asset_type = params.asset_type;
    }

    return await this.client.get('/assets/', queryParams);
  }

  /**
   * Get a single asset by ID
   * API: GET /asset/<id>/
   */
  async getAsset(assetId: number): Promise<any> {
    return await this.client.get(`/asset/${assetId}/`);
  }

  /**
   * Create a new asset
   * API: POST /assets/?asset_type=<asset_type_id>
   */
  async createAsset(assetTypeId: number, data: {
    name: string;
    display_id?: string;
    contact_ids?: number[];
    contacts?: Array<{
      name: string;
      email: string;
      phones?: Array<{ number: string; type: string; is_primary?: boolean }>;
    }>;
    custom_fields?: Record<string, any>;
    created_by?: number;
  }): Promise<any> {
    const formData: any = {
      name: data.name
    };

    if (data.display_id) formData.display_id = data.display_id;
    if (data.created_by) formData.created_by = data.created_by;
    if (data.contact_ids && data.contact_ids.length > 0) {
      formData.contact_ids = data.contact_ids;
    }
    if (data.contacts && data.contacts.length > 0) {
      formData.contacts = data.contacts.map(contact => ({
        ...contact,
        phones: contact.phones ? formatPhones(contact.phones) : undefined
      }));
    }

    // Custom field keys use the a-cf-<id> format
    if (data.custom_fields) {
      Object.entries(data.custom_fields).forEach(([key, value]) => {
        formData[key] = value;
      });
    }

    return await this.client.post('/assets/', formData, { asset_type: assetTypeId });
  }

  /**
   * Update an existing asset
   * API: PUT /asset/<id>/
   */
  async updateAsset(assetId: number, data: {
    name?: string;
    display_id?: string;
    contact_ids?: number[];
    contacts?: Array<{
      name: string;
      email: string;
      phones?: Array<{ number: string; type: string; is_primary?: boolean }>;
    }>;
    custom_fields?: Record<string, any>;
    updated_by?: number;
  }): Promise<any> {
    const formData: any = {};

    if (data.name) formData.name = data.name;
    if (data.display_id) formData.display_id = data.display_id;
    if (data.updated_by) formData.updated_by = data.updated_by;
    if (data.contact_ids) formData.contact_ids = data.contact_ids;
    if (data.contacts) {
      formData.contacts = data.contacts.map(contact => ({
        ...contact,
        phones: contact.phones ? formatPhones(contact.phones) : undefined
      }));
    }

    if (data.custom_fields) {
      Object.entries(data.custom_fields).forEach(([key, value]) => {
        formData[key] = value;
      });
    }

    return await this.client.put(`/asset/${assetId}/`, formData);
  }

  /**
   * Delete an asset
   * API: DELETE /asset/<id>/?deleted_by=<staff_id>
   * deleted_by is required by the API.
   */
  async deleteAsset(assetId: number, deletedByStaffId: number): Promise<any> {
    return await this.client.delete(`/asset/${assetId}/`, { deleted_by: deletedByStaffId });
  }

  /**
   * List asset custom fields for a specific asset type
   * API: GET /asset_custom_fields/?asset_type=<id>
   * asset_type is required by the API.
   */
  async listAssetCustomFields(assetTypeId: number): Promise<any> {
    return await this.client.get('/asset_custom_fields/', { asset_type: assetTypeId });
  }

  /**
   * Get a single asset custom field by ID
   * API: GET /asset_custom_fields/<id>/
   */
  async getAssetCustomField(customFieldId: number): Promise<any> {
    return await this.client.get(`/asset_custom_fields/${customFieldId}/`);
  }
}
