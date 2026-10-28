import {
  decodeJSON,
  Encodable,
  EncodableClass,
  JSONEncodingData,
} from '../../../../encoding/encoding.js';

/**
 * A run of 16 digits or more. Every integer above 2^53 has at least 16
 * digits, so a text without one has only integers a `number` holds exactly.
 */
const LONG_DIGITS = /\d{16,}/;

/**
 * Decodes a JSON response into a model, as `decodeJSON` does, but with the
 * native `JSON.parse` when the text has no integer that needs a bigint.
 *
 * `decodeJSON` parses with json-bigint and a reviver that turns every integer
 * into a bigint and fixes the prototype of every object, which costs about
 * twice the schema decode on a large versions or holders page. Without a long
 * digit run, a plain parse gives the same values: the schemas turn numbers
 * into bigints where the model has them (`Uint64Schema`), and no time-travel
 * model takes untyped values, where a plain number would leak through. A false
 * match, such as digits inside base64, takes the json-bigint path.
 *
 * @param text - The JSON text of the response.
 * @param cls - The model to decode into.
 */
export function decodeDTJSON<T extends Encodable>(
  text: string,
  cls: EncodableClass<T>
): T {
  if (LONG_DIGITS.test(text)) return decodeJSON(text, cls);
  const parsed = JSON.parse(text) as JSONEncodingData;
  return cls.fromEncodingData(
    cls.encodingSchema.fromPreparedJSON(parsed) as JSONEncodingData
  );
}
