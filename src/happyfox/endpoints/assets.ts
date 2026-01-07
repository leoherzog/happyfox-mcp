import { HappyFoxClient } from '../client';

export class AssetEndpoints {
  constructor(private client: HappyFoxClient) {}

  // Phone type mapping: API uses short codes (same as ContactEndpoints)
  private mapPhoneType(type: string): string {
    const typeMap: Record<string, string> = {
      'mobile': 'mo',
      'work': 'w',
      'main': 'm',
      'home': 'h',
      'other': 'o'
    };
    return typeMap[type.toLowerCase()] || 'o';
  }

  /**
   * List all assets with pagination and optional filtering
   * API: GET /assets/
   * Per DOCUMENTATION.md:127-128
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
   * Per DOCUMENTATION.md:129
   */
  async getAsset(assetId: number): Promise<any> {
    return await this.client.get(`/asset/${assetId}/`);
  }

  /**
   * Create a new asset
   * API: POST /assets/?asset_type=<asset_type_id>
   * Per DOCUMENTATION.md:132-133
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
      // Map phone types to API codes
      formData.contacts = data.contacts.map(contact => ({
        ...contact,
        phones: contact.phones?.map((phone, index) => ({
          type: this.mapPhoneType(phone.type),
          number: phone.number,
          is_primary: phone.is_primary ?? (index === 0)
        }))
      }));
    }

    // Handle custom fields (format: a-cf-{id})
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
   * Per DOCUMENTATION.md:134
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
      // Map phone types to API codes
      formData.contacts = data.contacts.map(contact => ({
        ...contact,
        phones: contact.phones?.map((phone, index) => ({
          type: this.mapPhoneType(phone.type),
          number: phone.number,
          is_primary: phone.is_primary ?? (index === 0)
        }))
      }));
    }

    // Handle custom fields
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
   * Per DOCUMENTATION.md:135 - IMPORTANT: deleted_by is required
   */
  async deleteAsset(assetId: number, deletedByStaffId: number): Promise<any> {
    return await this.client.delete(`/asset/${assetId}/`, { deleted_by: deletedByStaffId });
  }

  /**
   * List asset custom fields for a specific asset type
   * API: GET /asset_custom_fields/?asset_type=<id>
   * Per DOCUMENTATION.md:140 and HappyFox Asset Management API docs
   * Note: asset_type is required per official API documentation
   */
  async listAssetCustomFields(assetTypeId: number): Promise<any> {
    return await this.client.get('/asset_custom_fields/', { asset_type: assetTypeId });
  }

  /**
   * Get a single asset custom field by ID
   * API: GET /asset_custom_fields/<id>/
   * Per DOCUMENTATION.md:141
   */
  async getAssetCustomField(customFieldId: number): Promise<any> {
    return await this.client.get(`/asset_custom_fields/${customFieldId}/`);
  }
}
