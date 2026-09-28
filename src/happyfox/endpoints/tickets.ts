import { HappyFoxClient } from '../client';

interface TicketInput {
  category: string;
  subject: string;
  text: string;
  email: string;
  name: string;
  phone?: string;
  priority?: string;
  assignee?: string;
  tags?: string[];
  cc?: string[];
  bcc?: string[];
  custom_fields?: Record<string, any>;
}

export class TicketEndpoints {
  constructor(private client: HappyFoxClient) {}

  private formatTicket(ticket: TicketInput): any {
    const formData: any = {
      category: ticket.category,
      subject: ticket.subject,
      text: ticket.text,
      email: ticket.email,
      name: ticket.name
    };

    if (ticket.phone) formData.phone = ticket.phone;
    if (ticket.priority) formData.priority = ticket.priority;
    if (ticket.assignee) formData.assignee = ticket.assignee;
    if (ticket.tags && ticket.tags.length > 0) formData.tags = ticket.tags.join(',');
    if (ticket.cc && ticket.cc.length > 0) formData.cc = ticket.cc.join(',');
    if (ticket.bcc && ticket.bcc.length > 0) formData.bcc = ticket.bcc.join(',');

    if (ticket.custom_fields) {
      Object.entries(ticket.custom_fields).forEach(([key, value]) => {
        formData[key] = value;
      });
    }

    return formData;
  }

  async createTicket(data: TicketInput): Promise<any> {
    return await this.client.post('/tickets/', this.formatTicket(data));
  }

  async listTickets(params: {
    page?: number;
    size?: number;
    category?: string;
    status?: string;
    query?: string;
    sort_by?: string;
    minify_response?: boolean;
    fields?: string[];
  } = {}): Promise<any> {
    const queryParams: any = {
      page: params.page || 1,
      size: Math.min(params.size || 50, 50)
    };

    if (params.category) queryParams.category = params.category;
    if (params.status) queryParams.status = params.status;
    if (params.query) queryParams.q = params.query;
    if (params.sort_by) queryParams.sort = params.sort_by;
    if (params.minify_response) queryParams.minify_response = params.minify_response;
    if (params.fields && params.fields.length > 0) queryParams.fields = params.fields.join(',');

    return await this.client.get('/tickets/', queryParams);
  }

  async getTicket(ticketId: string, params: {
    show_cf_changes?: boolean;
  } = {}): Promise<any> {
    const queryParams: any = {};
    if (params.show_cf_changes) queryParams.show_cf_changes = params.show_cf_changes;

    return await this.client.get(
      `/ticket/${ticketId}/`,
      Object.keys(queryParams).length > 0 ? queryParams : undefined
    );
  }

  async updateTags(ticketId: string, data: { add?: string[], remove?: string[], staff_id?: number }): Promise<any> {
    const formData: any = {};
    if (data.staff_id) formData.staff_id = data.staff_id;
    if (data.add && data.add.length > 0) formData.add = data.add.join(',');
    if (data.remove && data.remove.length > 0) formData.remove = data.remove.join(',');
    return await this.client.post(`/ticket/${ticketId}/update_tags/`, formData);
  }

  async updateCustomFields(ticketId: string, fields: Record<string, any>, staff?: number): Promise<any> {
    const formData: any = { ...fields };
    if (staff) formData.staff = staff;
    return await this.client.post(`/ticket/${ticketId}/update_custom_fields/`, formData);
  }

  async moveCategory(ticketId: string, staffId: number, targetCategoryId: string): Promise<any> {
    return await this.client.post(`/ticket/${ticketId}/move/`, {
      staff_id: staffId,
      target_category_id: targetCategoryId
    });
  }

  async addStaffReply(ticketId: string, data: {
    text: string;
    staff_id: number;
    cc?: string[];
    bcc?: string[];
    status?: string;
    priority?: string;
    assignee?: number;
  }): Promise<any> {
    const formData: any = {
      staff: data.staff_id,
      html: data.text
    };

    if (data.cc && data.cc.length > 0) formData.cc = data.cc.join(',');
    if (data.bcc && data.bcc.length > 0) formData.bcc = data.bcc.join(',');
    if (data.status) formData.status = data.status;
    if (data.priority) formData.priority = data.priority;
    if (data.assignee) formData.assignee = data.assignee;

    return await this.client.post(`/ticket/${ticketId}/staff_update/`, formData);
  }

  async addPrivateNote(ticketId: string, data: {
    text: string;
    staff_id: number;
    status?: string;
    priority?: string;
  }): Promise<any> {
    const formData: any = {
      staff: data.staff_id,
      html: data.text
    };

    if (data.status) formData.status = data.status;
    if (data.priority) formData.priority = data.priority;

    return await this.client.post(`/ticket/${ticketId}/staff_pvtnote/`, formData);
  }

  async forwardTicket(ticketId: string, data: {
    to: string[];
    subject: string;
    staff_id: number;
    message?: string;
  }): Promise<any> {
    const formData: any = {
      staff_id: data.staff_id,
      subject: data.subject,
      to: data.to.join(',')
    };

    if (data.message) formData.html = data.message;

    return await this.client.post(`/ticket/${ticketId}/forward/`, formData);
  }

  async deleteTicket(ticketId: string, staffId: number): Promise<any> {
    return await this.client.post(`/ticket/${ticketId}/delete/`, {
      staff_id: staffId
    });
  }

  /**
   * Add a contact reply to a ticket (simulates customer response)
   * API: POST /ticket/<ticket_number>/user_reply/
   */
  async addContactReply(ticketId: string, data: {
    text: string;
    user?: number;
    cc?: string[];
    bcc?: string[];
  }): Promise<any> {
    const formData: any = {
      html: data.text
    };

    if (data.user) formData.user = data.user;
    if (data.cc && data.cc.length > 0) formData.cc = data.cc.join(',');
    if (data.bcc && data.bcc.length > 0) formData.bcc = data.bcc.join(',');

    return await this.client.post(`/ticket/${ticketId}/user_reply/`, formData);
  }

  /**
   * Subscribe an agent to a ticket
   * API: POST /ticket/<ticket_number>/subscribe/
   */
  async subscribeToTicket(ticketId: string, staffId: number): Promise<any> {
    return await this.client.post(`/ticket/${ticketId}/subscribe/`, {
      staff_id: staffId
    });
  }

  /**
   * Unsubscribe an agent from a ticket
   * API: POST /ticket/<ticket_number>/unsubscribe/
   */
  async unsubscribeFromTicket(ticketId: string, staffId: number): Promise<any> {
    return await this.client.post(`/ticket/${ticketId}/unsubscribe/`, {
      staff_id: staffId
    });
  }

  /**
   * Create multiple tickets in bulk
   * API: POST /tickets/ with array payload
   * The API caps a bulk request at 100 tickets.
   */
  async createTicketsBulk(tickets: TicketInput[]): Promise<any> {
    if (tickets.length > 100) {
      throw new Error('Bulk ticket creation limited to 100 tickets per request');
    }

    if (tickets.length === 0) {
      throw new Error('At least one ticket is required');
    }

    return await this.client.post('/tickets/', tickets.map(ticket => this.formatTicket(ticket)));
  }
}