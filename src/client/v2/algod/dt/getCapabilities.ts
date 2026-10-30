import JSONRequest from '../../jsonrequest.js';
import { HTTPClientResponse } from '../../../client.js';
import { decodeJSON } from '../../../../encoding/encoding.js';
import { CapabilitiesResponse } from './models.js';
import { DTUnsupportedError } from './errors.js';

/**
 * The fork features a node has on and the limits it places on simulate and
 * query requests (`GET /v2/capabilities`). Every dtalgod node serves it, so a
 * 404 means stock algod, thrown as a {@link DTUnsupportedError}.
 */
export default class GetCapabilities extends JSONRequest<CapabilitiesResponse> {
  // eslint-disable-next-line class-methods-use-this
  path() {
    return '/v2/capabilities';
  }

  // eslint-disable-next-line class-methods-use-this
  prepare(response: HTTPClientResponse): CapabilitiesResponse {
    return decodeJSON(response.getJSONText(), CapabilitiesResponse);
  }

  protected async executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    try {
      return await super.executeRequest(headers, customOptions);
    } catch (err) {
      if ((err as { status?: number })?.status === 404) {
        throw new DTUnsupportedError(
          'The node has no capabilities endpoint: it is stock algod, not dtalgod',
          { cause: err }
        );
      }
      throw err;
    }
  }
}
