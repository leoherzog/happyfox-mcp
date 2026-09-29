/**
 * HappyFox knowledge base export of one article or section (Docs/360 §6). The whole-KB exports are
 * resources in src/mcp/resources/registry.ts. Docs/360 shows no response bodies, so they are
 * returned as HappyFox sends them.
 */

import { HappyFoxClient, HappyFoxAPIError } from '../client';
import { idSegment } from '../paths';

export class KnowledgeBaseEndpoints {
  constructor(private client: HappyFoxClient) {}

  /** One external article (Docs/360 §6). Internal article ids are not served by this endpoint. */
  async getArticle(articleId: number | string): Promise<any> {
    return await this.getUnslashed(`/kb/article/${idSegment(articleId, 'article_id')}`);
  }

  /** One section (Docs/360 §6). */
  async getSection(sectionId: number | string): Promise<any> {
    return await this.getUnslashed(`/kb/section/${idSegment(sectionId, 'section_id')}`);
  }

  /**
   * GET the path as Docs/360 §6 writes it, without the trailing slash every other HappyFox path has.
   * Redirects are never followed, so a redirect is retried once with the slash.
   */
  private async getUnslashed(path: string): Promise<any> {
    try {
      return await this.client.get(path);
    } catch (error) {
      if (!(error instanceof HappyFoxAPIError) || error.code !== 'REDIRECT') throw error;
      return await this.client.get(`${path}/`);
    }
  }
}
