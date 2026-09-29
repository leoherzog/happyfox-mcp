import { MCPResource, MCPResourceContent, HappyFoxAuth, ResourceNotFoundError } from '../../types';
import { HappyFoxClient, HappyFoxAPIError } from '../../happyfox/client';
import { referenceCache, REFERENCE_TTL_SECONDS } from '../../cache/reference-cache';

/** One resource's content and how many milliseconds a client may keep it. */
export interface ResourceRead {
  content: MCPResourceContent;
  ttlMs: number;
}

interface ReferenceSource {
  resource: MCPResource;
  /** Seconds a fetched copy is served from the reference cache. */
  ttlSeconds: number;
  /** Fetch the resource, returning only its documented shape. */
  fetch(client: HappyFoxClient): Promise<unknown>;
}

// Docs/1247: an external source can replace a ticket custom field's choices at any time,
// deleting choice ids and minting new ones.
const TICKET_CUSTOM_FIELDS_TTL_SECONDS = 60;

// Docs/1201 §8 and Docs/1088 §1 list no query parameters for /asset_types/ and /reports/, yet both
// answer with a paginated envelope, so later pages are requested with `page` alone to keep the
// page size. Unverified for both until tested against a live account.
const MAX_LIST_PAGES = 50;

const CACHED_15_MINUTES = 'Cached, so it can be up to 15 minutes old.';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A 2xx body that is not the documented shape; thrown so it is neither cached nor returned. */
function unexpectedShape(path: string, expected: string): HappyFoxAPIError {
  return new HappyFoxAPIError(
    `HappyFox answered GET ${path} without ${expected}, so the result was not used.`,
    200,
    'INVALID_RESPONSE'
  );
}

/** GET an endpoint whose documented response is a bare JSON array (Docs/360, Docs/1092 §8). */
function listOf(path: string): (client: HappyFoxClient) => Promise<unknown[]> {
  return async client => {
    const body: unknown = await client.get(path);
    if (!Array.isArray(body)) {
      throw unexpectedShape(path, 'the documented JSON array');
    }
    return body;
  };
}

/** GET an endpoint Docs/ show no response for (Docs/360 §6); any JSON object or array is used as is. */
function exportOf(path: string): (client: HappyFoxClient) => Promise<unknown> {
  return async client => {
    const body: unknown = await client.get(path);
    if (typeof body !== 'object' || body === null) {
      throw unexpectedShape(path, 'a JSON object or array');
    }
    return body;
  };
}

/** A missing or invalid page_count means one page. */
function pageCountOf(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 1 ? value : 1;
}

function tooManyPages(pageCount: number, items: string): HappyFoxAPIError {
  return new HappyFoxAPIError(
    `HappyFox reports ${pageCount} pages of ${items}; at most ${MAX_LIST_PAGES} are read.`,
    200,
    'INVALID_RESPONSE'
  );
}

interface ListPage {
  rows: unknown[];
  pageCount: number;
}

/** One page of GET /asset_types/ (Docs/1201 §8). */
function assetTypePage(body: unknown): ListPage {
  if (!isObject(body) || !isObject(body.page_info) || !Array.isArray(body.data)) {
    throw unexpectedShape('/asset_types/', 'the documented page_info and data');
  }
  return { rows: body.data, pageCount: pageCountOf(body.page_info.page_count) };
}

/** One page of GET /reports/ (Docs/1088 §1). */
function reportPage(body: unknown): ListPage {
  if (!isObject(body) || !Array.isArray(body.rows)) {
    throw unexpectedShape('/reports/', 'the documented rows');
  }
  return { rows: body.rows, pageCount: pageCountOf(body.page_count) };
}

function rowId(row: unknown): unknown {
  return isObject(row) ? row.id : undefined;
}

/**
 * Every row of a paged list, merged from every page into one array.
 * @param items - what the rows are, for error messages, e.g. "reports"
 * @throws HappyFoxAPIError (INVALID_RESPONSE) when a later page repeats a listed id, as it would if
 *   HappyFox ignored `page`, rather than return duplicates
 */
