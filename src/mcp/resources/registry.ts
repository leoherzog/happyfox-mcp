import { MCPResource, MCPResourceContent, HappyFoxAuth, ResourceNotFoundError } from '../../types';
import { HappyFoxClient } from '../../happyfox/client';
import { referenceCache } from '../../cache/reference-cache';

export class ResourceRegistry {
  private resources: Map<string, MCPResource>;

  constructor() {
    this.resources = new Map();
    this.initializeResources();
  }

  private initializeResources() {
    // Define available resources
    const resourceDefinitions: MCPResource[] = [
      {
        uri: 'happyfox://categories',
        name: 'Categories',
        description: 'List of all ticket categories',
        mimeType: 'application/json'
      },
      {
        uri: 'happyfox://statuses',
        name: 'Statuses',
        description: 'List of all ticket statuses',
        mimeType: 'application/json'
      },
      {
        uri: 'happyfox://ticket-custom-fields',
        name: 'Ticket Custom Fields',
        description: 'List of custom fields for tickets',
        mimeType: 'application/json'
      },
      {
        uri: 'happyfox://contact-custom-fields',
        name: 'Contact Custom Fields',
        description: 'List of custom fields for contacts',
        mimeType: 'application/json'
      },
      {
        uri: 'happyfox://staff',
        name: 'Staff Members',
        description: 'List of all staff members',
        mimeType: 'application/json'
      },
      {
        uri: 'happyfox://contact-groups',
        name: 'Contact Groups',
        description: 'List of all contact groups',
        mimeType: 'application/json'
      },
      {
        uri: 'happyfox://asset-types',
        name: 'Asset Types',
        description: 'List of all asset types (cacheable reference data)',
        mimeType: 'application/json'
      }
    ];

    // Register all resources
    for (const resource of resourceDefinitions) {
      this.resources.set(resource.uri, resource);
    }
  }

  async listResources(): Promise<MCPResource[]> {
    return Array.from(this.resources.values());
  }

  async readResource(uri: string, auth: HappyFoxAuth): Promise<MCPResourceContent> {
    const resource = this.resources.get(uri);
    if (!resource) {
      throw new ResourceNotFoundError(uri);
    }

    // Extract cache key from URI (e.g., "happyfox://categories" -> "categories")
    const cacheKey = uri.replace('happyfox://', '');

    // Try to get from cache first (include region to prevent cross-pollution)
    let data = await referenceCache.get<any>(auth.accountName, auth.region, cacheKey);

    if (!data) {
      // Cache miss - fetch from HappyFox API
      const client = new HappyFoxClient(auth);

      switch (uri) {
        case 'happyfox://categories':
          data = await client.get('/categories/');
          break;

        case 'happyfox://statuses':
          data = await client.get('/statuses/');
          break;

        case 'happyfox://ticket-custom-fields':
          data = await client.get('/ticket_custom_fields/');
          break;

        case 'happyfox://contact-custom-fields':
          data = await client.get('/user_custom_fields/');
          break;

        case 'happyfox://staff':
          data = await client.get('/staff/');
          break;

        case 'happyfox://contact-groups':
          data = await client.get('/contact_groups/');
          break;

        case 'happyfox://asset-types':
          data = await client.get('/asset_types/');
          break;

        default:
          throw new ResourceNotFoundError(uri);
      }

      // Store in cache for next time (include region)
      await referenceCache.set(auth.accountName, auth.region, cacheKey, data);
    }

    return {
      uri,
      mimeType: resource.mimeType,
      text: JSON.stringify(data, null, 2)
    };
  }
}
