import JSONRequest from '../../jsonrequest.js';
import { HTTPClientResponse } from '../../../client.js';
import { decodeJSON } from '../../../../encoding/encoding.js';
import { SimulateLimitsResponse } from './models.js';
import { DTUnsupportedError } from './errors.js';

/**
 * The limits a node places on simulate requests
 * (`GET /v2/transactions/simulate/limits`). Every dtalgod node serves it, so
 * a 404 means stock algod, thrown as a {@link DTUnsupportedError}.
 */
export default class GetSimulateLimits extends JSONRequest<SimulateLimitsResponse> {
  // eslint-disable-next-line class-methods-use-this
  path() {
    return '/v2/transactions/simulate/limits';
  }

  // eslint-disable-next-line class-methods-use-this
  prepare(response: HTTPClientResponse): SimulateLimitsResponse {
    return decodeJSON(response.getJSONText(), SimulateLimitsResponse);
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
          'The node has no simulate limits endpoint: it is stock algod, not dtalgod',
          { cause: err }
        );
      }
      throw err;
    }
  }
}
