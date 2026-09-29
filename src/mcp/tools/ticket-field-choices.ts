import { MCPTool, HappyFoxAuth } from '../../types';
import { HappyFoxClient, HappyFoxAPIError } from '../../happyfox/client';
import { TicketFieldChoiceEndpoints } from '../../happyfox/endpoints/ticket-field-choices';
import { referenceCache } from '../../cache/reference-cache';

/** A positive integer id, as a number or a digit string. */
const ID_TYPE = { type: ['integer', 'string'], pattern: '^[0-9]+$', minimum: 1 };

export class TicketFieldChoiceTools {
  getTools(): Array<MCPTool & { handler: string }> {
    return [
      {
        name: 'happyfox_update_ticket_custom_field_choices',
        description:
          'Replace the choices of one dropdown or multiple-choice ticket custom field (PUT ' +
          '/ticket_custom_field/<id>/). This is an account-wide configuration change: `choices` becomes the ' +
          'field\'s complete list for every ticket, and HappyFox deletes every existing choice left out of it. ' +
          'Read the field\'s current choices from happyfox://ticket-custom-fields first and send all of them: ' +
          'keep a choice with its id and text, rename one with its id and new text, add one with id null. ' +
          'Only the choices can be changed. Returns the field definition with the ids of new choices.',
        handler: 'replaceChoices',
        inputSchema: {
          type: 'object',
          properties: {
            custom_field_id: {
              ...ID_TYPE,
              description:
                'Numeric id of the ticket custom field, the `id` in happyfox://ticket-custom-fields (the <id> ' +
                'of t-cf-<id>), e.g. 61.'
            },
            choices: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: ['integer', 'string', 'null'],
                    pattern: '^[0-9]+$',
                    minimum: 1,
                    description:
                      'Required. Id of an existing choice to keep or rename; null adds a new choice. An existing ' +
                      'choice sent with null is deleted and re-added under a new id.'
                  },
                  text: { type: 'string', minLength: 1, description: 'The choice label.' },
                  dependant_fields: {
                    type: 'array',
                    // Docs/1247 shows only empty lists, so any item is accepted and copied back as read.
                    items: {},
                    description:
                      'Required for an existing choice: copy its dependant_fields unchanged from ' +
                      'happyfox://ticket-custom-fields. Omitted for a new choice, [] is sent.'
                  }
                },
                required: ['id', 'text']
              },
              description: 'The field\'s complete new list of choices. Existing choices left out are deleted.'
            }
          },
          required: ['custom_field_id', 'choices']
        }
      }
    ];
  }

  // The cached field list is dropped even on failure, since a lost response can follow an applied change.
  async replaceChoices(args: any, auth: HappyFoxAuth): Promise<any> {
    try {
      return await new TicketFieldChoiceEndpoints(new HappyFoxClient(auth))
        .replaceChoices(args.custom_field_id, args.choices);
    } catch (error) {
      if (error instanceof HappyFoxAPIError && error.code === 'NETWORK_ERROR') {
        throw new HappyFoxAPIError(
          `${error.message} Re-read happyfox://ticket-custom-fields to see whether the choices were replaced ` +
            'before repeating this call.',
          error.statusCode,
          error.code
        );
      }
      throw error;
    } finally {
      await referenceCache.invalidate(auth, 'ticket-custom-fields');
    }
  }
}
