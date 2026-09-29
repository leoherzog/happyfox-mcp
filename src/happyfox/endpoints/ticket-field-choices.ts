/**
 * Replacement of a ticket custom field's dropdown choices (Docs/1247). HappyFox deletes every
 * existing choice the payload leaves out, so the whole list is checked before it is sent.
 */

import { HappyFoxClient, HappyFoxAPIError } from '../client';
import { idSegment } from '../paths';

/** One choice as a caller gives it. An id of null adds a new choice; the id key is required. */
export interface TicketFieldChoiceInput {
  id: number | string | null;
  text: string;
  dependant_fields?: unknown[];
}

/** One choice in the documented payload form (Docs/1247 example payload). */
interface ChoicePayload {
  id: number | null;
  text: string;
  dependant_fields: unknown[];
}

function invalidArgument(message: string): HappyFoxAPIError {
  return new HappyFoxAPIError(message, 400, 'INVALID_ARGUMENT');
}

/**
 * Every choice names its id, null for a new one, as the Docs/1247 example does: a choice sent without
 * it would be added under a new id and the existing one deleted. An existing choice must carry its
 * dependant_fields: sending [] in their place could detach the fields that depend on it. A new
 * choice defaults to [].
 */
function choicePayload(choice: unknown, index: number): ChoicePayload {
  const label = `choices[${index}]`;
  if (typeof choice !== 'object' || choice === null || Array.isArray(choice)) {
    throw invalidArgument(`Invalid ${label}: expected an object with id, text and dependant_fields.`);
  }

  const { id, text, dependant_fields: dependantFields } = choice as Record<string, unknown>;
  if (id === undefined) {
    throw invalidArgument(
      `${label}.id is required: the choice's id from happyfox://ticket-custom-fields, or null for a new ` +
        'choice. A choice sent without its id replaces the existing one under a new id.'
    );
  }
  const choiceId = id === null ? null : Number(idSegment(id, `${label}.id`));
  if (typeof text !== 'string' || text.trim() === '') {
    throw invalidArgument(`${label}.text is required, as a non-empty string.`);
  }
  if (dependantFields !== undefined && dependantFields !== null && !Array.isArray(dependantFields)) {
    throw invalidArgument(`Invalid ${label}.dependant_fields: expected a list.`);
  }
  if (choiceId !== null && !Array.isArray(dependantFields)) {
    throw invalidArgument(
      `${label}.dependant_fields is required for existing choice ${choiceId}: copy it unchanged from ` +
        'happyfox://ticket-custom-fields.'
    );
  }

  return { id: choiceId, text, dependant_fields: Array.isArray(dependantFields) ? dependantFields : [] };
}

export class TicketFieldChoiceEndpoints {
  constructor(private client: HappyFoxClient) {}

  /**
   * Replace the choices of a dropdown or multiple-choice ticket custom field (Docs/1247).
   * @param choices - the field's complete new list; every existing choice left out is deleted
   * @returns the field definition, with the ids HappyFox gave new choices
   * @throws HappyFoxAPIError (400) for an empty list, a repeated choice id or a malformed choice
   */
  async replaceChoices(fieldId: number | string, choices: unknown): Promise<any> {
    const path = `/ticket_custom_field/${idSegment(fieldId, 'custom_field_id')}/`;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw invalidArgument(
        'choices is required: the complete list of the field\'s choices. HappyFox deletes every choice left ' +
          'out, so an empty list is refused.'
      );
    }

    const payload = choices.map(choicePayload);
    const seen = new Set<number>();
    payload.forEach((choice, index) => {
      if (choice.id === null) return;
      if (seen.has(choice.id)) {
        throw invalidArgument(`choices[${index}].id ${choice.id} repeats an earlier choice.`);
      }
      seen.add(choice.id);
    });

    return await this.client.put(path, { choices: payload });
  }
}
