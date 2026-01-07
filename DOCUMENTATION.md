# HappyFox API Documentation

## General Information

**Base URL:**
`https://<account_name>.happyfox.com/api/1.1/json/`

**Authentication:**
The API uses HTTP Basic Authentication.
- **Username:** API Key
- **Password:** Auth Code

**Rate Limiting:**
- **GET requests:** 500 requests / minute
- **POST requests:** 300 requests / minute
- **Error Code:** 429 (Too Many Requests)
- **Timeout:** 10 minutes wait time after exceeding the limit.

**Note on Timestamps:** All timestamps in API responses are in UTC.

---

## Tickets

### Retrieve Tickets
- **List all tickets:** `GET /tickets/`
  - **Parameters:** `minify_response`, `status`, `category`, `q` (query), `sort`, `size`, `page`
  - **Note:** There is no separate `/tickets/search/` endpoint. Use the `q` parameter on `/tickets/`.
- **Paginated list:** `GET /tickets/?size=<size_value>&page=<page_number>` (Default size: 10, Max: 50)
- **Ticket Detail:** `GET /ticket/<ticket_number>/`
  - **Parameters:** `show_cf_changes=true` (to see custom field history)
- **Fetch specific fields:** `GET /tickets/?fields=<field1>,<field2>,...`

### Create Tickets
- **Create a ticket:** `POST /tickets/`
  - **Payload:** `name`, `email`, `subject`, `text` (or `html`), `category`, `priority`, `t-cf-<id>` (custom fields), `attachments` (multipart/form-data)
- **Create multiple tickets:** `POST /tickets/`
  - **Payload:** List of ticket objects. Max 100 tickets.

### Update Tickets
- **Staff Update (Reply):** `POST /ticket/<ticket_number>/staff_update/`
  - **Required:** `staff` (agent ID)
  - **Optional:** `html` or `text`, `cc`, `bcc`, `status`, `priority`, `assignee`, `attachments`
- **Staff Private Note:** `POST /ticket/<ticket_number>/staff_pvtnote/`
  - **Required:** `staff` (agent ID)
  - **Optional:** `html` or `text`, `status`, `priority`, `attachments`
- **Contact Reply:** `POST /ticket/<ticket_number>/user_reply/`
- **Update Custom Fields:** `POST /ticket/<ticket_number>/update_custom_fields/`
- **Update Tags:** `POST /ticket/<ticket_number>/update_tags/`
  - **Payload:** `add` (comma-separated tags), `remove` (comma-separated tags)
- **Move Category:** `POST /ticket/<ticket_number>/move/`
  - **Payload:** `staff_id`, `target_category_id`
- **Delete Ticket:** `POST /ticket/<ticket_number>/delete/`
  - **Required:** `staff_id` (agent ID)

### Ticket Actions
- **Subscribe (Agent):** `POST /ticket/<ticket_number>/subscribe/`
- **Unsubscribe (Agent):** `POST /ticket/<ticket_number>/unsubscribe/`
- **Forward Ticket:** `POST /ticket/<ticket_number>/forward/`
  - **Required:** `staff_id`, `subject`, `to` (email addresses)
  - **Optional:** `html` or `text`
- **Inline Attachment:** `POST /ticket-inline-attachment` (Returns a temporary URL)

**Note on Field Names:** The HappyFox API uses `staff` for staff/agent ID in update operations, but `staff_id` for delete/forward/move operations.

---

## Contacts (Users)

### Retrieve Contacts
- **List all contacts:** `GET /users/`
- **Search contacts:** `GET /users/?q=<search_text>`
  - **Note:** There is no separate `/users/search/` endpoint. Use the `q` parameter on `/users/`.
  - **Searchable fields:** name, email, phone
- **Contact Detail:** `GET /user/<id>/` or `GET /user/<email>/`

### Create & Update Contacts
- **Create/Edit Contact:** `POST /users/`
  - **Payload:** `name`, `email`, `phones` (array), custom fields (`c-cf-<id>`)
- **Update Phone Number:** `POST /user/<id_of_contact>/`
  - **Payload:** `phones` array (include `id` to update existing number)
- **Manage Login Permission:** `POST /user/<id>/`
  - **Payload:** `is_login_enabled` (boolean)

