/* eslint-env mocha */
import assert from 'assert';
import * as nacl from '../src/nacl/naclWrappers.js';
import algosdk from '../src/index.js';
import * as address from '../src/encoding/address.js';

describe('address', () => {
  describe('#isValid', () => {
    const correctCase =
      'MO2H6ZU47Q36GJ6GVHUKGEBEQINN7ZWVACMWZQGIYUOE3RBSRVYHV4ACJI';
    // prettier-ignore
    const correctPublicKey = new Uint8Array([99, 180, 127, 102, 156, 252, 55, 227, 39, 198, 169, 232, 163, 16, 36, 130, 26, 223, 230, 213, 0, 153, 108, 192, 200, 197, 28, 77, 196, 50, 141, 112]);
    const correctChecksum = new Uint8Array([122, 240, 2, 74]);
    const malformedAddress1 =
      'MO2H6ZU47Q36GJ6GVHUKGEBEQINN7ZWVACMWZQGIYUOE3RBSRVYHV4ACJ';
    const malformedAddress2 = 123 as any;
    const malformedAddress3 =
      'MO2H6ZU47Q36GJ6GVHUKGEBEQINN7ZWVACererZQGI113RBSRVYHV4ACJI';
    const wrongChecksumAddress =
      'MO2H6ZU47Q36GJ6GVHUKGEBEQINN7ZWVACMWZQGIYUOE3RBSRVYHV4ACJG';

    // Check core functions
    it('should verify a valid Algorand address', () => {
      const decodedAddress = algosdk.decodeAddress(correctCase);
      assert.deepStrictEqual(decodedAddress.publicKey, correctPublicKey);
      assert.deepStrictEqual(decodedAddress.checksum(), correctChecksum);
    });

    it('should fail to verify a malformed Algorand address', () => {
      assert.throws(
        () => {
          algosdk.decodeAddress(malformedAddress1);
        },
        (err: Error) =>
          err.message.includes(address.MALFORMED_ADDRESS_ERROR_MSG)
      );
      assert.throws(
        () => {
          algosdk.decodeAddress(malformedAddress2);
        },
        (err: Error) =>
          err.message.includes(address.MALFORMED_ADDRESS_ERROR_MSG)
      );
      // Catch an exception possibly thrown by base32 decoding function
      assert.throws(() => {
        algosdk.decodeAddress(malformedAddress3);
      }, new Error('Invalid base32 characters'));
    });

    it('should fail to verify a checksum for an invalid Algorand address', () => {
      assert.throws(() => {
        algosdk.decodeAddress(wrongChecksumAddress);
      }, new Error(address.CHECKSUM_ADDRESS_ERROR_MSG));
    });

    // Check helper functions
    it('should verify a valid Algorand address', () => {
      assert.ok(algosdk.isValidAddress(correctCase));
    });

    it('should fail to verify an invalid Algorand address', () => {
      assert.strictEqual(algosdk.isValidAddress(malformedAddress1), false);
    });
  });

  describe('encode, decode', () => {
    it('should be able to encode and verify an address', () => {
      const pk = nacl.randomBytes(32);
      const addr = algosdk.encodeAddress(pk);
      assert.ok(algosdk.isValidAddress(addr));
    });

    it('should throw an error for addresses with incorrect length', () => {
      const pk = nacl.randomBytes(15);
      assert.throws(
        () => {
          algosdk.encodeAddress(pk);
        },
        (err: Error) =>
          err.message.includes(address.MALFORMED_ADDRESS_ERROR_MSG)
      );
    });

    it('should be able to encode and decode an address', () => {
      const pk = nacl.randomBytes(32);
      const addr = algosdk.encodeAddress(pk);
      const d = algosdk.decodeAddress(addr);
      assert.deepStrictEqual(new Uint8Array(d.publicKey), pk);
    });

    it('should decode an address seen before into its own copy', () => {
      const pk = nacl.randomBytes(32);
      const addr = algosdk.encodeAddress(pk);
      const first = algosdk.Address.fromString(addr);
      const second = algosdk.Address.fromString(addr);
      assert.deepStrictEqual(second.publicKey, pk);
      assert.notStrictEqual(first, second);
      assert.notStrictEqual(first.publicKey, second.publicKey);
      first.publicKey[0] = (first.publicKey[0] + 1) % 256;
      assert.deepStrictEqual(algosdk.Address.fromString(addr).publicKey, pk);
    });

    it('should still check the checksum of an address unlike one seen before', () => {
      const addr = algosdk.encodeAddress(nacl.randomBytes(32));
      algosdk.Address.fromString(addr);
      // character 55 holds only checksum bits
      const bad = `${addr.slice(0, 55)}${addr[55] === 'A' ? 'B' : 'A'}${addr.slice(56)}`;
      assert.throws(
        () => algosdk.Address.fromString(bad),
        new RegExp(address.CHECKSUM_ADDRESS_ERROR_MSG)
      );
    });

    it('should encode a key seen before, a view of it, and a changed key correctly', () => {
      const expected =
        'MO2H6ZU47Q36GJ6GVHUKGEBEQINN7ZWVACMWZQGIYUOE3RBSRVYHV4ACJI';
      // prettier-ignore
      const pk = new Uint8Array([99, 180, 127, 102, 156, 252, 55, 227, 39, 198, 169, 232, 163, 16, 36, 130, 26, 223, 230, 213, 0, 153, 108, 192, 200, 197, 28, 77, 196, 50, 141, 112]);
      assert.strictEqual(algosdk.encodeAddress(pk), expected);
      assert.strictEqual(algosdk.encodeAddress(pk), expected);
      // a view into a larger buffer, as ABI decoding of a log gives
      const buf = new Uint8Array(40);
      buf.set(pk, 5);
      assert.strictEqual(
        new algosdk.Address(buf.subarray(5, 37)).toString(),
        expected
      );
      // the same Address object after its bytes changed
      const a = new algosdk.Address(pk.slice());
      assert.strictEqual(a.toString(), expected);
      a.publicKey[0] = (a.publicKey[0] + 1) % 256;
      const changed = a.toString();
      assert.notStrictEqual(changed, expected);
      assert.ok(algosdk.isValidAddress(changed));
      assert.deepStrictEqual(
        algosdk.decodeAddress(changed).publicKey,
        a.publicKey
      );
    });

    it('should keep encoding correctly after the encode cache fills up', () => {
      const pk = nacl.randomBytes(32);
      const addr = algosdk.encodeAddress(pk);
      for (let i = 0; i < 10_001; i++) {
        algosdk.encodeAddress(nacl.randomBytes(32));
      }
      assert.strictEqual(algosdk.encodeAddress(pk), addr);
      assert.deepStrictEqual(
        new Uint8Array(algosdk.decodeAddress(addr).publicKey),
        pk
      );
    });
  });

  describe('from multisig preimage', () => {
    it('should match main repo code', () => {
      const addr1 =
        'XMHLMNAVJIMAW2RHJXLXKKK4G3J3U6VONNO3BTAQYVDC3MHTGDP3J5OCRU';
      const addr2 =
        'HTNOX33OCQI2JCOLZ2IRM3BC2WZ6JUILSLEORBPFI6W7GU5Q4ZW6LINHLA';
      const addr3 =
        'E6JSNTY4PVCY3IRZ6XEDHEO6VIHCQ5KGXCIQKFQCMB2N6HXRY4IB43VSHI';
      const params = {
        version: 1,
        threshold: 2,
        addrs: [addr1, addr2, addr3],
      };
      const expectAddr = algosdk.Address.fromString(
        'UCE2U2JC4O4ZR6W763GUQCG57HQCDZEUJY4J5I6VYY4HQZUJDF7AKZO5GM'
      );
      const actualAddr = algosdk.multisigAddress(params);
      assert.deepStrictEqual(actualAddr, expectAddr);
    });
  });

  describe('#getApplicationAddress', () => {
    it('should produce the correct address', () => {
      const appID = 77;
      const expected = algosdk.Address.fromString(
        'PCYUFPA2ZTOYWTP43MX2MOX2OWAIAXUDNC2WFCXAGMRUZ3DYD6BWFDL5YM'
      );
      const actual = algosdk.getApplicationAddress(appID);
      assert.deepStrictEqual(actual, expected);
    });
  });

  describe('Zero address', () => {
    it('should be correct', () => {
      assert.strictEqual(
        algosdk.ALGORAND_ZERO_ADDRESS_STRING,
        algosdk.encodeAddress(new Uint8Array(32))
      );
    });
  });
});
