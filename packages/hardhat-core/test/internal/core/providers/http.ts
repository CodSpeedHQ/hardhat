import { assert } from "chai";
import { MockAgent, MockPool } from "undici";

import { HttpProvider } from "../../../../src/internal/core/providers/http";
import { ERRORS } from "../../../../src/internal/core/errors-list";
import { SuccessfulJsonRpcResponse } from "../../../../src/internal/util/jsonrpc";

import { expectErrorAsync, expectHardhatError } from "../../../helpers/errors";

const TOO_MANY_REQUEST_STATUS = 429;

function makeMockPool(url: string): MockPool {
  const agent = new MockAgent({
    // as advised by https://undici.nodejs.org/#/docs/best-practices/writing-tests
    keepAliveTimeout: 10, // milliseconds
    keepAliveMaxTimeout: 10, // milliseconds
  });
  // throw when requests are not matched in a MockAgent intercept
  agent.disableNetConnect();
  return new MockPool(url, { agent });
}

describe("HttpProvider", function () {
  const url = "http://some.node";
  const networkName = "NetworkName";

  const successResponse: SuccessfulJsonRpcResponse = {
    jsonrpc: "2.0",
    id: 1,
    result: "whatever",
  };

  describe("constructor()", function () {
    it("should throw an error if network or forking URL is an empty string", async function () {
      expectHardhatError(() => {
        const emptyURL = "";
        new HttpProvider(emptyURL, networkName, {}, 20000);
      }, ERRORS.NETWORK.EMPTY_URL);

      expectHardhatError(() => {
        const emptyURLwithWhitespace = " ";
        new HttpProvider(emptyURLwithWhitespace, networkName, {}, 20000);
      }, ERRORS.NETWORK.EMPTY_URL);
    });
  });

  describe("request()", function () {
    it("should call mock pool's request()", async function () {
      const mockPool = makeMockPool(url);
      mockPool
        .intercept({ method: "POST", path: "/" })
        .reply(200, successResponse);
      const provider = new HttpProvider(url, networkName, {}, 20000, mockPool);
      const result = await provider.request({ method: "net_version" });
      assert.equal(result, successResponse.result);
    });

    it("should throw upon receiving a rate-limit response that lacks a retry-after header", async function () {
      const mockPool = makeMockPool(url);
      mockPool
        .intercept({ method: "POST", path: "/" })
        .reply(TOO_MANY_REQUEST_STATUS, {});
      const provider = new HttpProvider(url, networkName, {}, 20000, mockPool);
      await expectErrorAsync(async () => {
        await provider.request({ method: "net_version" });
      }, `Too Many Requests error received from ${new URL(url).hostname}`);
    });
    it("should retry upon receiving a rate-limit response that includes a retry-after header", async function () {
      const mockPool = makeMockPool(url);
      let tooManyRequestsReturned = false;
      mockPool.intercept({ method: "POST", path: "/" }).reply(() => {
        tooManyRequestsReturned = true;
        return {
          statusCode: TOO_MANY_REQUEST_STATUS,
          data: "",
          responseOptions: { headers: { "retry-after": "1" } },
        };
      });
      mockPool
        .intercept({ method: "POST", path: "/" })
        .reply(200, successResponse);
      const provider = new HttpProvider(url, networkName, {}, 20000, mockPool);
      const result = await provider.request({ method: "net_version" });
      assert.equal(result, successResponse.result);
      assert(tooManyRequestsReturned);
    });
  });
});