async function fetchAllPages(
  client: HappyFoxClient,
  path: string,
  items: string,
  readPage: (body: unknown) => ListPage
): Promise<unknown[]> {
  const first = readPage(await client.get(path));
  if (first.pageCount > MAX_LIST_PAGES) throw tooManyPages(first.pageCount, items);

  const merged: unknown[] = [];
  const seen = new Set<unknown>();
  const merge = (rows: unknown[], page: number) => {
    const ids = rows.map(rowId).filter(id => id !== undefined);
    if (ids.some(id => seen.has(id))) {
      throw new HappyFoxAPIError(
        `HappyFox answered page ${page} of GET ${path} with ${items} already listed, so the list could not be read in full.`,
        200,
        'INVALID_RESPONSE'
      );
    }
    ids.forEach(id => seen.add(id));
    merged.push(...rows);
  };

  merge(first.rows, 1);
  for (let page = 2; page <= first.pageCount; page++) {
    merge(readPage(await client.get(path, { page })).rows, page);
  }
  return merged;
}

const SOURCES: ReferenceSource[] = [
  {
    resource: {
      uri: 'happyfox://categories',
      name: 'Categories',
      description:
        'Ticket categories (GET /categories/): a JSON array of {id, name, description, public, ' +
        'time_spent_mandatory, prepopulate_cc}. Tools take the numeric id wherever they ask for a ' +
        `category. ${CACHED_15_MINUTES}`,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: listOf('/categories/'),
  },
  {
    resource: {
      uri: 'happyfox://statuses',
      name: 'Statuses',
      description:
        'Ticket statuses (GET /statuses/): a JSON array of {id, name, behavior ("pending" or ' +
        '"completed"), color, order, default}. Tools take the numeric id wherever they ask for a ' +
        `status. ${CACHED_15_MINUTES}`,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: listOf('/statuses/'),
  },
  {
    resource: {
      uri: 'happyfox://priorities',
      name: 'Priorities',
      description:
        'Ticket priorities (GET /priorities/): a JSON array of {id, name, order, default}. Tools take ' +
        `the numeric id wherever they ask for a priority. ${CACHED_15_MINUTES}`,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    // Docs/1039 §8.1 lists it beside /staff/ and /statuses/; §3 and §7 show the priority object.
    fetch: listOf('/priorities/'),
  },
  {
    resource: {
      uri: 'happyfox://ticket-custom-fields',
      name: 'Ticket Custom Fields',
      description:
        'Ticket custom field definitions (GET /ticket_custom_fields/): a JSON array of {id, name, ' +
        'type, required, choices [{id, text, dependant_fields}], categories [{category, order}], ' +
        'visible_to_staff_only, compulsory_on_completed, compulsory_on_move, depends_on_choice}. ' +
        'Send a value as t-cf-<id> using these ids, not the ids in agent portal URLs: a dropdown ' +
        'takes one choice id, a multiple-choice field a list of choice ids. An external source can ' +
        'replace the choices at any time, deleting ids and adding new ones, so this is cached for ' +
        'at most 1 minute; re-read it before sending choice ids.',
      mimeType: 'application/json',
    },
    ttlSeconds: TICKET_CUSTOM_FIELDS_TTL_SECONDS,
    fetch: listOf('/ticket_custom_fields/'),
  },
  {
    resource: {
      uri: 'happyfox://contact-custom-fields',
      name: 'Contact Custom Fields',
      description:
        'Contact custom field definitions (GET /user_custom_fields/): a JSON array of {id, name, type, ' +
        'required, order, choices [{id, text, dependant_fields}] or null, visible_to_staff_only, ' +
        'depends_on_choice}. Use these ids, not the ids in agent portal URLs, under the key prefix the ' +
        'tool names: c-cf-<id> for contacts and ticket creation, ccf-<id> for staff replies, private ' +
        'notes and property updates. A dropdown takes one choice id, a multiple-choice field a list of ' +
        `choice ids. ${CACHED_15_MINUTES}`,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: listOf('/user_custom_fields/'),
  },
  {
    resource: {
      uri: 'happyfox://staff',
      name: 'Staff Members',
      description:
        'Agents (GET /staff/): a JSON array of {id, name, email, active, role {id, name}, ' +
        'is_account_admin, categories (category ids), permissions}. `active` is false for a ' +
        'deactivated agent. Tools take the numeric id wherever they ask for a staff member, assignee ' +
        `or acting agent. ${CACHED_15_MINUTES}`,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: listOf('/staff/'),
  },
  {
    resource: {
      uri: 'happyfox://contact-groups',
      name: 'Contact Groups',
      description:
        'Contact groups (GET /contact_groups/): a JSON array of {id, name, description, ' +
        `tagged_domains}. ${CACHED_15_MINUTES} happyfox_get_contact_group reads one group, with its ` +
        'contacts, live.',
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: listOf('/contact_groups/'),
  },
  {
    resource: {
      uri: 'happyfox://asset-types',
      name: 'Asset Types',
      description:
        'Asset types (GET /asset_types/, every page merged): a JSON array of {id, name, description, ' +
        'settings}. Tools take the numeric id wherever they ask for an asset type. ' +
        CACHED_15_MINUTES,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: client => fetchAllPages(client, '/asset_types/', 'asset types', assetTypePage),
  },
  {
    resource: {
      uri: 'happyfox://reports',
      name: 'Reports',
      description:
        'Reports saved under All Reports (GET /reports/, every page merged): a JSON array of {id, name, ' +
        `description}. The happyfox_get_report_* tools take the numeric id. ${CACHED_15_MINUTES}`,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: client => fetchAllPages(client, '/reports/', 'reports', reportPage),
  },
  {
    resource: {
      uri: 'happyfox://kb-articles',
      name: 'Knowledge Base Articles',
      description:
        'Export of the external (public) knowledge base articles (GET /kb/articles/), as HappyFox sends it; ' +
        'HappyFox does not document its shape. happyfox_get_kb_article takes these article ids and reads ' +
        `one article live. ${CACHED_15_MINUTES}`,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: exportOf('/kb/articles/'),
  },
  {
    resource: {
      uri: 'happyfox://kb-internal-articles',
      name: 'Knowledge Base Internal Articles',
      description:
        'Export of the internal (staff-only) knowledge base articles (GET /kb/internal-articles/), as ' +
        'HappyFox sends it; HappyFox does not document its shape. Internal articles cannot be read one at ' +
        `a time. ${CACHED_15_MINUTES}`,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: exportOf('/kb/internal-articles/'),
  },
  {
    resource: {
      uri: 'happyfox://kb-sections',
      name: 'Knowledge Base Sections',
      description:
        'Export of every knowledge base section (GET /kb/sections/), as HappyFox sends it; HappyFox does ' +
        'not document its shape. happyfox_get_kb_section takes these section ids and reads one section ' +
        `live. ${CACHED_15_MINUTES}`,
      mimeType: 'application/json',
    },
    ttlSeconds: REFERENCE_TTL_SECONDS,
    fetch: exportOf('/kb/sections/'),
  },
];

export class ResourceRegistry {
  private sources: Map<string, ReferenceSource>;

  constructor() {
    this.sources = new Map(SOURCES.map(source => [source.resource.uri, source]));
  }

  async listResources(): Promise<MCPResource[]> {
    return Array.from(this.sources.values(), source => source.resource);
  }

  /**
   * Read a resource from the reference cache, fetching and caching it on a miss.
   * @returns the content and the lifetime left on the copy served
   * @throws ResourceNotFoundError for an unknown URI; HappyFoxAPIError when HappyFox fails or
   *   answers with anything but the documented shape, which is then not cached
   */
  async readResource(uri: string, auth: HappyFoxAuth): Promise<ResourceRead> {
    const source = this.sources.get(uri);
    if (!source) {
      throw new ResourceNotFoundError(uri);
    }

    const cacheKey = uri.replace('happyfox://', '');
    const cached = await referenceCache.get<unknown>(auth, cacheKey);

    let data: unknown;
    let ttlMs: number;
    if (cached) {
      ({ data, ttlMs } = cached);
    } else {
      data = await source.fetch(new HappyFoxClient(auth));
      ttlMs = source.ttlSeconds * 1000;
      await referenceCache.set(auth, cacheKey, data, source.ttlSeconds);
    }

    return {
      content: {
        uri,
        mimeType: source.resource.mimeType,
        text: JSON.stringify(data, null, 2),
      },
      ttlMs,
    };
  }
}
