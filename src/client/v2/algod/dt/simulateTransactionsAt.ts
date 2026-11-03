import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeMsgpack } from '../../../../encoding/encoding.js';
import SimulateRawTransactions from '../simulateTransaction.js';
import { SimulateRequest } from '../models/types.js';
import { DTSimulateResponse } from './models.js';

/**
 * {@link SimulateRawTransactions} that may send several transaction groups per
 * request (a dtalgod node; stock algod takes one) and decodes a
 * {@link DTSimulateResponse}, whose `groupResult()` reads each group's outcome.
 *
 * The request is encoded when this is made, so later changes to it are not
 * sent.
 */
export default class SimulateTransactionsAt extends SimulateRawTransactions {
  /** How many groups the request had, for `requestGroupCount`. */
  private groupCount: number;

  constructor(c: HTTPClient, request: SimulateRequest) {
    super(c, request);
    this.groupCount = request.txnGroups.length;
  }

  prepare(response: HTTPClientResponse): DTSimulateResponse {
    const data = decodeMsgpack(response.body, DTSimulateResponse);
    data.requestGroupCount = this.groupCount;
    return data;
  }

  /**
   * Execute the request.
   * @param headers - Additional headers to send in the request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async do(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<DTSimulateResponse> {
    return (await super.do(headers, customOptions)) as DTSimulateResponse;
  }

  /**
   * Execute the request, as `do()` does, and also return the response headers,
   * keyed by lowercased name.
   * @param headers - Additional headers to send in the request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async doWithHeaders(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<{ data: DTSimulateResponse; headers: Record<string, string> }> {
    const res = await super.doWithHeaders(headers, customOptions);
    return { data: res.data as DTSimulateResponse, headers: res.headers };
  }
}
