import { MCPTool, HappyFoxAuth } from '../../types';
import { HappyFoxClient } from '../../happyfox/client';
import { KnowledgeBaseEndpoints } from '../../happyfox/endpoints/knowledge-base';

/** A positive integer id, as a number or a digit string. */
const ID_TYPE = { type: ['integer', 'string'], pattern: '^[0-9]+$', minimum: 1 };

export class KnowledgeBaseTools {
  getTools(): Array<MCPTool & { handler: string }> {
    return [
      {
        name: 'happyfox_get_kb_article',
        description:
          'Export one external (public) knowledge base article (GET /kb/article/<id>), read live. Internal ' +
          'articles cannot be fetched one at a time: read happyfox://kb-internal-articles instead. HappyFox ' +
          'does not document the response shape.',
        handler: 'getArticle',
        inputSchema: {
          type: 'object',
          properties: {
            article_id: {
              ...ID_TYPE,
              description: 'Numeric id of an external article, from happyfox://kb-articles.'
            }
          },
          required: ['article_id']
        }
      },
      {
        name: 'happyfox_get_kb_section',
        description:
          'Export one knowledge base section (GET /kb/section/<id>), read live. HappyFox does not document ' +
          'the response shape.',
        handler: 'getSection',
        inputSchema: {
          type: 'object',
          properties: {
            section_id: { ...ID_TYPE, description: 'Numeric id of a section, from happyfox://kb-sections.' }
          },
          required: ['section_id']
        }
      }
    ];
  }

  private endpoints(auth: HappyFoxAuth): KnowledgeBaseEndpoints {
    return new KnowledgeBaseEndpoints(new HappyFoxClient(auth));
  }

  async getArticle(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).getArticle(args.article_id);
  }

  async getSection(args: any, auth: HappyFoxAuth): Promise<any> {
    return await this.endpoints(auth).getSection(args.section_id);
  }
}