### Phone Number Format
The `phones` field must be an array of phone objects:
```json
{
  "phones": [
    {
      "type": "mo",
      "number": "1234567890",
      "is_primary": true
    }
  ]
}
```

**Phone Type Codes:**
- `mo` - Mobile
- `w` - Work
- `m` - Main
- `h` - Home
- `o` - Other

When updating existing phone numbers, include the `id` field from the existing phone object.

### Contact Groups
- **List Contact Groups:** `GET /contact_groups/`
- **Group Details:** `GET /contact_group/<id>/`
- **Create Group:** `POST /contact_groups/`
  - **Required:** `name`
- **Edit Group:** `POST /contact_group/<id>/`
- **Add Contacts to Group:** `POST /contact_group/<id>/update_contacts/`
  - **Payload:** `contacts` - array of objects: `[{ "id": 1 }, { "id": 2 }]`
- **Remove Contacts from Group:** `POST /contact_group/<id>/delete_contacts/`
  - **Payload:** `contacts` - array of IDs: `[1, 2, 3]`

### Contact Custom Fields
- **List Metadata:** `GET /user_custom_fields/`

---

## Assets

### Retrieve Assets
- **List all assets:** `GET /assets/`
  - **Parameters:** `size`, `page`, `asset_type`
- **Asset Detail:** `GET /asset/<id>/`

### Create & Manage Assets
- **Create Asset:** `POST /assets/?asset_type=<asset_type_id>`
  - **Payload:** `name`, `display_id`, `contact_ids`, `contacts` (new contacts), custom fields
- **Update Asset:** `PUT /asset/<id>/`
- **Delete Asset:** `DELETE /asset/<id>/?deleted_by=<staff_id>`

### Asset Meta
- **List Asset Types:** `GET /asset_types/`
- **Asset Type Detail:** `GET /asset_type/<id>/`
- **List Asset Custom Fields:** `GET /asset_custom_fields/`
- **Asset Custom Field Detail:** `GET /asset_custom_fields/<id>/`

---

## Reports

- **List all reports:** `GET /reports/`
- **Report Summary:** `GET /report/<id>/`
- **Tabular View:** `GET /report/<id>/tabulardata/`
  - **Parameters:** `sort_key`, `sort_dir`, `size`, `page`, date range parameters.
- **Response Stats:** `GET /report/<id>/responsestats/`
- **Staff Performance:** `GET /report/<id>/staffperformance/`
- **Staff Activity:** `GET /report/<id>/staffactivity/`
- **Contact Activity:** `GET /report/<id>/customeractivity/`
- **SLA Performance:** `GET /report/<id>/slaentries/`

---

## General / Helper Endpoints

- **List Categories:** `GET /categories/`
- **List Staff/Agents:** `GET /staff/`
- **List Statuses:** `GET /statuses/`
- **Ticket Custom Fields Metadata:** `GET /ticket_custom_fields/`
- **Update Ticket Custom Field Choices:** `PUT /ticket_custom_field/<id>/` (for dynamic values)

### Knowledge Base (Read Only)
- **External Articles:** `GET /kb/articles/`
- **Internal Articles:** `GET /kb/internal-articles/`
- **Sections:** `GET /kb/sections/`
- **Single Article:** `GET /kb/article/<id>/`
- **Single Section:** `GET /kb/section/<id>/`

---

**Source:** [HappyFox API Documentation](https://support.happyfox.com/kb/article/360-api-for-happyfox/)

## Known Limitations

Based on available documentation and search results:
- **Authenticated User Identity:** API keys are account-wide credentials. There is no `/me` or `/current_user` endpoint to identify which staff member owns the API key.
- **SLA Management:** There are no public API endpoints to create, update, or delete Service Level Agreements (SLAs). SLAs must be managed via the HappyFox UI.
- **Smart Rules:** There are no endpoints to manage Smart Rules.
- **Canned Actions:** Programmatic management (create/update/delete) of Canned Actions is not supported.
- **Forum/Community:** No dedicated API endpoints found for managing community forums.
- **Attachments:** File attachments require `multipart/form-data` content type. The MCP adapter does not currently support attachments.
- **Concurrent Requests:** The API does not support concurrent calls to the same ticket's endpoints.
- **Bulk Operations:** Maximum 100 tickets/contacts per bulk request.
- **Contact/Contact Group Deletion:** The API does not support deleting contacts or contact groups.
