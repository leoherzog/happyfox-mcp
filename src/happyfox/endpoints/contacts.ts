import { HappyFoxClient } from '../client';
import { formatPhones } from './phones';

export class ContactEndpoints {
  constructor(private client: HappyFoxClient) {}

  async createContact(data: {
    name: string;
    email: string;
    phones?: Array<{ number: string; type: string; is_primary?: boolean }>;
    contact_groups?: string[];
    is_login_enabled?: boolean;
    custom_fields?: Record<string, any>;
  }): Promise<any> {
    const formData: any = {
      name: data.name,
      email: data.email
    };

    if (data.phones && data.phones.length > 0) {
      formData.phones = formatPhones(data.phones);
    }

    if (data.contact_groups && data.contact_groups.length > 0) {
      formData.contact_groups = data.contact_groups.join(',');
    }

    if (data.is_login_enabled !== undefined) {
      formData.is_login_enabled = data.is_login_enabled;
    }

    if (data.custom_fields) {
      Object.entries(data.custom_fields).forEach(([key, value]) => {
        formData[key] = value;
      });
    }

    return await this.client.post('/users/', formData);
  }

  async listContacts(params: {
    page?: number;
    size?: number;
    query?: string;
  } = {}): Promise<any> {
    const queryParams: any = {
      page: params.page || 1,
      size: Math.min(params.size || 50, 50)
    };

    if (params.query) queryParams.q = params.query;

    return await this.client.get('/users/', queryParams);
  }

  async getContact(contactId: string): Promise<any> {
    return await this.client.get(`/user/${contactId}/`);
  }

  async updateContact(contactId: string, updates: {
    name?: string;
    email?: string;
    phones?: Array<{ number: string; type: string; is_primary?: boolean; id?: number }>;
    contact_groups?: string[];
    is_login_enabled?: boolean;
    custom_fields?: Record<string, any>;
  }): Promise<any> {
    const formData: any = {};

    if (updates.name) formData.name = updates.name;
    if (updates.email) formData.email = updates.email;

    if (updates.phones && updates.phones.length > 0) {
      formData.phones = formatPhones(updates.phones, true);
    }

    if (updates.contact_groups) {
      formData.contact_groups = updates.contact_groups.join(',');
    }

    if (updates.is_login_enabled !== undefined) {
      formData.is_login_enabled = updates.is_login_enabled;
    }

    if (updates.custom_fields) {
      Object.entries(updates.custom_fields).forEach(([key, value]) => {
        formData[key] = value;
      });
    }

    return await this.client.post(`/user/${contactId}/`, formData);
  }

  // Contact Groups
  async getContactGroup(groupId: string): Promise<any> {
    return await this.client.get(`/contact_group/${groupId}/`);
  }

  async createContactGroup(data: {
    name: string;
    description?: string;
  }): Promise<any> {
    const formData: any = {
      name: data.name
    };

    if (data.description) {
      formData.description = data.description;
    }

    return await this.client.post('/contact_groups/', formData);
  }

  async updateContactGroup(groupId: string, updates: {
    name?: string;
    description?: string;
  }): Promise<any> {
    const formData: any = {};

    if (updates.name) formData.name = updates.name;
    if (updates.description) formData.description = updates.description;

    return await this.client.post(`/contact_group/${groupId}/`, formData);
  }

  /**
   * API: POST /contact_group/<id>/update_contacts/
   */
  async addContactsToGroup(groupId: string, contactIds: number[]): Promise<any> {
    const formData = {
      contacts: contactIds.map(id => ({ id }))
    };

    return await this.client.post(`/contact_group/${groupId}/update_contacts/`, formData);
  }

  /**
   * API: POST /contact_group/<id>/delete_contacts/
   */
  async removeContactsFromGroup(groupId: string, contactIds: number[]): Promise<any> {
    const formData = {
      contacts: contactIds
    };

    return await this.client.post(`/contact_group/${groupId}/delete_contacts/`, formData);
  }
}